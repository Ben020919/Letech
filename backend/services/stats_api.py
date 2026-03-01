from fastapi import APIRouter
from pydantic import BaseModel
import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()
router = APIRouter()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# 🌟 建立全域變數，保存唯一的一個連線
_supabase_client = None

def get_supabase() -> Client:
    global _supabase_client
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None
    if _supabase_client is None:
        _supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _supabase_client

default_stats = {
    "outbound": 0, "search": 0, "foodLabel": 0,
    "yummyUpload": 0, "yummyPrint": 0,
    "hellobearUpload": 0, "hellobearPrint": 0,
    "anymallUpload": 0, "anymallPrint": 0,
    "homeyUpload": 0, "homeyPrint": 0
}

def load_stats():
    supabase = get_supabase()
    if not supabase:
        return default_stats.copy()
        
    try:
        res = supabase.table("system_stats").select("*").execute()
        if res.data:
            formatted_data = {row["action_name"]: row["count"] for row in res.data}
            final_data = default_stats.copy()
            final_data.update(formatted_data)
            return final_data
        else:
            return default_stats.copy()
    except Exception as e:
        print(f"獲取數據失敗: {e}")
        return default_stats.copy()

def log_action(action_name: str):
    supabase = get_supabase()
    if not supabase: return

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
            res = supabase.table("system_stats").select("count").eq("action_name", key).execute()
            if res.data and len(res.data) > 0:
                current_val = res.data[0]["count"] or 0
                supabase.table("system_stats").update({"count": current_val + 1}).eq("action_name", key).execute()
        except Exception as e:
            print(f"更新數據失敗: {e}")

@router.get("/")
async def get_all_stats():
    return load_stats()

class PrintAction(BaseModel):
    action: str

@router.post("/log_print")
async def log_print_action(req: PrintAction):
    log_action(req.action)
    return {"status": "success"}