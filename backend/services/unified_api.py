from fastapi import APIRouter, UploadFile, File, HTTPException, Query
import os
import pandas as pd
import urllib.parse
import requests
import time
from typing import Dict, Any, List

# 🌟 匯入打卡系統
try:
    from services.stats_api import log_action
except ImportError:
    def log_action(name): pass

# ==============================================================================
# 🔍 第一部分：本地資料庫搜尋系統 (Search API)
# ==============================================================================
search_router = APIRouter()
DATA_DIR = "data"
os.makedirs(DATA_DIR, exist_ok=True)

SEARCH_DB_NAME_FILE = os.path.join(DATA_DIR, "search_db_name.txt")
_search_cache = None
_search_mtime = 0

def get_search_db_path():
    for ext in ['.csv', '.xlsx', '.xls']:
        p = os.path.join(DATA_DIR, f"search_data{ext}")
        if os.path.exists(p): 
            return p
    return None

def load_search_db():
    global _search_cache, _search_mtime
    db_path = get_search_db_path()
    if not db_path: 
        return None
    
    current_mtime = os.path.getmtime(db_path)
    
    if _search_cache is None or current_mtime != _search_mtime:
        _search_mtime = current_mtime
        try: _search_cache = pd.read_csv(db_path, dtype=str, encoding='utf-8-sig')
        except:
            try: _search_cache = pd.read_csv(db_path, dtype=str, encoding='big5')
            except:
                try: _search_cache = pd.read_excel(db_path, dtype=str)
                except: return None
        
        if _search_cache is not None:
            _search_cache = _search_cache.fillna("")
            _search_cache['_combined_search_text'] = _search_cache.astype(str).agg(' '.join, axis=1).str.lower()
                
    return _search_cache

@search_router.get("/info")
async def get_search_info():
    db_path = get_search_db_path()
    if not db_path:
        return {"total_records": 0, "current_db_name": "尚未載入"}
    
    df = load_search_db()
    if df is not None:
        display_name = os.path.basename(db_path)
        if os.path.exists(SEARCH_DB_NAME_FILE):
            with open(SEARCH_DB_NAME_FILE, "r", encoding="utf-8") as f:
                display_name = f.read().strip()
                
        return {"total_records": len(df), "current_db_name": display_name}
    return {"total_records": 0, "current_db_name": "檔案格式錯誤"}

@search_router.post("/upload")
async def upload_search_db(file: UploadFile = File(...)):
    try:
        file_ext = os.path.splitext(file.filename)[1].lower()
        if file_ext not in ['.csv', '.xlsx', '.xls']: file_ext = '.csv'
        save_path = os.path.join(DATA_DIR, f"search_data{file_ext}")
        
        for ext in ['.csv', '.xlsx', '.xls']:
            old_file = os.path.join(DATA_DIR, f"search_data{ext}")
            if os.path.exists(old_file): os.remove(old_file)

        content = await file.read()
        with open(save_path, "wb") as f:
            f.write(content)
            
        with open(SEARCH_DB_NAME_FILE, "w", encoding="utf-8") as f:
            f.write(file.filename)
            
        global _search_cache, _search_mtime
        _search_cache = None
        _search_mtime = 0
            
        return {"message": "搜尋專用資料庫已成功更新！"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@search_router.get("/")
async def search_barcode(q: str = Query(..., min_length=1)):
    df = load_search_db()
    if df is None:
        raise HTTPException(status_code=400, detail="請先上傳資料庫檔案")
    
    query_lower = str(q).lower()
    matched_df = df[df['_combined_search_text'].str.contains(query_lower, na=False)].head(200)
    
    results = []
    for _, row in matched_df.iterrows():
        product_code = row.get("ProductCode", row.get("Product_No", ""))
        barcode_val = str(row.get("Barcode", "")).strip()
        name_val = str(row.get("Name", row.get("Description", ""))).strip()
        
        search_url = row.get("SearchUrl", "").strip()
        
        if not search_url:
            if name_val and name_val.upper() != "NAN":
                encoded_name = urllib.parse.quote(name_val)
                search_url = f"https://www.hktvmall.com/hktv/zh/search_a?keyword={encoded_name}"
            else:
                search_url = "#"

        results.append({
            "ProductCode": product_code,
            "Barcode": barcode_val if barcode_val.upper() != "NAN" else "",
            "Name": name_val if name_val.upper() != "NAN" else "無名稱",
            "SearchUrl": search_url
        })
            
    log_action("Barcode_Search")
    return results


# ==============================================================================
# 📦 第二部分：DEAR 庫存查詢系統 (Inventory API)
# ==============================================================================
inventory_router = APIRouter()

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
        params = {"SKU": sku}
        response_data = self._make_request("Product", params)
        products = response_data.get("Products", [])
        
        if products:
            p = products[0]
            barcode_val = (
                p.get("Barcode") or 
                p.get("UPC") or 
                p.get("AdditionalAttribute1") or 
                p.get("AdditionalAttribute2") or 
                p.get("AdditionalAttribute3")
            )
            
            return {
                "Name": p.get("Name", "-"),
                "SKU": p.get("SKU", "-"),
                "UPC": str(barcode_val).strip() if barcode_val else "-",  
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

@inventory_router.get("/")
def get_inventory(sku: str = Query(..., description="要查詢的產品 SKU")):
    account_id = os.getenv("DEAR_ACCOUNT_ID")
    application_key = os.getenv("DEAR_APPLICATION_KEY")

    if not account_id or not application_key:
        raise HTTPException(status_code=500, detail="伺服器缺少 DEAR API 金鑰設定")

    try:
        dear_client = DearAPIClient(account_id=account_id, application_key=application_key)
        product_info = dear_client.get_product_info(sku)
        
        if not product_info or product_info.get("SKU") == "-":
            return {
                "success": True, 
                "product_info": None, 
                "data": [],
                "message": "在 DEAR 中找不到對應的商品"
            }
            
        data = dear_client.get_inventory_by_sku(sku)
        
        return {
            "success": True, 
            "product_info": product_info, 
            "data": data
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))