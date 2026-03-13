from fastapi import APIRouter, Request
import json
import os

router = APIRouter()
DATA_DIR = "data"
DATA_FILE = os.path.join(DATA_DIR, "hktvmall_orders.json")
COMMAND_FILE = os.path.join(DATA_DIR, "command.json") # 🌟 新增：存放遠端指令的檔案

# 1. 提供給 React 前端讀取資料的 API (GET)
@router.get("/")
def get_order_data():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"today": {}, "tomorrow": {}, "status_msg": "🔄 尚未收到爬蟲端傳來的資料..."}

# 2. 提供給本地爬蟲機器人上傳資料的 API (POST)
@router.post("/update")
async def update_order_data(request: Request):
    try:
        data = await request.json()
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        return {"status": "success", "message": "訂單數據同步成功！"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# =========================================================
# 🌟 以下為遠端遙控功能新增的 API
# =========================================================

# 3. 接收 Letech 前端發送的「遠端觸發」指令 (POST)
@router.post("/trigger")
def trigger_scrape():
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(COMMAND_FILE, "w", encoding="utf-8") as f:
        json.dump({"trigger": True}, f) # 貼上虛擬便利貼
    return {"status": "success", "message": "遠端指令已發送"}

# 4. 提供給本地爬蟲每 10 秒檢查一次的 API (GET)
@router.get("/check_command")
def check_command():
    if os.path.exists(COMMAND_FILE):
        try:
            with open(COMMAND_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            
            if data.get("trigger"):
                # 發現有指令！讀取後立刻將便利貼撕掉 (設為 False)，避免重複抓取
                with open(COMMAND_FILE, "w", encoding="utf-8") as f:
                    json.dump({"trigger": False}, f)
                return {"trigger": True}
        except Exception:
            pass
    return {"trigger": False}