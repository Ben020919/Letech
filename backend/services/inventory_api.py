from fastapi import APIRouter, HTTPException, Query
import requests
import time
import os
from typing import Dict, Any, List

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
                
                if response.status_code == 429 or response.status_code == 503:
                    print("⚠️ 觸發 API 速率限制，等待 2 秒後重試...")
                    time.sleep(2)
                    continue
                
                response.raise_for_status()
                
                if not response.text.strip():
                    return {}
                    
                try:
                    return response.json()
                except ValueError:
                    print(f"⚠️ API 回傳了非 JSON 格式的內容: {response.text[:100]}")
                    return {}
                
            except requests.exceptions.HTTPError as e:
                if response.status_code == 404:
                    return {}
                raise Exception(f"DEAR API 錯誤 ({response.status_code}): {response.text}")
            except Exception as e:
                raise Exception(f"連線失敗: {str(e)}")

    # 🌟 新增功能：去 DEAR 的產品總目錄抓取 UPC 和 UOM 等基本資料
def get_inventory_by_sku(self, query: str) -> List[Dict[str, Any]]:
        """
        支援使用 SKU 或 Barcode 查詢特定產品的庫存數量
        """
        # 注意：DEAR API 的 ProductAvailabilityList 允許模糊搜尋，
        # 我們直接把前端傳來的字串丟給 SKU 參數，DEAR 通常能同時比對 SKU 和 Barcode
        params = {"SKU": query}
        response_data = self._make_request("ref/productavailability", params)
        
        if isinstance(response_data, dict):
            return response_data.get("ProductAvailabilityList", [])
        elif isinstance(response_data, list):
            return response_data
        return []

@router.get("/")
def get_inventory(query: str = Query(..., alias="sku", description="要查詢的產品 SKU 或 Barcode")):
    """
    接收前端傳來的 SKU 或 Barcode，向 DEAR API 查詢庫存並回傳
    """
    account_id = os.getenv("DEAR_ACCOUNT_ID")
    application_key = os.getenv("DEAR_APPLICATION_KEY")

    if not account_id or not application_key:
        raise HTTPException(status_code=500, detail="伺服器缺少 DEAR API 金鑰設定 (請檢查 Render 環境變數)")

    try:
        dear_client = DearAPIClient(account_id=account_id, application_key=application_key)
        data = dear_client.get_inventory_by_sku(query)
        
        return {
            "success": True, 
            "data": data
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))