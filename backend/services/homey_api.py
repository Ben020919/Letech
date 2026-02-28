from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from pypdf import PdfReader, PdfWriter
import pandas as pd
import re
import io
import os
import asyncio
import base64
import uuid
import gc
import barcode
from barcode.writer import ImageWriter
# 🌟 統一借大腦，不自己建立 cache
from services.master_api import load_master_db

try:
    from services.stats_api import log_action
except ImportError:
    def log_action(name): pass

router = APIRouter()
DATA_DIR = "data"
PDF_OUT_DIR = "generated_pdfs"
DEFAULT_FONT_PATH = os.path.join(DATA_DIR, "font.ttf")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(PDF_OUT_DIR, exist_ok=True)

# 🌟 20分鐘後自動毀滅任務
async def delete_file_later(file_path: str):
    await asyncio.sleep(1200)
    if os.path.exists(file_path):
        try: os.remove(file_path)
        except: pass
    gc.collect()

def clean_val(val):
    if pd.isna(val) or str(val).lower() == 'nan': return ""
    return str(val).strip()

def get_nutri_val(data, key):
    val = data.get(key)
    if pd.isna(val) or str(val).lower() == 'nan': return "0"
    return str(val).strip()

def font_to_base64_css(font_path):
    if not os.path.exists(font_path): return ""
    try:
        with open(font_path, "rb") as f:
            b64_str = base64.b64encode(f.read()).decode('utf-8')
        return f"@font-face {{ font-family: 'CustomLabelFont'; src: url(data:font/ttf;base64,{b64_str}) format('truetype'); font-weight: bold; font-style: normal; }} body, .label-container, div, span {{ font-family: 'CustomLabelFont', Helvetica, Arial, sans-serif !important; }}"
    except: return ""

def generate_barcode_b64(data: str):
    try:
        Code128 = barcode.get_barcode_class('code128')
        rv = io.BytesIO()
        Code128(data, writer=ImageWriter()).write(rv, options={"write_text": False, "module_height": 10.0, "quiet_zone": 1.0})
        b64 = base64.b64encode(rv.getvalue()).decode("utf-8")
        return f"data:image/png;base64,{b64}"
    except: return ""

def create_homey_repack_label_html(p_name, barcode_val, qty):
    barcode_img_src = generate_barcode_b64(barcode_val)
    single_label = f"""
    <div style="width: 70mm; height: 50mm; box-sizing: border-box; page-break-after: always; display: flex; flex-direction: column; justify-content: center; align-items: center; padding-top: 3mm; overflow: hidden; text-align: center;">
        <img src="{barcode_img_src}" style="height: 18mm; width: 90%; object-fit: contain;">
        <div style="font-family: monospace; font-weight: bold; font-size: 14pt; margin-top: 2px; letter-spacing: 1px; color: black;">{barcode_val}</div>
        <div style="font-size: 10pt; font-weight: bold; margin-top: 6px; width: 95%; word-wrap: break-word; line-height: 1.2; color: black;">{p_name}</div>
    </div>"""
    return f"<html><head><style>@page {{ size: 70mm 50mm; margin: 0; }} body {{ margin: 0; padding: 0; background-color: white; }}</style></head><body>{single_label * qty}</body></html>"

def create_insects_label_html(matched_data, qty):
    data = matched_data if matched_data else {}
    barcode = clean_val(data.get('Barcode', ''))         
    desc = clean_val(data.get('Description', ''))        
    features = clean_val(data.get('FEATURES', ''))       
    cautions = clean_val(data.get('Cautions', ''))       
    net_content = clean_val(data.get('Net Content', '')) 
    if not net_content: net_content = clean_val(data.get('Net_Content', ''))
    ingredients = clean_val(data.get('Ingredients', '')) 
    warnings = clean_val(data.get('警告字眼', ''))         
    
    single_label_html = f"""
    <div class="label-box" style="width: 70mm; height: 50mm; box-sizing: border-box; padding: 3mm 4mm; overflow: hidden; background-color: white; color: black; font-size: 4pt; line-height: 1.1; page-break-after: always;">
        <div style="margin-bottom: 6pt; word-wrap: break-word; font-weight: bold; min-height: 6pt;">
            <div>{barcode}</div>
            <div>{desc}</div>
        </div>
        <div style="margin-bottom: 6pt; word-wrap: break-word; font-weight: bold; min-height: 6pt;">{features}</div>
        <div style="margin-bottom: 6pt; word-wrap: break-word; font-weight: bold; min-height: 6pt;">{cautions}</div>
        <div style="margin-bottom: 6pt; word-wrap: break-word; font-weight: bold; min-height: 6pt;">{net_content}</div>
        <div style="margin-bottom: 6pt; word-wrap: break-word; font-weight: bold; min-height: 6pt;">{ingredients}</div>
        <div style="word-wrap: break-word; font-weight: bold; min-height: 6pt;">{warnings}</div>
    </div>
    """
    return f"<html><head><style>@page {{ size: 70mm 50mm; margin: 0; }} body {{ margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: white;}}</style></head><body>{single_label_html * qty}</body></html>"

def create_food_label_html(item_name, barcode_text, matched_data, qty):
    data = matched_data if matched_data else {}
    excel_name = clean_val(data.get('Name', ''))
    if not excel_name: excel_name = clean_val(data.get('Description', ''))
    desc_text = excel_name if excel_name else item_name
    
    b_text = barcode_text if barcode_text and barcode_text != "(N/A)" else clean_val(data.get('Barcode', ''))

    nutri = {
        'Serving_Size': get_nutri_val(data, 'Serving_Size'),
        'Energy': get_nutri_val(data, 'Energy'),
        'Protein': get_nutri_val(data, 'Protein'),
        'Total_Fat': get_nutri_val(data, 'Total_Fat'),
        'Sat_Fat': get_nutri_val(data, 'Sat_Fat'),
        'Trans_Fat': get_nutri_val(data, 'Trans_Fat'),
        'Carb': get_nutri_val(data, 'Carb'),
        'Sugar': get_nutri_val(data, 'Sugar'),
        'Sodium': get_nutri_val(data, 'Sodium'),
        'Net_Content': get_nutri_val(data, 'Net_Content') or get_nutri_val(data, 'Net Content'),
        'Country_Of_Origin': get_nutri_val(data, 'Country_Of_Origin'),
    }
    ing_text = clean_val(data.get('Ingredients', ''))
    mfr_text = f"{clean_val(data.get('Madeby_Prefix', ''))} {clean_val(data.get('Madeby', ''))}".strip()
    if mfr_text and "Manufacturer" not in mfr_text: mfr_text = "Manufacturer: " + mfr_text

    single_label_html = f"""
    <div class="label-container" style="width: 70mm; height: 50mm; position: relative; box-sizing: border-box; border: 1px solid #ddd; page-break-after: always; overflow: hidden; font-weight: bold;">
        <div class="barcode-text" style="position: absolute; left: 2mm; top: 2mm; font-size: 5pt; font-weight: bold;">{b_text}</div>
        <div class="desc-text" style="position: absolute; left: 2mm; top: 4.5mm; width: 59mm; font-size: 5pt; line-height: 1.2; font-weight: bold;">{desc_text}</div>
        <div class="line1" style="position: absolute; left: 0; top: 9mm; width: 70mm; border-top: 1.42pt solid black;"></div>
        <div class="nutri-box" style="position: absolute; left: 2mm; top: 10mm; width: 23mm; font-size: 3.5pt; line-height: 4.5pt; font-weight: bold;">
            <div class="nutri-title" style="font-weight: bold; margin-bottom: 1px;">Nutrition Information</div>
            <div style="display: flex; justify-content: space-between;"><span>Serving Size:</span><span>{nutri['Serving_Size']}</span></div>
            <div style="display: flex; justify-content: space-between;"><span>Energy:</span><span>{nutri['Energy']}</span></div>
            <div style="display: flex; justify-content: space-between;"><span>Protein:</span><span>{nutri['Protein']}</span></div>
            <div style="display: flex; justify-content: space-between;"><span>Total fat:</span><span>{nutri['Total_Fat']}</span></div>
            <div style="display: flex; justify-content: space-between; padding-left: 3px;"><span>- Saturated fat:</span><span>{nutri['Sat_Fat']}</span></div>
            <div style="display: flex; justify-content: space-between; padding-left: 3px;"><span>- Trans fat:</span><span>{nutri['Trans_Fat']}</span></div>
            <div style="display: flex; justify-content: space-between;"><span>Carbohydrates:</span><span>{nutri['Carb']}</span></div>
            <div style="display: flex; justify-content: space-between; padding-left: 3px;"><span>- Sugars:</span><span>{nutri['Sugar']}</span></div>
            <div style="display: flex; justify-content: space-between;"><span>Sodium:</span><span>{nutri['Sodium']}</span></div>
            <div style="display: flex; justify-content: space-between;"><span>Net Content:</span><span>{nutri['Net_Content']}</span></div>
            <div style="display: flex; justify-content: space-between;"><span>Country Of Origin:</span><span>{nutri['Country_Of_Origin']}</span></div>
        </div>
        <div class="vline" style="position: absolute; left: 26mm; top: 9mm; height: 29mm; border-left: 1.42pt solid black;"></div>
        <div class="ing-box" style="position: absolute; left: 27mm; top: 10mm; width: 41mm; height: 28mm; font-size: 3.5pt; line-height: 1.1; overflow: hidden; text-align: justify; font-weight: bold;">Ingredients: {ing_text}</div>
        <div class="line2" style="position: absolute; left: 0; top: 38mm; width: 70mm; border-top: 1.42pt solid black;"></div>
        <div class="mfr-box" style="position: absolute; left: 2mm; top: 40mm; width: 35mm; font-size: 4.76pt; line-height: 1.2; font-weight: bold;">{mfr_text}</div>
        <div class="bb-box" style="position: absolute; left: 47mm; top: 40mm; width: 27mm; font-size: 4.2pt; line-height: 1.2; font-weight: bold; white-space: nowrap;">Best before(Date Format):<br>Show on package(見包裝)<br>此日期前最佳(Format CHI)</div>
    </div>
    """
    return f"<html><head><style>/* FONT_CSS_PLACEHOLDER */ @page {{ size: auto; margin: 0mm; }} body {{ margin: 0; padding: 0; font-family: Helvetica, Arial, sans-serif; }}</style></head><body>{single_label_html * qty}</body></html>"


def process_homey_pdf(file_bytes):
    pdf_file = io.BytesIO(file_bytes)
    reader = PdfReader(pdf_file)
    writer = PdfWriter()
    temp_items = []
    product_no_tracker = {}
    df_master = load_master_db()
    
    for i, page in enumerate(reader.pages):
        text = page.extract_text()
        clean_text = re.sub(r'\[Image \d+\]', '', text).strip()
        if not clean_text: continue
        writer.add_page(page)
        
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        lines = [l for l in lines if not l.startswith("[Image")]
        if not lines: continue
        
        p_no = lines[0].strip() if lines else "Unknown"
        
        qty = 1
        qty_line_index = -1
        for idx, line in enumerate(lines):
            if ".0000" in line:
                qty_line_index = idx
                match_inline = re.search(r"(\d+)\s*\.0000", line)
                if match_inline and int(match_inline.group(1)) > 0:
                    qty = int(match_inline.group(1))
                elif idx > 0:
                    prev_line = lines[idx-1].strip()
                    if prev_line.isdigit():
                        qty = int(prev_line)
                        qty_line_index = idx - 1
                    else:
                        match_end = re.search(r"\s+(\d+)$", prev_line)
                        if match_end:
                            qty = int(match_end.group(1))
                            lines[idx-1] = prev_line[:match_end.start()].strip()
                            qty_line_index = idx - 1
                break
        
        p_name = ""
        if qty_line_index > 1:
            p_name = " ".join(lines[1:qty_line_index])
        elif len(lines) > 1 and qty_line_index == -1:
            name_parts = []
            for line in lines[1:]:
                if re.search(r"\d+\.0000|\b\d{12,14}\b", line): break
                name_parts.append(line)
            p_name = " ".join(name_parts)
            
        barcode_val = ""
        search_start = qty_line_index + 1 if qty_line_index != -1 else 0
        candidate_lines = lines[search_start:]
        for line in candidate_lines:
            if "N/A" in line or "PAGE" in line.upper() or "Page" in line: continue
            clean_line = re.sub(r'[\s\*]', '', line)
            if "*" in line:
                barcode_val = clean_line
                break
            if clean_line.isdigit() and 12 <= len(clean_line) <= 15:
                barcode_val = clean_line
                break
            if clean_line == p_no or clean_line == p_no.replace("-", ""):
                barcode_val = clean_line
                break
        
        excel_label = ""
        matched_data = {}
        if df_master is not None and not df_master.empty:
            match_col = 'Product_No' if 'Product_No' in df_master.columns else 'ProductCode'
            if match_col not in df_master.columns and 'Product No' in df_master.columns: match_col = 'Product No'
                
            if match_col in df_master.columns:
                matches = df_master[df_master[match_col].astype(str).str.strip() == p_no]
                if not matches.empty:
                    matched_data = matches.iloc[0].fillna("").to_dict()
                    if 'Label_Type' in matched_data: excel_label = str(matched_data.get('Label_Type'))
                    elif 'Label Type' in matched_data: excel_label = str(matched_data.get('Label Type'))
                        
        final_label = "普通Label"
        excel_label_lower = excel_label.lower()
        
        if "food" in excel_label_lower: 
            final_label = "Food Label"
        elif "蟲" in excel_label or "insect" in excel_label_lower: 
            final_label = "蟲蟲Label"
        elif (barcode_val and barcode_val[-1].isalpha()) or (not barcode_val or barcode_val.strip() == "" or barcode_val == p_no or barcode_val == "(N/A)"): 
            final_label = "Repack Lable"
        else: 
            final_label = "普通Label"
            
        final_html = ""
        needs_print = False
        
        if final_label == "Food Label":
            needs_print = True
            final_html = create_food_label_html(p_name, barcode_val, matched_data, qty)
        elif final_label == "蟲蟲Label": 
            needs_print = True
            final_html = create_insects_label_html(matched_data, qty)
        elif final_label == "Repack Lable":
            needs_print = True
            print_barcode = p_no if not barcode_val or barcode_val == "(N/A)" else barcode_val
            final_html = create_homey_repack_label_html(p_name, print_barcode, qty)
            
        data_status = 'print' if needs_print else 'no_print'

        if p_no not in product_no_tracker: product_no_tracker[p_no] = []
        product_no_tracker[p_no].append(i + 1)

        temp_items.append({
            "id": f"{p_no}_{i}", "Product_No": p_no, "Name": p_name,
            "Barcode": barcode_val if barcode_val else "(N/A)", "Qty": qty, "Date": "N/A",
            "status": data_status, "print_html": final_html, "label_type": final_label
        })

    out_filename = f"homey_{uuid.uuid4().hex}.pdf"
    out_path = os.path.join(PDF_OUT_DIR, out_filename)
    with open(out_path, "wb") as f: writer.write(f)
    return temp_items, product_no_tracker, out_filename

@router.post("/upload")
async def upload_homey_pdf(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    try:
        file_bytes = await file.read()
        items, tracker, out_filename = await asyncio.to_thread(process_homey_pdf, file_bytes)
        
        # 🌟 釋放記憶體
        del file_bytes
        gc.collect()

        # 🌟 註冊背景任務
        out_path = os.path.join(PDF_OUT_DIR, out_filename)
        background_tasks.add_task(delete_file_later, out_path)

        duplicates = [{"Product_No": k, "Count": len(v), "Pages": ", ".join(map(str, v))} for k, v in tracker.items() if len(v) > 1]
        log_action("Homey_Upload")
        
        font_css = font_to_base64_css(DEFAULT_FONT_PATH)
        
        return {
            "status": "success", "items": items, "duplicates": duplicates,
            "summary": {"total_pages": len(items), "has_duplicates": len(duplicates) > 0},
            "download_url": f"/generated_pdfs/{out_filename}", "font_css": font_css
        }
    except Exception as e: 
        gc.collect()
        raise HTTPException(status_code=500, detail=str(e))