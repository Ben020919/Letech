from fastapi import APIRouter, UploadFile, File, HTTPException, Query
import os
import pandas as pd
import urllib.parse  # 🌟 必備：處理中文品名轉網址編碼

# 🌟 匯入打卡系統
try:
    from services.stats_api import log_action
except ImportError:
    def log_action(name): pass

router = APIRouter()
DATA_DIR = "data"
os.makedirs(DATA_DIR, exist_ok=True)

# 🌟 專屬於「搜尋系統」的檔案
SEARCH_DB_NAME_FILE = os.path.join(DATA_DIR, "search_db_name.txt")

def get_search_db_path():
    # 自動偵測上傳的是 csv 還是 xlsx
    for ext in ['.csv', '.xlsx', '.xls']:
        p = os.path.join(DATA_DIR, f"search_data{ext}")
        if os.path.exists(p): 
            return p
    return None

# 全域變數：搜尋系統專用記憶體快取
_search_cache = None
_search_mtime = 0

def load_search_db():
    global _search_cache, _search_mtime
    db_path = get_search_db_path()
    if not db_path: 
        return None
    
    current_mtime = os.path.getmtime(db_path)
    
    # 檔案有更新，或是第一次載入時，才重新讀取 (優化效能)
    if _search_cache is None or current_mtime != _search_mtime:
        _search_mtime = current_mtime
        try: _search_cache = pd.read_csv(db_path, dtype=str, encoding='utf-8-sig')
        except:
            try: _search_cache = pd.read_csv(db_path, dtype=str, encoding='big5')
            except:
                try: _search_cache = pd.read_excel(db_path, dtype=str)
                except: return None
        
        # 💡【極速優化】：預先把所有欄位合併成一個小寫搜尋欄位
        if _search_cache is not None:
            _search_cache = _search_cache.fillna("")
            _search_cache['_combined_search_text'] = _search_cache.astype(str).agg(' '.join, axis=1).str.lower()
                
    return _search_cache

# ================= 1. 獲取資料庫資訊 =================
@router.get("/info")
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

# ================= 2. 上傳更新資料庫 =================
@router.post("/upload")
async def upload_search_db(file: UploadFile = File(...)):
    try:
        file_ext = os.path.splitext(file.filename)[1].lower()
        if file_ext not in ['.csv', '.xlsx', '.xls']: file_ext = '.csv'
        save_path = os.path.join(DATA_DIR, f"search_data{file_ext}")
        
        # 清理舊檔案
        for ext in ['.csv', '.xlsx', '.xls']:
            old_file = os.path.join(DATA_DIR, f"search_data{ext}")
            if os.path.exists(old_file): os.remove(old_file)

        content = await file.read()
        with open(save_path, "wb") as f:
            f.write(content)
            
        # 紀錄原始檔名
        with open(SEARCH_DB_NAME_FILE, "w", encoding="utf-8") as f:
            f.write(file.filename)
            
        # 強制清空快取
        global _search_cache, _search_mtime
        _search_cache = None
        _search_mtime = 0
            
        return {"message": "搜尋專用資料庫已成功更新！"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ================= 3. 執行搜尋 (含 HKTVmall 智慧連結) =================
@router.get("/")
async def search_barcode(q: str = Query(..., min_length=1)):
    df = load_search_db()
    if df is None:
        raise HTTPException(status_code=400, detail="請先上傳資料庫檔案")
    
    query_lower = str(q).lower()
    
    # 💡 向量化搜尋：毫秒級篩選前 50 筆
    matched_df = df[df['_combined_search_text'].str.contains(query_lower, na=False)].head(200)
    
    results = []
    for _, row in matched_df.iterrows():
        product_code = row.get("ProductCode", row.get("Product_No", ""))
        barcode_val = str(row.get("Barcode", "")).strip()
        name_val = str(row.get("Name", row.get("Description", ""))).strip()
        
        # 🌟 智慧連結產生邏輯
        search_url = row.get("SearchUrl", "").strip()
        
        if not search_url:
            if name_val and name_val.upper() != "NAN":
                encoded_name = urllib.parse.quote(name_val)
                search_url = f"https://www.hktvmall.com/hktv/zh/search_a?keyword={encoded_name}"
            else:
                search_url = "#" # 真的沒資料就給空連結

        results.append({
            "ProductCode": product_code,
            "Barcode": barcode_val if barcode_val.upper() != "NAN" else "",
            "Name": name_val if name_val.upper() != "NAN" else "無名稱",
            "SearchUrl": search_url
        })
            
    # 打卡紀錄
    log_action("Barcode_Search")
    
    return results