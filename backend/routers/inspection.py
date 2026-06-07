from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
from pypdf import PdfReader
import io
import re
import uuid
import os
import gc
import random  # 🌟 新增：用於生成 5 位數任務碼
from datetime import datetime, timezone
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("缺少 SUPABASE_URL 或 SUPABASE_KEY 環境變數")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
router = APIRouter()

VALID_ZONES = ["anymall", "hellobear", "yummy", "homey"]


def _parse_zone_key(z: str):
    """Parse '{zone}_{task_code}' → (zone, task_code)."""
    if not z:
        return "", ""
    parts = z.split("_", 1)
    if len(parts) == 2:
        return parts[0], parts[1]
    return z, ""


def _aggregate_items_by_zone(rows):
    """Group items rows by their zone key → {zone_key: [items]}."""
    by_zone = {}
    for item in rows:
        by_zone.setdefault(item.get("zone"), []).append(item)
    return by_zone


class UpdateQtyReq(BaseModel):
    item_id: str
    scanned_qty: int

# ================= 1. 取得該區特定任務碼的當前任務 =================
@router.get("/task/{zone}/{task_code}")
async def get_task(zone: str, task_code: str):
    # 🌟 巧妙融合：將 zone 和 task_code 結合成一個字串存入資料庫，無需修改 DB 欄位結構
    task_zone_key = f"{zone.lower().replace(' ', '')}_{task_code}"

    # 🚀 只攞未歸檔嘅 active task,已歸檔嘅當「無此任務」處理
    task_res = (
        supabase.table("inspection_tasks")
        .select("*")
        .eq("zone", task_zone_key)
        .eq("archived", False)
        .execute()
    )
    if not task_res.data:
        return {"status": "no_task"}

    items_res = supabase.table("inspection_items").select("*").eq("zone", task_zone_key).order("seq").execute()

    return {
        "status": "success",
        "task": {
            "filename": task_res.data[0]["filename"],
            "items": items_res.data
        }
    }

# ================= 2. 上傳 PDF 並生成 5 位數任務碼 =================
@router.post("/upload/{zone}")
async def upload_inspection_pdf(zone: str, file: UploadFile = File(...)):
    zone_key = zone.lower().replace(" ", "")
    valid_zones = ["anymall", "hellobear", "yummy", "homey"]
    if zone_key not in valid_zones:
        raise HTTPException(status_code=400, detail="未知的區域")

    try:
        # 讀取檔案至記憶體
        file_bytes = await file.read()
        pdf_file = io.BytesIO(file_bytes)
        reader = PdfReader(pdf_file)

        # 🌟 生成 5 位數任務碼
        task_code = str(random.randint(10000, 99999))
        task_zone_key = f"{zone_key}_{task_code}"

        items_dict = {} 
        seq_counter = 1 

        # 解析 PDF
        for page in reader.pages:
            text = page.extract_text()
            if not text or not text.strip(): continue

            raw_lines = [line.strip() for line in text.split('\n') if line.strip()]
            lines = [l for l in raw_lines if not l.startswith("[Image")]
            if not lines: continue

            p_no = lines[0] if lines else "Unknown"

            qty_line_idx = -1
            qty = 1
            for idx, line in enumerate(lines):
                if ".0000" in line:
                    qty_line_idx = idx
                    match = re.search(r"(\d+)\s*\.0000", line)
                    if match and int(match.group(1)) > 0:
                        qty = int(match.group(1))
                    elif idx > 0 and lines[idx-1].strip().isdigit():
                        qty = int(lines[idx-1].strip())
                        qty_line_idx = idx - 1
                    break

            p_name = ""
            if qty_line_idx > 1:
                p_name = " ".join(lines[1:qty_line_idx])
            elif len(lines) > 1 and qty_line_idx == -1:
                p_name = lines[1]

            # 條碼萃取與淨化邏輯
            barcode_val = ""
            if qty_line_idx != -1 and qty_line_idx < len(lines) - 1:
                raw_lines_after_qty = lines[qty_line_idx+1:]
                raw_text = "".join(raw_lines_after_qty)
                star_match = re.search(r'\*(.*?)\*', raw_text)
                
                if star_match:
                    extracted = star_match.group(1)
                    # 🌟 修正：只移除空白，保留橫線 (-)
                    clean_extracted = re.sub(r'[\s]', '', extracted)
                    clean_extracted = re.sub(r'\(?N/?A\)?', '', clean_extracted, flags=re.IGNORECASE)
                    if clean_extracted:
                        barcode_val = clean_extracted
                else:
                     # 🌟 修正：只移除空白，保留橫線 (-)
                     fallback_text = re.sub(r'[\s]', '', raw_text)
                     fallback_text = re.sub(r'\(?N/?A\)?', '', fallback_text, flags=re.IGNORECASE)
                     # 🌟 修正：允許匹配橫線 (-)
                     fallback_match = re.search(r'[A-Za-z0-9\-]{5,}', fallback_text)
                     if fallback_match:
                         barcode_val = fallback_match.group(0)

            if not barcode_val or barcode_val.strip().upper() in ["N/A", "(N/A)", "NA", "-"] or len(barcode_val) < 4: 
                barcode_val = p_no

            if p_no in items_dict:
                items_dict[p_no]["Target_Qty"] += qty
                items_dict[p_no]["is_duplicate"] = True
            else:
                items_dict[p_no] = {
                    "id": str(uuid.uuid4()), 
                    "zone": task_zone_key,  # 🌟 寫入專屬任務碼區塊
                    "seq": seq_counter,   
                    "Product_No": p_no,
                    "Name": p_name,
                    "Target_Qty": qty,    
                    "Scanned_Qty": 0,     
                    "Barcode": barcode_val,
                    "Status": "pending",
                    "is_duplicate": False  
                }
                seq_counter += 1 

        items_list = list(items_dict.values())
        
        # 寫入資料庫 (改用 insert 以支援同一區域有多個任務)
        supabase.table("inspection_tasks").insert({"zone": task_zone_key, "filename": file.filename}).execute()
        
        if items_list:
            supabase.table("inspection_items").insert(items_list).execute()

        # 核心防護：釋放記憶體
        del file_bytes
        del pdf_file
        del reader
        gc.collect() 

        # 🌟 回傳 task_code 給前端
        return {"status": "success", "task_code": task_code, "task": {"filename": file.filename, "items": items_list}}

    except Exception as e:
        gc.collect() 
        raise HTTPException(status_code=500, detail=f"PDF 解析或資料庫寫入失敗: {str(e)}")


# ================= 3. 員工更新數量 =================
@router.post("/update/{zone}")
async def update_qty(zone: str, req: UpdateQtyReq):
    res = supabase.table("inspection_items").select("*").eq("id", req.item_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="找不到該商品")
        
    item = res.data[0]
    
    new_scanned = min(req.scanned_qty, item["Target_Qty"])
    
    if new_scanned >= item["Target_Qty"]:
        new_status = "completed"
    elif new_scanned > 0:
        new_status = "partial"
    else:
        new_status = "pending"
        
    updated_data = {
        "Scanned_Qty": new_scanned,
        "Status": new_status
    }
    supabase.table("inspection_items").update(updated_data).eq("id", req.item_id).execute()
    
    item["Scanned_Qty"] = new_scanned
    item["Status"] = new_status
    
    return {"status": "success", "item": item}


# ================= 4. 結案任務(改成 archive,保留歷史) =================
@router.post("/clear/{zone}/{task_code}")
async def clear_task(zone: str, task_code: str):
    """🌟 改成「歸檔」而唔係硬刪 — 員工可以喺歷史紀錄揾返。
    items 完全保留,只係 task row 標記 archived=true。
    """
    task_zone_key = f"{zone.lower().replace(' ', '')}_{task_code}"
    supabase.table("inspection_tasks").update({
        "archived": True,
        "archived_at": datetime.now(timezone.utc).isoformat(),
    }).eq("zone", task_zone_key).execute()
    return {"status": "success", "message": "任務已結案並歸檔,可喺歷史紀錄揾返"}


# ================= 5. Dashboard:所有區進行緊嘅任務 summary =================
def _fetch_items_paginated(zone_keys, chunk_size=1000):
    """🛡️ 避開 Supabase 預設嘅 1000 row 限制 — 分頁 fetch 直至冇新資料。"""
    all_items = []
    offset = 0
    while True:
        res = (
            supabase.table("inspection_items")
            .select("zone, Target_Qty, Scanned_Qty")
            .in_("zone", zone_keys)
            .range(offset, offset + chunk_size - 1)
            .execute()
        )
        chunk = res.data or []
        all_items.extend(chunk)
        if len(chunk) < chunk_size:
            break
        offset += chunk_size
        if offset > 200000:  # safety stop
            break
    return all_items


@router.get("/active-summary")
async def get_active_summary():
    """🚀 InspectionHub Dashboard 用 — 一次過攞所有 zone 嘅 active task 進度。
    用 select("*") 避免 column-not-exist 嘅 500 error,Python 入面再 sort。
    Items 分頁 fetch,避免大任務(>1000 SKU)被截斷出 0/0。
    """
    tasks_res = (
        supabase.table("inspection_tasks")
        .select("*")
        .eq("archived", False)
        .execute()
    )

    result = {z: [] for z in VALID_ZONES}
    if not tasks_res.data:
        return {"zones": result}

    active_zone_keys = [t["zone"] for t in tasks_res.data]
    all_items = _fetch_items_paginated(active_zone_keys)
    items_by_zone = _aggregate_items_by_zone(all_items)

    # Python 入面 sort(by created_at desc,冇就用空字串)
    tasks_sorted = sorted(
        tasks_res.data,
        key=lambda t: t.get("created_at") or "",
        reverse=True,
    )

    legacy_zone_keys = []  # 🌟 舊版任務(冇 5 位數 task code,無法經 UI 開返)
    for task in tasks_sorted:
        zone_key = task["zone"]
        zone_name, task_code = _parse_zone_key(zone_key)
        if zone_name not in result:
            continue
        if not task_code:
            # 舊版 task — 收集起來,等 frontend 一鍵清理
            legacy_zone_keys.append(zone_key)
            continue
        items = items_by_zone.get(zone_key, [])
        total_target = sum((i.get("Target_Qty") or 0) for i in items)
        total_scanned = sum((i.get("Scanned_Qty") or 0) for i in items)
        result[zone_name].append({
            "zone_key": zone_key,  # 🌟 直接給前端用做唯一識別 + delete key
            "task_code": task_code,
            "filename": task.get("filename"),
            "items_count": len(items),
            "total_target": total_target,
            "total_scanned": total_scanned,
            "is_completed": total_target > 0 and total_target == total_scanned,
            "created_at": task.get("created_at"),
        })

    return {"zones": result, "legacy_zone_keys": legacy_zone_keys}


# ================= 5b. 真‧批量刪除(徹底清除,連 items 都唔留低)=================
class DeleteBatchReq(BaseModel):
    task_keys: list[str]  # ["yummy_20052", "homey_42309", ...]


@router.post("/delete-batch")
async def delete_batch(req: DeleteBatchReq):
    """🗑️ 同 archive 唔同 — 呢個係真‧硬刪,清晒 tasks + items table。
    用嚟清理空任務 / 員工試嘢留低嘅垃圾 task。
    """
    keys = [k.strip() for k in (req.task_keys or []) if k and "_" in k]
    if not keys:
        return {"deleted": 0, "message": "冇任務 keys"}

    # 安全檢查 — 唔畀 SQL injection 之類嘅嘢
    for k in keys:
        zone_name, _ = _parse_zone_key(k)
        if zone_name not in VALID_ZONES:
            raise HTTPException(status_code=400, detail=f"無效 zone key: {k}")

    # 分批刪除(避免 .in_() 太長 URL)
    chunk_size = 50
    deleted_tasks = 0
    deleted_items = 0
    for i in range(0, len(keys), chunk_size):
        chunk = keys[i:i + chunk_size]
        items_del = supabase.table("inspection_items").delete().in_("zone", chunk).execute()
        tasks_del = supabase.table("inspection_tasks").delete().in_("zone", chunk).execute()
        deleted_items += len(items_del.data or [])
        deleted_tasks += len(tasks_del.data or [])

    return {
        "deleted_tasks": deleted_tasks,
        "deleted_items": deleted_items,
        "message": f"刪除咗 {deleted_tasks} 個任務 + {deleted_items} 條 items",
    }


# ================= 6. History list(歷史檢測記錄)=================
@router.get("/history")
async def get_history(zone: str = None, limit: int = 100):
    """🚀 歷史檢測記錄頁用 — 列出已歸檔嘅任務 summary。
    zone:'anymall' / 'hellobear' / 'yummy' / 'homey' / None(全部)
    """
    query = (
        supabase.table("inspection_tasks")
        .select("*")
        .eq("archived", True)
        .order("archived_at", desc=True)
        .limit(limit)
    )
    if zone and zone.lower() in VALID_ZONES:
        query = query.like("zone", f"{zone.lower()}_%")

    tasks_res = query.execute()
    if not tasks_res.data:
        return {"history": []}

    archived_zone_keys = [t["zone"] for t in tasks_res.data]
    items_res = (
        supabase.table("inspection_items")
        .select("zone, Target_Qty, Scanned_Qty")
        .in_("zone", archived_zone_keys)
        .execute()
    )
    items_by_zone = _aggregate_items_by_zone(items_res.data or [])

    history = []
    for task in tasks_res.data:
        zone_key = task["zone"]
        zone_name, task_code = _parse_zone_key(zone_key)
        items = items_by_zone.get(zone_key, [])
        history.append({
            "task_code": task_code,
            "zone": zone_name,
            "filename": task.get("filename"),
            "items_count": len(items),
            "total_target": sum((i.get("Target_Qty") or 0) for i in items),
            "total_scanned": sum((i.get("Scanned_Qty") or 0) for i in items),
            "created_at": task.get("created_at"),
            "archived_at": task.get("archived_at"),
        })
    return {"history": history}


# ================= 7. History detail(睇返一個已歸檔任務嘅完整 items)=================
@router.get("/history/{zone}/{task_code}")
async def get_history_detail(zone: str, task_code: str):
    task_zone_key = f"{zone.lower().replace(' ', '')}_{task_code}"
    task_res = (
        supabase.table("inspection_tasks")
        .select("*")
        .eq("zone", task_zone_key)
        .eq("archived", True)
        .execute()
    )
    if not task_res.data:
        raise HTTPException(status_code=404, detail="找不到呢個歸檔任務")
    items_res = (
        supabase.table("inspection_items")
        .select("*")
        .eq("zone", task_zone_key)
        .order("seq")
        .execute()
    )
    return {
        "task": task_res.data[0],
        "items": items_res.data or [],
    }