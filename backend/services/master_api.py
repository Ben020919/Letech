from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
import os
import pandas as pd
from services.storage_backup import upload_to_storage, restore_one_of

# 🌟 font helper 用 late import 避免 master_api ↔ homey_api 互相 import 死鎖
# (homey_api 自己 import 緊 master_api 嘅 load_master_db / find_by_*)

router = APIRouter()
DATA_DIR = "data"
os.makedirs(DATA_DIR, exist_ok=True)

# 🌟 自動尋找檔案是 csv 還是 xlsx,本地揾唔到就試 Supabase Storage restore
def get_db_path():
    for ext in ['.csv', '.xlsx', '.xls']:
        p = os.path.join(DATA_DIR, f"data{ext}")
        if os.path.exists(p):
            return p
    # 🌟 本地冇 → 試 Supabase Storage(Render redeploy 後第一次 access)
    candidates = [
        (os.path.join(DATA_DIR, f"data{ext}"), f"master/data{ext}")
        for ext in ['.csv', '.xlsx', '.xls']
    ]
    return restore_one_of(candidates)

# 全域變數：所有 3PL 系統共享這份記憶體！
_db_cache = None
_db_mtime = 0
# 🚀 hash-map index：產品編號 / 條碼 → row indices,O(1) 查表(原本係每次 O(N) 線性掃 ~8000 row)
_product_no_index = {}
_barcode_index = {}

def _build_indexes(df):
    """由 DataFrame 建 product_no / barcode 嘅 dict index,供 O(1) 查表用。"""
    global _product_no_index, _barcode_index
    _product_no_index = {}
    _barcode_index = {}
    if df is None or df.empty:
        return
    # 產品編號欄(Product_No 或 ProductCode)
    pno_col = 'Product_No' if 'Product_No' in df.columns else ('ProductCode' if 'ProductCode' in df.columns else None)
    if pno_col:
        try:
            _product_no_index = df.groupby(df[pno_col].astype(str).str.strip(), sort=False).groups
        except Exception:
            _product_no_index = {}
    if 'Barcode' in df.columns:
        try:
            _barcode_index = df.groupby(df['Barcode'].astype(str).str.strip(), sort=False).groups
        except Exception:
            _barcode_index = {}

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
        # 重新載入完即時建 index
        _build_indexes(_db_cache)

    return _db_cache

def find_by_product_no(p_no):
    """O(1) 用產品編號查 master DB,回傳 matched DataFrame(可空)。"""
    load_master_db()
    if _db_cache is None or not _product_no_index:
        return pd.DataFrame()
    idx = _product_no_index.get(str(p_no).strip())
    if idx is None or len(idx) == 0:
        return pd.DataFrame()
    return _db_cache.loc[idx]

def find_by_barcode(barcode):
    """O(1) 用條碼查 master DB,回傳 matched DataFrame(可空)。"""
    load_master_db()
    if _db_cache is None or not _barcode_index:
        return pd.DataFrame()
    idx = _barcode_index.get(str(barcode).strip())
    if idx is None or len(idx) == 0:
        return pd.DataFrame()
    return _db_cache.loc[idx]

# 🌟 字體靜態檔案 endpoint —— 唔再傳 base64(會 OOM),直接畀 browser fetch + cache


@router.get("/font/{filename}")
async def get_font(filename: str):
    """直接 serve font file(font1.ttf / syst.ttf)。Browser 自動 cache。"""
    safe_names = {"font1.ttf", "syst.ttf"}
    if filename not in safe_names:
        raise HTTPException(status_code=404, detail="字體唔存在")
    path = os.path.join(DATA_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"{filename} 喺 server 度揾唔到")
    return FileResponse(
        path,
        media_type="font/ttf",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


# 🌟 font_css 由 url() reference 構成(細,只有幾百 bytes),
# 唔再 base64 inline。avoid Render 60s timeout / OOM。
# Public URL 喺 production 係 letech-pro.onrender.com,local dev fallback 到 localhost
_FONT_PUBLIC_BASE = os.getenv("PUBLIC_API_BASE", "https://letech-pro.onrender.com")
_FONT_CSS_CACHE: str | None = None


def build_font_css() -> str:
    """細嘅 font_css,只 reference url 唔 inline base64。"""
    global _FONT_CSS_CACHE
    if _FONT_CSS_CACHE is not None:
        return _FONT_CSS_CACHE
    base = _FONT_PUBLIC_BASE.rstrip("/")
    css = (
        f"@font-face {{ font-family: 'CustomLabelFont'; "
        f"src: url('{base}/api/master/font/font1.ttf') format('truetype'); "
        f"font-weight: bold; font-style: normal; font-display: block; }}"
        f"@font-face {{ font-family: 'CustomLabelSerif'; "
        f"src: url('{base}/api/master/font/syst.ttf') format('truetype'); "
        f"font-weight: normal; font-style: normal; font-display: block; }}"
        "body, .label-container, div, span { "
        "font-family: 'CustomLabelFont', 'CustomLabelSerif', "
        "'Microsoft YaHei', 'PingFang SC', 'Heiti SC', "
        "Helvetica, Arial, sans-serif !important; }"
        ".serif, .label-container .serif, .label-box .serif { "
        "font-family: 'CustomLabelSerif', 'Source Han Serif SC', "
        "'Songti SC', SimSun, serif !important; }"
    )
    _FONT_CSS_CACHE = css
    return css


@router.get("/font-css")
async def get_font_css():
    """細(<1KB)嘅 font CSS,reference 兩個 ttf endpoint。Frontend cache。"""
    return {"font_css": build_font_css()}


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

        # 🌟 鏡像備份去 Supabase Storage —— 下次 Render redeploy 後自動 restore,
        # 唔使員工再上載一次
        upload_to_storage(save_path, f"master/{os.path.basename(save_path)}")

        # 🌟 關鍵：強制清空全域記憶體 + index，讓所有系統下次讀取時都抓最新版！
        global _db_cache, _db_mtime, _product_no_index, _barcode_index
        _db_cache = None
        _db_mtime = 0
        _product_no_index = {}
        _barcode_index = {}

        return {"message": "3PL與標籤資料庫已成功更新！(同時備份至 Supabase Storage)"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))