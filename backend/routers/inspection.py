from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
from pypdf import PdfReader
import io
import re
import uuid
import os
import gc  # 🌟 匯入強制記憶體回收工具
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

# ================= 1. 取得該區當前任務與明細 =================
@router.get("/task/{zone}")
async def get_task(zone: str):
    zone_key = zone.lower().replace(" ", "")
    
    task_res = supabase.table("inspection_tasks").select("*").eq("zone", zone_key).execute()
    if not task_res.data:
        return {"status": "no_task"}
        
    items_res = supabase.table("inspection_items").select("*").eq("zone", zone_key).order("seq").execute()
    
    return {
        "status": "success", 
        "task": {
            "filename": task_res.data[0]["filename"],
            "items": items_res.data
        }
    }

# ================= 2. 上傳 PDF 並寫入兩張表 (🌟 強化記憶體管理 + 完美條碼分離) =================
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

        items_dict = {} 
        seq_counter = 1 

        # 解析 PDF
        for page in reader.pages:
            text = page.extract_text()
            if not text or not text.strip(): continue

            raw_lines = [line.strip() for line in text.split('\n') if line.strip()]
            lines = [l for l in raw_lines if not l.startswith("[Image")]
            if not lines: continue

            p_no = lines[0]

            qty_line_idx = -1
            qty = 1
            for idx, line in enumerate(lines):
                if ".0000" in line:
                    qty_line_idx = idx
                    match = re.search(r"(\d+)\s*\.0000", line)
                    if match:
                        qty = int(match.group(1))
                    break

            p_name = ""
            if qty_line_idx > 1:
                p_name = " ".join(lines[1:qty_line_idx])
            elif len(lines) > 1 and qty_line_idx == -1:
                p_name = lines[1]

            # 🌟 這裡替換成全新的「神級條碼與日期分離」邏輯 🌟
            barcode_val = ""
            if qty_line_idx != -1 and qty_line_idx < len(lines) - 1:
                raw_bc_lines = lines[qty_line_idx+1:]
                # 將下方所有文字用空白拼起來，保留單字間的界線
                bc_text = " ".join(raw_bc_lines)
                
                # 1. 移除無效字元 N/A, * (不要移除空白，以保留詞的界線)
                bc_text = re.sub(r'N/A|\*', ' ', bc_text)
                
                # 2. 將字串依照空白切割成多個候選詞
                candidates = bc_text.split()
                
                for candidate in candidates:
                    candidate = candidate.strip()
                    if not candidate: continue
                    
                    # 3. 判斷並剔除常見的日期格式
                    # (a) 包含連字號或斜線的日期: 2024-03-07, 07/03/2024, 24/03/2024
                    if re.match(r'^\d{2,4}[-/]\d{1,2}[-/]\d{2,4}$', candidate):
                        continue
                    
                    # (b) 連在一起的純數字日期 (例如 20240307)，特徵是 202 開頭且剛好 8 碼
                    if re.match(r'^202\d{5}$', candidate):
                        continue
                    
                    # 4. 如果這個字串沒有被上面的日期規則濾掉，那它就是我們要的 Barcode！
                    barcode_val = candidate
                    
                    # 5. 終極防呆：如果 PDF 提取時 Barcode 和日期「沒有空格」黏在一起 
                    # 例如 48912345678902024-12-31，強制將尾巴的日期切掉
                    barcode_val = re.sub(r'(202\d[-/]\d{1,2}[-/]\d{1,2})$', '', barcode_val)
                    barcode_val = re.sub(r'(202\d{5})$', '', barcode_val)
                    break

            if barcode_val:
                barcode_val = barcode_val.rstrip('-')
            else:
                barcode_val = p_no

            if p_no in items_dict:
                items_dict[p_no]["Target_Qty"] += qty
                items_dict[p_no]["is_duplicate"] = True
            else:
                items_dict[p_no] = {
                    "id": str(uuid.uuid4()), 
                    "zone": zone_key,          
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
        
        # 寫入資料庫
        supabase.table("inspection_tasks").upsert({"zone": zone_key, "filename": file.filename}).execute()
        
        supabase.table("inspection_items").delete().eq("zone", zone_key).execute()
        if items_list:
            supabase.table("inspection_items").insert(items_list).execute()

        # 🌟 核心防護：解析完畢並寫入資料庫後，立刻釋放龐大的記憶體物件
        del file_bytes
        del pdf_file
        del reader
        gc.collect() # 🧹 呼叫清潔工清理記憶體

        return {"status": "success", "task": {"filename": file.filename, "items": items_list}}

    except Exception as e:
        gc.collect() # 🧹 即使發生錯誤，也要清空殘留的記憶體避免崩潰
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
@router.post("/clear/{zone}")
async def clear_task(zone: str):
    zone_key = zone.lower().replace(" ", "")
    supabase.table("inspection_tasks").delete().eq("zone", zone_key).execute()
    return {"status": "success", "message": "任務已結案並從雲端清除"}