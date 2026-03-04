# services/inventory_api.py
from fastapi import APIRouter, HTTPException, Query
import requests
import time
import os
from typing import Dict, Any, List

# 建立 FastAPI 路由器
router = APIRouter()

class DearAPIClient:
    BASE_URL = "https://inventory.dearsystems.com/ExternalApi/v2/"

    def __init__(self, account_id: str, application_key: str):
        self.headers = {
            "api-auth-accountid": account_id,
            "api-auth-applicationkey": application_key,
            "Content-Type": "application/json",
            "Accept": "application/json"
        }

    def _make_request(self, endpoint: str, params: Dict[str, Any] = None) -> Dict[str, Any]:
        url = f"{self.BASE_URL}{endpoint}"
        if params is None:
            params = {}

        while True:
            try:
                response = requests.get(url, headers=self.headers, params=params)
                
                # 處理 API 速率限制 (Rate Limit)
                if response.status_code == 429 or response.status_code == 503:
                    print("⚠️ 觸發 API 速率限制，等待 2 秒後重試...")
                    time.sleep(2)
                    continue
                
                response.raise_for_status()
                
                if not response.text.strip():
                    return {}
                return response.json()
                
            except requests.exceptions.HTTPError as e:
                raise Exception(f"DEAR API 錯誤 ({response.status_code}): {response.text}")
            except Exception as e:
                raise Exception(f"連線失敗: {str(e)}")

    def get_inventory_by_sku(self, sku: str) -> List[Dict[str, Any]]:
        params = {"SKU": sku}
        response_data = self._make_request("ref/productavailability", params)
        return response_data.get("ProductAvailabilityList", [])

# 注意：這裡路徑設為 "/"，因為我們會在 main.py 統一設定 prefix="/api/inventory"
@router.get("/")
def get_inventory(sku: str = Query(..., description="要查詢的產品 SKU")):
    """
    接收前端傳來的 SKU，向 DEAR API 查詢庫存並回傳
    """
    account_id = os.getenv("DEAR_ACCOUNT_ID")
    application_key = os.getenv("DEAR_APPLICATION_KEY")

    if not account_id or not application_key:
        raise HTTPException(status_code=500, detail="伺服器缺少 DEAR API 金鑰設定 (請檢查 Render 環境變數)")

    try:
        dear_client = DearAPIClient(account_id=account_id, application_key=application_key)
        data = dear_client.get_inventory_by_sku(sku)
        
        # 回傳格式與前端 App.jsx 期望的格式一致
        return {"success": True, "data": data}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))