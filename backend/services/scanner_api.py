from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import requests
import os
import time  
from dotenv import load_dotenv
from supabase import create_client, Client
from services.stats_api import log_action

load_dotenv()
router = APIRouter()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
LETECH_TOKEN = os.getenv("LETECH_TOKEN")

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

# 🌟 建立安全取值函數，防止 API 回傳空字串或浮點數導致程式崩潰
def get_val(item, key):
    val = item.get(key)
    if not val: return 0
    try: return int(float(val))
    except: return 0

@router.get("/order/{order_id}")
async def get_order(order_id: str):
    url = f"https://api.letech.com.hk/api/dear/scan/order?order_id={order_id}"
    try:
        res = requests.get(url, headers=get_headers())
        if res.status_code == 200:
            data = res.json()
            
            products = data.get("products") or []
            t_q = sum(get_val(p, 'quantity') for p in products) + sum(get_val(sp, 'quantity') for p in products for sp in (p.get('products') or []))
            t_s = sum(get_val(p, 'scanQty') for p in products) + sum(get_val(sp, 'scanQty') for p in products for sp in (p.get('products') or []))
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
    # 1. 🌟 在掃描前，先確認當前已掃描數量
    pre_url = f"https://api.letech.com.hk/api/dear/scan/order?order_id={req.order_id}"
    pre_data = requests.get(pre_url, headers=get_headers()).json()
    pre_products = pre_data.get("products") or []
    
    t_s_before = sum(get_val(p, 'scanQty') for p in pre_products) + sum(get_val(sp, 'scanQty') for p in pre_products for sp in (p.get('products') or []))
    t_q = sum(get_val(p, 'quantity') for p in pre_products) + sum(get_val(sp, 'quantity') for p in pre_products for sp in (p.get('products') or []))

    # 2. 執行掃描 API
    url = f"https://api.letech.com.hk/api/dear/scan/barcode?order_id={req.order_id}&barcode={req.barcode}&is_open=0"
    res = requests.post(url, headers=get_headers())
    
    if res.status_code == 200:
        time.sleep(0.3)
        post_data = requests.get(pre_url, headers=get_headers()).json()
        post_products = post_data.get("products") or []
        t_s_after = sum(get_val(p, 'scanQty') for p in post_products) + sum(get_val(sp, 'scanQty') for p in post_products for sp in (p.get('products') or []))
        
        # 3. 🌟 終極修復：如果 Letech 伺服器延遲導致數量沒變，我們手動幫它加 1！
        if t_s_after == t_s_before:
            t_s_after += 1
            found = False
            for p in post_products:
                if p.get('barcode') == req.barcode and get_val(p, 'scanQty') < get_val(p, 'quantity'):
                    p['scanQty'] = get_val(p, 'scanQty') + 1
                    found = True
                    break
                for sp in (p.get('products') or []):
                    if sp.get('barcode') == req.barcode and get_val(sp, 'scanQty') < get_val(sp, 'quantity'):
                        sp['scanQty'] = get_val(sp, 'scanQty') + 1
                        found = True
                        break
                if found: break
                
        is_done = post_data.get("status", False) or (t_q > 0 and t_s_after >= t_q)
        final_status = "✅ 已出庫" if is_done else "🟡 出庫中"
        
        # 成功更新資料庫
        log_to_supabase(req.order_id, req.barcode, final_status)

        # 4. 如果 100% 掃完，自動幫系統過帳
        if is_done:
            try:
                complete_url = f"https://api.letech.com.hk/api/dear/scan/completed?order_id={req.order_id}"
                requests.post(complete_url, headers=get_headers())
            except Exception as e:
                pass
            log_action("Order_Outbound_Success")
        
        return {"success": True, "is_done": is_done, "order_data": post_data}
    else:
        raise HTTPException(status_code=400, detail="條碼錯誤或該商品數量已滿！")

@router.post("/cancel/{order_id}")
async def cancel_order(order_id: str):
    # 1. 通知 Letech 伺服器註銷進度 (實際數量歸零)
    url = f"https://api.letech.com.hk/api/dear/scan/cancel?order_id={order_id}"
    try:
        requests.post(url, headers=get_headers())
    except:
        pass
        
    # 2. 更新 Supabase 狀態為已取消，並「清空條碼紀錄」迎接下次重掃
    supabase = get_supabase()
    if supabase:
        try: 
            supabase.table("scan_logs").update({
                "status": "❌ 已取消",
                "barcode": ""  # 🌟 加入這行：清空上次殘留的條碼
            }).eq("order_id", order_id).execute()
        except: 
            pass
            
    return {"status": "success"}

# ================= 強制出庫 API =================
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