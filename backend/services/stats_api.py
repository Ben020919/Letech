from fastapi import APIRouter
from pydantic import BaseModel
import os
from dotenv import load_dotenv
from supabase import create_client, Client

# 🌟 載入環境變數
load_dotenv()
router = APIRouter()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

def get_supabase() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None
    return create_client(SUPABASE_URL, SUPABASE_KEY)

# 預設數據結構 (如果資料庫異常時的備用方案)
default_stats = {
    "outbound": 0, "search": 0, "foodLabel": 0,
    "yummyUpload": 0, "yummyPrint": 0,
    "hellobearUpload": 0, "hellobearPrint": 0,
    "anymallUpload": 0, "anymallPrint": 0,
    "homeyUpload": 0, "homeyPrint": 0
}

# 🌟 讀取數據 (從 Supabase)
def load_stats():
    supabase = get_supabase()
    if not supabase:
        return default_stats.copy()
        
    try:
        # 只抓取 id=1 的那一列數據
        res = supabase.table("system_stats").select("*").eq("id", 1).execute()
        if res.data and len(res.data) > 0:
            data = res.data[0]
            data.pop('id', None) # 拔掉 id 欄位，讓前端只拿到純數據
            return data
        else:
            return default_stats.copy()
    except Exception as e:
        print(f"獲取數據失敗: {e}")
        return default_stats.copy()

# 🌟 紀錄動作 (將特定欄位 + 1)
def log_action(action_name: str):
    supabase = get_supabase()
    if not supabase: return

    # 定義動作對應的資料庫欄位名稱
    mapping = {
        "Order_Outbound_Success": "outbound",
        "Barcode_Search": "search",
        "FoodLabel_Search": "foodLabel",
        "Yummy_Upload": "yummyUpload", "Yummy_Print": "yummyPrint",
        "Anymall_Upload": "anymallUpload", "Anymall_Print": "anymallPrint",
        "HelloBear_Upload": "hellobearUpload", "HelloBear_Print": "hellobearPrint",
        "Homey_Upload": "homeyUpload", "Homey_Print": "homeyPrint",
    }
    
    key = mapping.get(action_name)
    if key:
        try:
            # 1. 先查出目前的數字是多少
            res = supabase.table("system_stats").select(key).eq("id", 1).execute()
            if res.data and len(res.data) > 0:
                current_val = res.data[0][key] or 0
                
                # 2. 把數字 +1 寫回資料庫
                supabase.table("system_stats").update({key: current_val + 1}).eq("id", 1).execute()
        except Exception as e:
            print(f"更新數據失敗: {e}")

# ================= API 路由 =================

@router.get("/")
async def get_all_stats():
    return load_stats()

class PrintAction(BaseModel):
    action: str

@router.post("/log_print")
async def log_print_action(req: PrintAction):
    log_action(req.action)
    return {"status": "success"}