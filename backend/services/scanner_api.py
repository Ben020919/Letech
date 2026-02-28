from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import requests
import os
from dotenv import load_dotenv
from supabase import create_client, Client
from services.stats_api import log_action

load_dotenv()
router = APIRouter()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
LETECH_TOKEN = os.getenv("LETECH_TOKEN")

def get_supabase() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None
    try:
        return create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception:
        return None

def get_headers():
    if not LETECH_TOKEN:
        raise HTTPException(status_code=500, detail="伺服器缺少 LETECH_TOKEN 設定")
    token = LETECH_TOKEN if LETECH_TOKEN.startswith('Bearer') else f'Bearer {LETECH_TOKEN}'
    return {
        'Authorization': token,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
    }

# 🌟 寫入資料庫邏輯 (優化空條碼處理)
def log_to_supabase(order_id, barcode, status):
    supabase = get_supabase()
    if not supabase: return
    try:
        res = supabase.table("scan_logs").select("*").eq("order_id", order_id).execute()
        if len(res.data) > 0:
            existing_barcodes = res.data[0].get("barcode") or ""
            # 如果有傳入新條碼才拼接，否則保留原本的 (用於剛鎖定訂單時)
            if barcode:
                new_barcodes = f"{existing_barcodes}, {barcode}" if existing_barcodes else barcode
            else:
                new_barcodes = existing_barcodes
                
            supabase.table("scan_logs").update({
                "barcode": new_barcodes,
                "status": status
            }).eq("order_id", order_id).execute()
        else:
            supabase.table("scan_logs").insert({
                "order_id": order_id,
                "barcode": barcode if barcode else "",
                "status": status
            }).execute()
    except Exception as e:
        print(f"Supabase Log Error: {e}")

# ================= 1. 鎖定訂單 API =================
@router.get("/order/{order_id}")
async def get_order(order_id: str):
    url = f"https://api.letech.com.hk/api/dear/scan/order?order_id={order_id}"
    try:
        res = requests.get(url, headers=get_headers())
        if res.status_code == 200:
            data = res.json()
            
            # 檢查是否已全部出庫
            products = data.get("products") or []
            t_q = sum(p.get('quantity', 0) for p in products) + sum(sub_p.get('quantity', 0) for p in products for sub_p in (p.get('products') or []))
            t_s = sum(p.get('scanQty', 0) for p in products) + sum(sub_p.get('scanQty', 0) for p in products for sub_p in (p.get('products') or []))
            is_done = data.get("status", False) or (t_q > 0 and t_s >= t_q)
            
            # 🌟 核心邏輯：只要訂單還沒完成，一鎖定就馬上寫入 DB 顯示「🟡 出庫中」
            if not is_done:
                log_to_supabase(order_id, "", "🟡 出庫中")
                
            return data
            
        elif res.status_code == 500:
            raise HTTPException(status_code=404, detail="查無此單，或該單號已歸檔")
        elif res.status_code in [401, 403]:
            raise HTTPException(status_code=401, detail="Token 權限已失效！")
        else:
            raise HTTPException(status_code=res.status_code, detail=f"連線錯誤 ({res.status_code})")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=500, detail="無法連線到 Letech 伺服器")

class ScanRequest(BaseModel):
    order_id: str
    barcode: str

# ================= 2. 掃描貨品 API =================
@router.post("/barcode")
async def scan_barcode(req: ScanRequest):
    url = f"https://api.letech.com.hk/api/dear/scan/barcode?order_id={req.order_id}&barcode={req.barcode}&is_open=0"
    res = requests.post(url, headers=get_headers())
    
    if res.status_code == 200:
        # 掃描成功，重新獲取最新訂單狀態
        refresh_url = f"https://api.letech.com.hk/api/dear/scan/order?order_id={req.order_id}"
        refreshed_data = requests.get(refresh_url, headers=get_headers()).json()
        
        # 檢查是否已全部出庫
        products = refreshed_data.get("products") or []
        t_q = sum(p.get('quantity', 0) for p in products) + sum(sub_p.get('quantity', 0) for p in products for sub_p in (p.get('products') or []))
        t_s = sum(p.get('scanQty', 0) for p in products) + sum(sub_p.get('scanQty', 0) for p in products for sub_p in (p.get('products') or []))
        
        is_done = refreshed_data.get("status", False) or (t_q > 0 and t_s >= t_q)
        
        # 🌟 如果完成，狀態變為「✅ 已出庫」，紀錄會永久保留
        final_status = "✅ 已出庫" if is_done else "🟡 出庫中"
        
        # 寫入 Supabase 更新進度
        log_to_supabase(req.order_id, req.barcode, final_status)

        # 🌟 【新增這行】如果訂單剛好完成，紀錄一次出庫成功！
        if is_done:
            log_action("Order_Outbound_Success")
        
        return {"success": True, "is_done": is_done, "order_data": refreshed_data}
    else:
        raise HTTPException(status_code=400, detail="條碼錯誤或該商品數量已滿！")

# ================= 3. 換單/取消 API =================
@router.post("/cancel/{order_id}")
async def cancel_order(order_id: str):
    # (可選) 通知 Letech 伺服器取消鎖定
    url = f"https://api.letech.com.hk/api/dear/scan/cancel?order_id={order_id}"
    try:
        requests.post(url, headers=get_headers())
    except:
        pass
        
    supabase = get_supabase()
    if supabase:
        try: 
            # 🌟 核心邏輯：按下換單時，將 Database 裡的紀錄徹底刪除 (消失)
            supabase.table("scan_logs").delete().eq("order_id", order_id).execute()
        except: 
            pass
            
    return {"status": "success"}