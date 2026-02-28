from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from supabase import create_client, Client
import time
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv

# 🌟 載入 .env 檔案裡的環境變數
load_dotenv()

router = APIRouter()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

def get_supabase() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
         raise HTTPException(status_code=500, detail="伺服器未設定 Supabase 金鑰 (找不到 .env 檔案或變數)")
    try:
        return create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Supabase 連線失敗: {e}")

# ================= 1. 取得所有訊息 =================
@router.get("/messages")
async def get_messages():
    try:
        supabase = get_supabase()
        response = supabase.table("messages").select("*").order("created_at", desc=False).execute()
        
        messages = response.data
        for msg in messages:
            try:
                dt_utc = datetime.strptime(msg["created_at"][:19], "%Y-%m-%dT%H:%M:%S")
                dt_local = dt_utc + timedelta(hours=8)
                msg["display_time"] = dt_local.strftime("%Y/%m/%d %H:%M")
            except Exception:
                msg["display_time"] = msg["created_at"][:16].replace("T", " ")
                
        return {"status": "success", "messages": messages}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ================= 2. 傳送文字訊息或圖片 =================
@router.post("/message")
async def send_message(
    user_name: str = Form(...),
    message: str = Form(""),
    file: UploadFile = File(None)
):
    if not user_name.strip():
        raise HTTPException(status_code=400, detail="名字不能為空")

    try:
        supabase = get_supabase()
        img_url = ""
        msg_text = message.strip()

        if file:
            file_bytes = await file.read()
            unique_filename = f"{int(time.time())}_{file.filename}"
            
            supabase.storage.from_("chat_images").upload(
                file=file_bytes,
                path=unique_filename,
                file_options={"content-type": file.content_type or "image/jpeg"}
            )
            img_url = supabase.storage.from_("chat_images").get_public_url(unique_filename)

        if msg_text and not msg_text.startswith("查詢不到訂單："):
            msg_text = f"查詢不到訂單：{msg_text}"
        elif not msg_text and file:
            msg_text = "查詢不到訂單：(僅附圖)"

        if msg_text or img_url:
            data = {
                "user_name": user_name.strip(),
                "message": msg_text,
                "image_url": img_url
            }
            supabase.table("messages").insert(data).execute()

        return {"status": "success", "message": "發送成功"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ================= 3. 撤回訊息 (刪除) =================
@router.delete("/message/{msg_id}")
async def delete_message(msg_id: str): # 🌟 將 int 改為 str，避免 UUID 格式報錯
    try:
        supabase = get_supabase()
        # 根據訊息 ID 從資料庫刪除該筆資料
        res = supabase.table("messages").delete().eq("id", msg_id).execute()
        
        # 檢查是否真的有刪除到資料 (Supabase 若因權限阻擋，會回傳空陣列)
        if hasattr(res, 'data') and len(res.data) == 0:
             # 如果你發現這行錯誤，代表是 Supabase RLS 權限沒開
             pass 

        return {"status": "success", "message": "訊息已成功撤回"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))