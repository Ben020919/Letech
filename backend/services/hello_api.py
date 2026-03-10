from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from pypdf import PdfReader, PdfWriter
import re
import io
import os
import asyncio
import barcode
from barcode.writer import ImageWriter
import uuid
import gc

try:
    from services.stats_api import log_action
except ImportError:
    def log_action(name): pass

router = APIRouter()
PDF_OUT_DIR = "generated_pdfs"
os.makedirs(PDF_OUT_DIR, exist_ok=True)

# 🌟 5分鐘後自動毀滅任務 (釋放空間)
async def delete_file_later(file_path: str):
    await asyncio.sleep(300)
    if os.path.exists(file_path):
        try: os.remove(file_path)
        except: pass
    gc.collect()

def generate_barcode_b64(data: str):
    try:
        Code128 = barcode.get_barcode_class('code128')
        rv = io.BytesIO()
        Code128(data, writer=ImageWriter()).write(rv, options={"write_text": False, "module_height": 10.0, "quiet_zone": 1.0})
        import base64
        b64 = base64.b64encode(rv.getvalue()).decode("utf-8")
        return f"data:image/png;base64,{b64}"
    except: return ""

def create_hellobear_label_html(barcode_val, p_name, qty):
    barcode_img_src = generate_barcode_b64(barcode_val)
    single_label = f"""
    <div style="width: 70mm; height: 50mm; box-sizing: border-box; page-break-after: always; display: flex; flex-direction: column; justify-content: center; align-items: center; padding-top: 3mm; overflow: hidden; text-align: center;">
        <img src="{barcode_img_src}" style="height: 22mm; width: 90%; object-fit: contain;">
        <div style="font-family: monospace; font-weight: bold; font-size: 14pt; margin-top: 2px; letter-spacing: 1px; color: black;">{barcode_val}</div>
        <div style="font-size: 8pt; font-weight: bold; margin-top: 6px; width: 95%; word-wrap: break-word; line-height: 1.2; color: black;">{p_name}</div>
    </div>"""
    return f"<html><head><style>@page {{ size: 70mm 50mm; margin: 0; }} body {{ margin: 0; padding: 0; background-color: white; }}</style></head><body>{single_label * qty}</body></html>"

def process_hellobear_pdf(file_bytes):
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
            
        # ==========================================
        # 🌟 究極防禦版：條碼萃取與淨化邏輯
        # ==========================================
        barcode_val = ""
        
        # 1. 取得數量行之後的所有文字
        if qty_line_index != -1 and qty_line_index < len(lines) - 1:
            raw_lines_after_qty = lines[qty_line_index+1:]
            
            # 2. 將這些行合併成一個字串
            raw_text = "".join(raw_lines_after_qty)
            
            # 3. 尋找被星星包圍的內容 (例如 *12345* 或 ** )
            # 這裡不先去空白，以免破壞原有結構，直接用正則抓星星裡面的東西
            star_match = re.search(r'\*(.*?)\*', raw_text)
            
            if star_match:
                extracted = star_match.group(1)
                # 4. 針對抓出來的內容進行暴力清洗
                # 清除：空格、減號、N/A、(N/A)、NA
                clean_extracted = re.sub(r'[\s\-]', '', extracted) # 清除空白和減號
                clean_extracted = re.sub(r'\(?N/?A\)?', '', clean_extracted, flags=re.IGNORECASE) # 清除各種形式的 NA
                
                # 5. 驗證清洗後的結果
                # 如果清洗後還有東西（代表是真正的條碼），才賦值給 barcode_val
                if clean_extracted:
                    barcode_val = clean_extracted
            else:
                # 6. 如果連星星都沒找到，我們試著在剩餘的文字中尋找長度夠長的純數字/英數字串，當作最後的掙扎
                 fallback_text = re.sub(r'[\s\-]', '', raw_text)
                 fallback_text = re.sub(r'\(?N/?A\)?', '', fallback_text, flags=re.IGNORECASE)
                 
                 # 尋找連續的英數字元，長度大於等於5 (避免抓到零星的殘留字元)
                 fallback_match = re.search(r'[A-Za-z0-9]{5,}', fallback_text)
                 if fallback_match:
                     barcode_val = fallback_match.group(0)


        # 🌟 絕對防線：如果經歷了上面的重重關卡，barcode_val 還是空的
        # 或者它短得不可思議 (例如只剩一個殘留的符號)，就強制變成 Product_No！
        if not barcode_val or len(barcode_val) < 4: 
            barcode_val = p_no

        if p_no not in product_no_tracker: product_no_tracker[p_no] = []
        product_no_tracker[p_no].append(i + 1)
        
        needs_print = False
        if barcode_val:
            if re.search(r'[A-Za-z]', barcode_val):
                needs_print = True
                
        data_status = 'print' if needs_print else 'no_print'
        final_html = create_hellobear_label_html(barcode_val, p_name, qty) if needs_print else ""

        temp_items.append({
            "id": f"{p_no}_{i}", "Product_No": p_no, "Name": p_name,
            "Barcode": barcode_val, "Qty": qty, "Date": "N/A",
            "status": data_status, "print_html": final_html 
        })

    out_filename = f"hellobear_{uuid.uuid4().hex}.pdf"
    out_path = os.path.join(PDF_OUT_DIR, out_filename)
    with open(out_path, "wb") as f: writer.write(f)
    return temp_items, product_no_tracker, out_filename

@router.post("/upload")
async def upload_hellobear_pdf(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    try:
        file_bytes = await file.read()
        items, tracker, out_filename = await asyncio.to_thread(process_hellobear_pdf, file_bytes)
        
        # 釋放記憶體
        del file_bytes
        gc.collect()

        out_path = os.path.join(PDF_OUT_DIR, out_filename)
        background_tasks.add_task(delete_file_later, out_path)

        duplicates = [{"Product_No": k, "Count": len(v), "Pages": ", ".join(map(str, v))} for k, v in tracker.items() if len(v) > 1]
        log_action("HelloBear_Upload")
        
        return {
            "status": "success", "items": items, "duplicates": duplicates,
            "summary": {"total_pages": len(items), "has_duplicates": len(duplicates) > 0},
            "download_url": f"/generated_pdfs/{out_filename}"
        }
    except Exception as e: 
        gc.collect()
        raise HTTPException(status_code=500, detail=str(e))