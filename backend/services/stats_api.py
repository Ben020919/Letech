from fastapi import APIRouter
import json
import os
from pydantic import BaseModel

router = APIRouter()

STATS_FILE = "data/stats.json"
os.makedirs("data", exist_ok=True)

# 預設數據結構
default_stats = {
    "outbound": 0, "search": 0, "foodLabel": 0,
    "yummyUpload": 0, "yummyPrint": 0,
    "hellobearUpload": 0, "hellobearPrint": 0,
    "anymallUpload": 0, "anymallPrint": 0,
    "homeyUpload": 0, "homeyPrint": 0
}

def load_stats():
    if not os.path.exists(STATS_FILE):
        with open(STATS_FILE, "w") as f:
            json.dump(default_stats, f)
        return default_stats.copy()
    try:
        with open(STATS_FILE, "r") as f:
            data = json.load(f)
            # 確保所有鍵值都存在
            for k in default_stats:
                if k not in data: data[k] = 0
            return data
    except:
        return default_stats.copy()

def save_stats(data):
    with open(STATS_FILE, "w") as f:
        json.dump(data, f)

# 讓其他模組可以呼叫這個函數來增加次數
def log_action(action_name: str):
    stats = load_stats()
    # 根據動作名稱對應到對應的鍵值
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
    if key and key in stats:
        stats[key] += 1
        save_stats(stats)

@router.get("/")
async def get_all_stats():
    return load_stats()

class PrintAction(BaseModel):
    action: str

@router.post("/log_print")
async def log_print_action(req: PrintAction):
    log_action(req.action)
    return {"status": "success"}