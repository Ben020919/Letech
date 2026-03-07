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

    def get_product_info(self, sku: str) -> dict:
        """
        只使用 SKU 搜尋 DEAR 的商品總目錄，以獲取基本資訊。
        """
        params = {"SKU": sku}
        response_data = self._make_request("Product", params)
        products = response_data.get("Products", [])
        
        if products:
            p = products[0]
            return {
                "Name": p.get("Name", "-"),
                "SKU": p.get("SKU", "-"),
                "UPC": p.get("UPC", "-"),  
                "UOM": p.get("UOM", "個")   
            }
        return {}

    def get_inventory_by_sku(self, sku: str) -> List[Dict[str, Any]]:
        params = {"SKU": sku}
        response_data = self._make_request("ref/productavailability", params)
        
        if isinstance(response_data, dict):
            return response_data.get("ProductAvailabilityList", [])
        elif isinstance(response_data, list):
            return response_data
        return []

@router.get("/")
def get_inventory(sku: str = Query(..., description="要查詢的產品 SKU")):
    account_id = os.getenv("DEAR_ACCOUNT_ID")
    application_key = os.getenv("DEAR_APPLICATION_KEY")

    if not account_id or not application_key:
        raise HTTPException(status_code=500, detail="伺服器缺少 DEAR API 金鑰設定")

    try:
        dear_client = DearAPIClient(account_id=account_id, application_key=application_key)
        
        # 1. 抓取商品的 Name, UPC, UOM 基本資料 (嚴格依照 SKU 搜尋)
        product_info = dear_client.get_product_info(sku)
        
        if not product_info or product_info.get("SKU") == "-":
            return {
                "success": True, 
                "product_info": None, 
                "data": [],
                "message": "在 DEAR 中找不到對應的商品"
            }
            
        # 2. 抓取詳細庫存
        data = dear_client.get_inventory_by_sku(sku)
        
        return {
            "success": True, 
            "product_info": product_info, 
            "data": data
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))