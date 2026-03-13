from fastapi import APIRouter, Request
import json
import os

router = APIRouter()
DATA_DIR = "data"
DATA_FILE = os.path.join(DATA_DIR, "hktvmall_orders.json")

# 1. 提供給 React 前端讀取資料的 API (GET)
@router.get("/")
def get_order_data():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    # 如果還沒有檔案，回傳預設空格式
    return {"today": {}, "tomorrow": {}, "status_msg": "🔄 尚未收到爬蟲端傳來的資料..."}

# 2. 提供給本地爬蟲機器人上傳資料的 API (POST)
@router.post("/update")
async def update_order_data(request: Request):
    try:
        # 接收本地 Streamlit 傳過來的 JSON
        data = await request.json()
        
        # 存檔到主伺服器的本地端
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
            
        return {"status": "success", "message": "訂單數據同步成功！"}
    except Exception as e:
        return {"status": "error", "message": str(e)}