from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
from pypdf import PdfReader
import io
import re
import uuid
import os
import gc
import random  # 🌟 新增：用於生成 5 位數任務碼
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("缺少 SUPABASE_URL 或 SUPABASE_KEY 環境變數")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
router = APIRouter()

class UpdateQtyReq(BaseModel):
    item_id: str
    scanned_qty: int

# ================= 1. 取得該區特定任務碼的當前任務 =================
@router.get("/task/{zone}/{task_code}")
async def get_task(zone: str, task_code: str):
    # 🌟 巧妙融合：將 zone 和 task_code 結合成一個字串存入資料庫，無需修改 DB 欄位結構
    task_zone_key = f"{zone.lower().replace(' ', '')}_{task_code}"
    
    task_res = supabase.table("inspection_tasks").select("*").eq("zone", task_zone_key).execute()
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


# ================= 4. 清除/完成任務 =================
@router.post("/clear/{zone}/{task_code}")
async def clear_task(zone: str, task_code: str):
    task_zone_key = f"{zone.lower().replace(' ', '')}_{task_code}"
    supabase.table("inspection_tasks").delete().eq("zone", task_zone_key).execute()
    supabase.table("inspection_items").delete().eq("zone", task_zone_key).execute()
    return {"status": "success", "message": "任務已結案並從雲端清除"}