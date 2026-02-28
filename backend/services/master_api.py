from fastapi import APIRouter, UploadFile, File, HTTPException
import os
import pandas as pd

router = APIRouter()
DATA_DIR = "data"
os.makedirs(DATA_DIR, exist_ok=True)

# 🌟 自動尋找檔案是 csv 還是 xlsx
def get_db_path():
    for ext in ['.csv', '.xlsx', '.xls']:
        p = os.path.join(DATA_DIR, f"data{ext}")
        if os.path.exists(p): 
            return p
    return None

# 全域變數：所有 3PL 系統共享這份記憶體！
_db_cache = None
_db_mtime = 0

def load_master_db():
    global _db_cache, _db_mtime
    db_path = get_db_path()
    if not db_path: 
        return None
    
    current_mtime = os.path.getmtime(db_path)
    
    # 如果是第一次讀取，或是檔案被更新過了，就重新載入
    if _db_cache is None or current_mtime != _db_mtime:
        _db_mtime = current_mtime
        try:
            _db_cache = pd.read_csv(db_path, dtype=str, encoding='utf-8-sig')
        except:
            try: _db_cache = pd.read_csv(db_path, dtype=str, encoding='big5')
            except:
                try: _db_cache = pd.read_excel(db_path, dtype=str)
                except: return None
                
    return _db_cache

@router.get("/info")
async def get_master_info():
    db_path = get_db_path()
    if not db_path:
        return {"total_records": 0, "current_db_name": "尚未載入"}
    
    df = load_master_db()
    if df is not None:
        return {"total_records": len(df), "current_db_name": os.path.basename(db_path)}
    return {"total_records": 0, "current_db_name": "檔案格式錯誤"}

@router.post("/upload")
async def upload_master_db(file: UploadFile = File(...)):
    try:
        file_ext = os.path.splitext(file.filename)[1].lower()
        if file_ext not in ['.csv', '.xlsx', '.xls']: file_ext = '.csv'
        save_path = os.path.join(DATA_DIR, f"data{file_ext}")
        
        # 刪除舊的衝突檔案，確保系統裡永遠只有一個主資料庫
        for ext in ['.csv', '.xlsx', '.xls']:
            old_file = os.path.join(DATA_DIR, f"data{ext}")
            if os.path.exists(old_file): os.remove(old_file)

        content = await file.read()
        with open(save_path, "wb") as f:
            f.write(content)
            
        # 🌟 關鍵：強制清空全域記憶體，讓所有系統下次讀取時都抓最新版！
        global _db_cache, _db_mtime
        _db_cache = None
        _db_mtime = 0
            
        return {"message": "3PL與標籤資料庫已成功更新！"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))