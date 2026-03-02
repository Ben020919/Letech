from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import requests
import os
import time  # 🌟 引入 time 用於緩衝延遲
from dotenv import load_dotenv
from supabase import create_client, Client
from services.stats_api import log_action

load_dotenv()
router = APIRouter()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
LETECH_TOKEN = os.getenv("LETECH_TOKEN")

# 🌟 共用單一連線
_supabase_client = None

def get_supabase() -> Client:
    global _supabase_client
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None
    if _supabase_client is None:
        try:
            _supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
        except Exception:
            return None
    return _supabase_client

def get_headers():
    if not LETECH_TOKEN:
        raise HTTPException(status_code=500, detail="伺服器缺少 LETECH_TOKEN 設定")
    token = LETECH_TOKEN if LETECH_TOKEN.startswith('Bearer') else f'Bearer {LETECH_TOKEN}'
    return {
        'Authorization': token,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
    }

def log_to_supabase(order_id, barcode, status):
    supabase = get_supabase()
    if not supabase: return
    try:
        res = supabase.table("scan_logs").select("*").eq("order_id", order_id).execute()
        if len(res.data) > 0:
            existing_barcodes = res.data[0].get("barcode") or ""
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

@router.get("/order/{order_id}")
async def get_order(order_id: str):
    url = f"https://api.letech.com.hk/api/dear/scan/order?order_id={order_id}"
    try:
        res = requests.get(url, headers=get_headers())
        if res.status_code == 200:
            data = res.json()
            
            products = data.get("products") or []
            t_q = sum(p.get('quantity', 0) for p in products) + sum(sub_p.get('quantity', 0) for p in products for sub_p in (p.get('products') or []))
            t_s = sum(p.get('scanQty', 0) for p in products) + sum(sub_p.get('scanQty', 0) for p in products for sub_p in (p.get('products') or []))
            is_done = data.get("status", False) or (t_q > 0 and t_s >= t_q)
            
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

@router.post("/barcode")
async def scan_barcode(req: ScanRequest):
    url = f"https://api.letech.com.hk/api/dear/scan/barcode?order_id={req.order_id}&barcode={req.barcode}&is_open=0"
    res = requests.post(url, headers=get_headers())
    
    if res.status_code == 200:
        # 🌟 緩衝延遲：給 Letech 伺服器 0.3 秒更新資料庫的時間
        time.sleep(0.3)
        
        refresh_url = f"https://api.letech.com.hk/api/dear/scan/order?order_id={req.order_id}"
        refreshed_data = requests.get(refresh_url, headers=get_headers()).json()
        
        products = refreshed_data.get("products") or []
        
        # 🌟 強制轉型 int：避免 API 回傳字串導致加法錯誤
        t_q = sum(int(p.get('quantity', 0)) for p in products) + sum(int(sub_p.get('quantity', 0)) for p in products for sub_p in (p.get('products') or []))
        t_s = sum(int(p.get('scanQty', 0)) for p in products) + sum(int(sub_p.get('scanQty', 0)) for p in products for sub_p in (p.get('products') or []))
        
        is_done = refreshed_data.get("status", False) or (t_q > 0 and t_s >= t_q)
        final_status = "✅ 已出庫" if is_done else "🟡 出庫中"
        
        log_to_supabase(req.order_id, req.barcode, final_status)

        if is_done:
            # 🌟 自動過帳：確認完成後，呼叫 completed API 結單
            try:
                complete_url = f"https://api.letech.com.hk/api/dear/scan/completed?order_id={req.order_id}"
                requests.post(complete_url, headers=get_headers())
            except Exception as e:
                print(f"Auto-complete error: {e}")
                
            log_action("Order_Outbound_Success")
        
        return {"success": True, "is_done": is_done, "order_data": refreshed_data}
    else:
        raise HTTPException(status_code=400, detail="條碼錯誤或該商品數量已滿！")

@router.post("/cancel/{order_id}")
async def cancel_order(order_id: str):
    url = f"https://api.letech.com.hk/api/dear/scan/cancel?order_id={order_id}"
    try:
        requests.post(url, headers=get_headers())
    except:
        pass
        
    supabase = get_supabase()
    if supabase:
        try: 
            supabase.table("scan_logs").delete().eq("order_id", order_id).execute()
        except: 
            pass
            
    return {"status": "success"}

# ================= 4. 強制出庫 API =================
@router.post("/force_complete/{order_id}")
async def force_complete_order(order_id: str):
    url = f"https://api.letech.com.hk/api/dear/scan/completed?order_id={order_id}&is_mandatory=true"
    try:
        res = requests.post(url, headers=get_headers())
        
        if res.status_code == 200:
            log_to_supabase(order_id, "", "⚠️ 強制出庫")
            log_action("Order_Outbound_Success")
            return {"status": "success", "message": "強制出庫成功"}
        else:
            raise HTTPException(status_code=res.status_code, detail=f"強制出庫失敗 (Letech 伺服器回傳代碼：{res.status_code})")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=500, detail="無法連線到 Letech 伺服器")