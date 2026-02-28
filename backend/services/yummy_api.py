from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from pypdf import PdfReader, PdfWriter
import pandas as pd
import re
import io
import os
import asyncio
import uuid
import base64
import gc
# 🌟 統一向 master_api 借大腦
from services.master_api import load_master_db

try:
    from services.stats_api import log_action
except ImportError:
    def log_action(name): pass

DATA_DIR = "data"
PDF_OUT_DIR = "generated_pdfs"

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(PDF_OUT_DIR, exist_ok=True)

DEFAULT_FONT_PATH = os.path.join(DATA_DIR, "font.ttf")

router = APIRouter()

# 🌟 20分鐘後自動毀滅任務
async def delete_file_later(file_path: str):
    await asyncio.sleep(300)
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

def extract_date_from_text(text):
    text = text.replace('\n', ' ')
    match_compact = re.search(r"\b(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b", text)
    if match_compact: return f"{match_compact.group(1)}-{match_compact.group(2)}-{match_compact.group(3)}"
    match_dmy_slash = re.search(r"\b(0[1-9]|[12]\d|3[01])/(0[1-9]|1[0-2])/(20\d{2})\b", text)
    if match_dmy_slash: return f"{match_dmy_slash.group(3)}-{match_dmy_slash.group(2)}-{match_dmy_slash.group(1)}"
    match_standard = re.search(r"\b(20\d{2})[./-](0[1-9]|1[0-2])[./-](0[1-9]|[12]\d|3[01])\b", text)
    if match_standard: return f"{match_standard.group(1)}-{match_standard.group(2)}-{match_standard.group(3)}"
    return "未偵測到"

def font_to_base64_css(font_path):
    if not os.path.exists(font_path): return ""
    try:
        with open(font_path, "rb") as f:
            b64_str = base64.b64encode(f.read()).decode('utf-8')
        return f"@font-face {{ font-family: 'CustomLabelFont'; src: url(data:font/ttf;base64,{b64_str}) format('truetype'); font-weight: bold; font-style: normal; }} body, .label-container, div, span {{ font-family: 'CustomLabelFont', Helvetica, Arial, sans-serif !important; }}"
    except: return ""

def check_data_status(data_dict):
    if not data_dict: return 'empty'
    food_keywords = ['ingredient', 'energy', 'protein', 'fat', 'carb', 'sodium', 'serving']
    for k, v in data_dict.items():
        if any(fw in str(k).lower() for fw in food_keywords):
            val = str(v).strip().lower()
            if val and val not in ['nan', '0', 'none', '']: return 'food'
    for k, v in data_dict.items():
        if any(cw in str(k).lower() for cw in ['caution', 'warning']):
            val = str(v).strip().lower()
            if val and val not in ['nan', 'none', '']: return 'caution'
    return 'empty'

def smart_get_caution_text(data_dict):
    if 'Cautions' in data_dict: return clean_val(data_dict['Cautions'])
    for k in data_dict.keys():
        if 'caution' in k.lower() or 'warning' in k.lower(): return clean_val(data_dict[k])
    return None 

def get_best_results(results_df):
    if results_df.empty: return results_df
    scores = []
    for _, row in results_df.iterrows():
        status = check_data_status(row.to_dict())
        if status == 'food': scores.append(2)
        elif status == 'caution': scores.append(1)
        else: scores.append(0)
    results_df = results_df.copy()
    results_df['__score'] = scores
    results_df = results_df.sort_values(by='__score', ascending=False)
    target_col = 'Product_No' if 'Product_No' in results_df.columns else 'ProductCode'
    if target_col in results_df.columns:
        results_df = results_df.drop_duplicates(subset=[target_col], keep='first')
    return results_df

def create_label_html_on_the_fly(item, matched_data, qty):
    data = matched_data if matched_data else {}
    
    excel_name = clean_val(data.get('Name', ''))
    if not excel_name:
        excel_name = clean_val(data.get('Description', ''))
    
    desc_text = excel_name if excel_name else clean_val(item.get('Name', ''))
    barcode_text = item['Barcode'] if item['Barcode'] != "(N/A)" and item['Barcode'] != "未偵測到" else clean_val(data.get('Barcode', ''))
    
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
    <html><head><style>
        /* FONT_CSS_PLACEHOLDER */
        @page {{ size: auto; margin: 0mm; }}
        body {{ margin: 0; padding: 0; }}
        .label-container {{ width: 70mm; height: 50mm; position: relative; box-sizing: border-box; border: 1px solid #ddd; page-break-after: always; overflow: hidden; font-weight: bold; }}
        .barcode-text {{ position: absolute; left: 2mm; top: 2mm; font-size: 5pt; font-weight: bold; }}
        .desc-text {{ position: absolute; left: 2mm; top: 4.5mm; width: 59mm; font-size: 5pt; line-height: 1.2; font-weight: bold; }}
        .line1 {{ position: absolute; left: 0; top: 9mm; width: 70mm; border-top: 1.42pt solid black; }}
        .nutri-box {{ position: absolute; left: 2mm; top: 10mm; width: 23mm; font-size: 3.5pt; line-height: 4.5pt; font-weight: bold; }}
        .nutri-title {{ font-weight: bold; margin-bottom: 1px; }}
        .nutri-row {{ display: flex; justify-content: space-between; }}
        .indent {{ padding-left: 3px; }}
        .vline {{ position: absolute; left: 26mm; top: 9mm; height: 29mm; border-left: 1.42pt solid black; }}
        .ing-box {{ position: absolute; left: 27mm; top: 10mm; width: 41mm; height: 28mm; font-size: 3.5pt; line-height: 1.1; overflow: hidden; text-align: justify; font-weight: bold; }}
        .line2 {{ position: absolute; left: 0; top: 38mm; width: 70mm; border-top: 1.42pt solid black; }}
        .mfr-box {{ position: absolute; left: 2mm; top: 40mm; width: 35mm; font-size: 4.76pt; line-height: 1.2; font-weight: bold; }}
        .bb-box {{ position: absolute; left: 47mm; top: 40mm; width: 27mm; font-size: 4.2pt; line-height: 1.2; font-weight: bold; white-space: nowrap; }}
    </style></head><body>
        <div class="label-container">
            <div class="barcode-text">{barcode_text}</div>
            <div class="desc-text">{desc_text}</div>
            <div class="line1"></div>
            <div class="nutri-box">
                <div class="nutri-title">Nutrition Information</div>
                <div class="nutri-row"><span>Serving Size:</span><span>{nutri['Serving_Size']}</span></div>
                <div class="nutri-row"><span>Energy:</span><span>{nutri['Energy']}</span></div>
                <div class="nutri-row"><span>Protein:</span><span>{nutri['Protein']}</span></div>
                <div class="nutri-row"><span>Total fat:</span><span>{nutri['Total_Fat']}</span></div>
                <div class="nutri-row indent"><span>- Saturated fat:</span><span>{nutri['Sat_Fat']}</span></div>
                <div class="nutri-row indent"><span>- Trans fat:</span><span>{nutri['Trans_Fat']}</span></div>
                <div class="nutri-row"><span>Carbohydrates:</span><span>{nutri['Carb']}</span></div>
                <div class="nutri-row indent"><span>- Sugars:</span><span>{nutri['Sugar']}</span></div>
                <div class="nutri-row"><span>Sodium:</span><span>{nutri['Sodium']}</span></div>
                <div class="nutri-row"><span>Net Content:</span><span>{nutri['Net_Content']}</span></div>
                <div class="nutri-row"><span>Country Of Origin:</span><span>{nutri['Country_Of_Origin']}</span></div>
            </div>
            <div class="vline"></div>
            <div class="ing-box">Ingredients: {ing_text}</div>
            <div class="line2"></div>
            <div class="mfr-box">{mfr_text}</div>
            <div class="bb-box">Best before(Date Format):<br>Show on package(見包裝)<br>此日期前最佳(Format CHI)</div>
        </div>
    </body></html>
    """
    import re as regex
    match = regex.search(r'<body>(.*?)</body>', single_label_html, regex.DOTALL)
    if match:
        div_content = match.group(1)
        full_body = div_content * qty
        return single_label_html.replace(div_content, full_body)
    return single_label_html

def create_caution_html(text, qty):
    formatted = str(text).replace('\n', '<br/>')
    if not formatted or formatted == "nan": formatted = ""
    single = f"""
    <html><head><style>
        @page {{ size: auto; margin: 0mm; }}
        body {{ margin: 0; padding: 0; font-family: Helvetica, Arial, sans-serif; }}
        .label-container {{ width: 70mm; height: 50mm; box-sizing: border-box; padding: 2mm; page-break-after: always; display: flex; align-items: center; justify-content: center; text-align: center; }}
        .caution-text {{ font-size: 15pt; font-weight: 900; line-height: 1.2; word-wrap: break-word; color: black; }}
    </style></head><body>
        <div class="label-container"><div class="caution-text">{formatted}</div></div>
    </body></html>
    """
    import re as regex
    match = regex.search(r'<body>(.*?)</body>', single, regex.DOTALL)
    if match:
        div_content = match.group(1)
        full_body = div_content * qty
        return single.replace(div_content, full_body)
    return single

def process_yummy_pdf(file_bytes):
    pdf_file = io.BytesIO(file_bytes)
    reader = PdfReader(pdf_file)
    writer = PdfWriter()
    temp_items = []
    product_no_tracker = {}
    df_master = load_master_db()
    
    for i, page in enumerate(reader.pages):
        text = page.extract_text()
        if not text or not text.strip(): continue
        writer.add_page(page)
        
        lines = [line.strip() for line in text.strip().split('\n') if line.strip()]
        p_no = lines[0].strip() if lines else "Unknown"
        
        p_date = extract_date_from_text(text)
        
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
        
        p_name_pdf = ""
        if qty_line_index > 1:
            p_name_pdf = " ".join(lines[1:qty_line_index])
        elif len(lines) > 1 and qty_line_index == -1:
            name_parts = []
            for line in lines[1:]:
                if re.search(r"\d+\.0000|\b\d{12,14}\b", line): break
                name_parts.append(line)
            p_name_pdf = " ".join(name_parts)
            
        barcode_val = "未偵測到"
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
        if barcode_val == "未偵測到": barcode_val = "(N/A)"
        
        matched_data = {}
        data_status = 'empty'
        final_html = ""
        
        if df_master is not None and not df_master.empty:
            match_col = 'Product_No' if 'Product_No' in df_master.columns else 'ProductCode'
            if match_col in df_master.columns:
                matches = df_master[df_master[match_col].astype(str).str.strip() == p_no]
                if matches.empty and barcode_val != "(N/A)":
                    if 'Barcode' in df_master.columns:
                        matches = df_master[df_master['Barcode'].astype(str).str.strip() == barcode_val]
                
                if not matches.empty:
                    best_match_df = get_best_results(matches).fillna("")
                    matched_data = best_match_df.iloc[0].to_dict()
                    data_status = check_data_status(matched_data)
                    
                    if data_status == 'food':
                        final_html = create_label_html_on_the_fly({"Name": p_name_pdf, "Barcode": barcode_val}, matched_data, qty)
                    elif data_status == 'caution':
                        caution_text = smart_get_caution_text(matched_data) or "Caution Column Empty"
                        final_html = create_caution_html(caution_text, qty)

        if p_no not in product_no_tracker: product_no_tracker[p_no] = []
        product_no_tracker[p_no].append(i + 1)

        temp_items.append({
            "id": f"{p_no}_{i}", "Product_No": p_no, 
            "Name": p_name_pdf, 
            "Barcode": barcode_val, "Qty": qty, "Date": p_date,
            "status": data_status, "print_html": final_html 
        })

    out_filename = f"yummy_{uuid.uuid4().hex}.pdf"
    out_path = os.path.join(PDF_OUT_DIR, out_filename)
    with open(out_path, "wb") as f: writer.write(f)
    return temp_items, product_no_tracker, out_filename

@router.post("/upload")
async def upload_yummy_pdf(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    try:
        file_bytes = await file.read()
        items, tracker, out_filename = await asyncio.to_thread(process_yummy_pdf, file_bytes)
        
        # 🌟 釋放記憶體
        del file_bytes
        gc.collect()

        # 🌟 註冊背景任務
        out_path = os.path.join(PDF_OUT_DIR, out_filename)
        background_tasks.add_task(delete_file_later, out_path)

        duplicates = [{"Product_No": k, "Count": len(v), "Pages": ", ".join(map(str, v))} for k, v in tracker.items() if len(v) > 1]
        log_action("Yummy_Upload")
        
        font_css = font_to_base64_css(DEFAULT_FONT_PATH)
        
        return {
            "status": "success", "items": items, "duplicates": duplicates,
            "summary": {"total_pages": len(items), "has_duplicates": len(duplicates) > 0},
            "download_url": f"/generated_pdfs/{out_filename}", "font_css": font_css
        }
    except Exception as e: 
        gc.collect()
        raise HTTPException(status_code=500, detail=str(e))