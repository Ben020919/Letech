from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from pypdf import PdfReader, PdfWriter
import re
import io
import os
import asyncio
import uuid
import gc
from services.pdf_core import delete_file_later, generate_barcode_b64

router = APIRouter()
PDF_OUT_DIR = "generated_pdfs"
os.makedirs(PDF_OUT_DIR, exist_ok=True)

def create_anymall_label_html(barcode_val, qty):
    barcode_img_src = generate_barcode_b64(barcode_val)
    single_label = f"""
    <div style="width: 70mm; height: 50mm; box-sizing: border-box; page-break-after: always; display: flex; flex-direction: column; justify-content: center; align-items: center; padding-top: 3mm; overflow: hidden;">
        <img src="{barcode_img_src}" style="height: 25mm; width: 90%; object-fit: contain;">
        <div style="font-family: monospace; font-weight: bold; font-size: 17pt; margin-top: 3px; letter-spacing: 1px; color: black;">{barcode_val}</div>
    </div>"""
    return f"<html><head><style>@page {{ size: 70mm 50mm; margin: 0; }} body {{ margin: 0; padding: 0; background-color: white; }}</style></head><body>{single_label * qty}</body></html>"

def process_anymall_pdf(file_bytes):
    pdf_file = io.BytesIO(file_bytes)
    reader = PdfReader(pdf_file)
    writer = PdfWriter()
    temp_items = []
    product_no_tracker = {}
    
    for i, page in enumerate(reader.pages):
        text = page.extract_text()
        if not text or not text.strip(): continue
        writer.add_page(page)
        lines = [line.strip() for line in text.strip().split('\n') if line.strip()]
        p_no = lines[0] if lines else "Unknown"
        
        qty = 1
        qty_line_index = -1
        for idx, line in enumerate(lines):
            if ".0000" in line:
                qty_line_index = idx
                match = re.search(r"(\d+)\s*\.0000", line)
                if match and int(match.group(1)) > 0: qty = int(match.group(1))
                elif idx > 0 and lines[idx-1].strip().isdigit(): 
                    qty = int(lines[idx-1].strip())
                    qty_line_index = idx - 1
                break
        
        p_name = ""
        if qty_line_index > 1: p_name = " ".join(lines[1:qty_line_index])
        elif len(lines) > 1 and qty_line_index == -1: p_name = lines[1]
            
        barcode_val = ""
        if qty_line_index != -1 and qty_line_index < len(lines) - 1:
            raw = lines[qty_line_index+1:]
            bc_text = re.sub(r'[\s\*]', '', "".join([l for l in raw if "N/A" not in l and "PAGE" not in l]))
            if bc_text: barcode_val = bc_text
        if not barcode_val: barcode_val = "(N/A)"

        if p_no not in product_no_tracker: product_no_tracker[p_no] = []
        product_no_tracker[p_no].append(i + 1)
        
        needs_print = (barcode_val and barcode_val != "(N/A)" and barcode_val == p_no)
        data_status = 'print' if needs_print else 'no_print'
        final_html = create_anymall_label_html(barcode_val, qty) if needs_print else ""

        temp_items.append({
            "id": f"{p_no}_{i}", "Product_No": p_no, "Name": p_name,
            "Barcode": barcode_val, "Qty": qty, "Date": "N/A",
            "status": data_status, "print_html": final_html 
        })

    out_filename = f"anymall_{uuid.uuid4().hex}.pdf"
    out_path = os.path.join(PDF_OUT_DIR, out_filename)
    with open(out_path, "wb") as f: writer.write(f)
    return temp_items, product_no_tracker, out_filename

@router.post("/upload")
async def upload_anymall_pdf(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    try:
        file_bytes = await file.read()
        items, tracker, out_filename = await asyncio.to_thread(process_anymall_pdf, file_bytes)
        
        # 🌟 立刻釋放巨大的變數記憶體
        del file_bytes
        gc.collect()

        # 🌟 加入自動毀滅任務
        out_path = os.path.join(PDF_OUT_DIR, out_filename)
        background_tasks.add_task(delete_file_later, out_path)

        duplicates = [{"Product_No": k, "Count": len(v), "Pages": ", ".join(map(str, v))} for k, v in tracker.items() if len(v) > 1]
        return {
            "status": "success", "items": items, "duplicates": duplicates,
            "summary": {"total_pages": len(items), "has_duplicates": len(duplicates) > 0},
            "download_url": f"/generated_pdfs/{out_filename}"
        }
    except Exception as e: 
        gc.collect() # 報錯也要清記憶體
        raise HTTPException(status_code=500, detail=str(e))