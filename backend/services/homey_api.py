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
# 🌟 修改預設字體為 msyh.ttf
DEFAULT_FONT_PATH = os.path.join(DATA_DIR, "font1.ttf")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(PDF_OUT_DIR, exist_ok=True)

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

def font_to_base64_css(font_path):
    if not os.path.exists(font_path): return ""
    try:
        with open(font_path, "rb") as f:
            b64_str = base64.b64encode(f.read()).decode('utf-8')
        # 🌟 加上微軟雅黑與蘋方作為 Fallback 字型
        return f"@font-face {{ font-family: 'CustomLabelFont'; src: url(data:font/ttf;base64,{b64_str}) format('truetype'); font-weight: bold; font-style: normal; }} body, .label-container, .label-box, div, span {{ font-family: 'CustomLabelFont', 'Microsoft YaHei', 'PingFang SC', 'Heiti SC', Helvetica, Arial, sans-serif !important; }}"
    except: return ""

def generate_barcode_b64(data: str):
    try:
        Code128 = barcode.get_barcode_class('code128')
        rv = io.BytesIO()
        Code128(data, writer=ImageWriter()).write(rv, options={"write_text": False, "module_height": 10.0, "quiet_zone": 1.0})
        b64 = base64.b64encode(rv.getvalue()).decode("utf-8")
        return f"data:image/png;base64,{b64}"
    except: return ""

# ================= 新增：日期格式化函數 =================
def format_expiry_date(expiry_value):
    if pd.isna(expiry_value) or str(expiry_value).lower() == 'nan':
        return 'YY-MM', '年-月'
        
    raw = str(expiry_value).strip().upper()
    if not raw:
        return 'YY-MM', '年-月'

    # 將中文年月日或斜線替換為 '-' 以利判斷
    raw = re.sub(r'[年月日./]', '-', raw)
    raw = re.sub(r'\s+', '', raw)
    raw = re.sub(r'-+', '-', raw)
    raw = raw.strip('-')

    parts = [p for p in raw.split('-') if p]
    has_day = 'DD' in raw or len(parts) >= 3
    has_full_year = 'YYYY' in raw

    english = ('YYYY-MM-DD' if has_day else 'YYYY-MM') if has_full_year else ('YY-MM-DD' if has_day else 'YY-MM')
    chinese = '年-月-日' if has_day else '年-月'

    return english, chinese

# 🌟 將 font_css 直接當作參數傳入，確保每種標籤都能載入自訂粗體
def create_homey_repack_label_html(p_name, barcode_val, qty, font_css=""):
    barcode_img_src = generate_barcode_b64(barcode_val)
    single_label_html = f"""
    <html><head><style>
        {font_css}
        @page {{ size: 70mm 50mm; margin: 0; }}
        
        body {{ 
            margin: 0; 
            padding: 0; 
            background-color: white; 
        }}
        
        .label-container {{
            width: 70mm; 
            height: 50mm; 
            box-sizing: border-box; 
            page-break-after: always; 
            display: flex; 
            flex-direction: column; 
            justify-content: center; 
            align-items: center; 
            padding-top: 3mm; 
            overflow: hidden; 
            text-align: center;
        }}
        
        .barcode-text {{
            font-family: monospace; 
            font-weight: bold; 
            font-size: 14pt; 
            margin-top: 2px; 
            letter-spacing: 1px; 
            color: black;
        }}
        
        .name-text {{
            font-size: 10pt; 
            font-weight: bold; 
            margin-top: 6px; 
            width: 95%; 
            word-wrap: break-word; 
            line-height: 1.2; 
            color: black;
        }}

        .label-container, .label-container * {{ 
            font-weight: 900 !important; 
        }}
    </style></head><body>
        <div class="label-container">
            <img src="{barcode_img_src}" style="height: 18mm; width: 90%; object-fit: contain;">
            <div class="barcode-text">{barcode_val}</div>
            <div class="name-text">{p_name}</div>
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

def create_insects_label_html(matched_data, qty, font_css=""):
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
    <html><head><style>
        {font_css}
        @page {{ size: 70mm 50mm; margin: 0; }}
        
        body {{ 
            margin: 0; 
            padding: 0; 
            font-family: Helvetica, Arial, sans-serif; 
            background-color: white;
        }}
        
        .label-box {{
            width: 70mm; 
            height: 50mm; 
            box-sizing: border-box; 
            padding: 3mm 4mm; 
            overflow: hidden; 
            background-color: white; 
            color: black; 
            font-size: 4pt; 
            line-height: 1.1; 
            page-break-after: always;
        }}
        
        .insect-row {{
            margin-bottom: 6pt; 
            word-wrap: break-word; 
            font-weight: bold; 
            min-height: 6pt;
        }}

        .label-box, .label-box * {{ 
            font-weight: 900 !important; 
        }}
    </style></head><body>
        <div class="label-box">
            <div class="insect-row">
                <div>{barcode}</div>
                <div>{desc}</div>
            </div>
            <div class="insect-row">{features}</div>
            <div class="insect-row">{cautions}</div>
            <div class="insect-row">{net_content}</div>
            <div class="insect-row">{ingredients}</div>
            <div style="word-wrap: break-word; font-weight: bold; min-height: 6pt;">{warnings}</div>
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

def create_food_label_html(item_name, barcode_text, matched_data, qty, font_css=""):
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

    # 動態取得日期格式 (使用 Expiry_Date_Format 作為 Key)
    expiry_raw = data.get('Expiry_Date_Format', data.get('AD', ''))
    en_expiry, ch_expiry = format_expiry_date(expiry_raw)

    single_label_html = f"""
    <html><head><style>
        {font_css}
        @page {{ size: auto; margin: 0mm; }}
        
        body {{ 
            margin: 0; 
            padding: 0; 
            font-family: Helvetica, Arial, sans-serif; 
        }}
        
        .label-container {{ 
            width: 70mm; 
            height: 50mm; 
            position: relative; 
            box-sizing: border-box; 
            border: 1px solid #ddd; 
            page-break-after: always; 
            overflow: hidden; 
            font-weight: bold; 
        }}
        
        .barcode-text {{ 
            position: absolute; 
            left: 2mm; 
            top: 2mm; 
            font-size: 5pt; 
            font-weight: bold; 
        }}
        
        .desc-text {{ 
            position: absolute; 
            left: 2mm; 
            top: 4.5mm; 
            width: 59mm; 
            font-size: 5pt; 
            line-height: 1.2; 
            font-weight: bold; 
        }}
        
        .line1 {{ 
            position: absolute; 
            left: 0; 
            top: 9mm; 
            width: 70mm; 
            border-top: 1.42pt solid black; 
        }}
        
        .nutri-box {{   
            position: absolute; 
            left: 2mm; 
            top: 10mm; 
            width: 23mm; 
            font-size: 4.5pt; /* 统一改字体大小 */
            line-height: 1.25; /* 统一改行距 */
            font-weight: bold; 
        }}
        
        .nutri-title {{ 
            font-weight: bold; 
            margin-bottom: 1px; 
        }}
        
        .nutri-row {{ 
            display: flex; 
            justify-content: space-between; 
        }}
        
        .indent {{ 
            padding-left: 3px; 
        }}
        
        .vline {{ 
            position: absolute; 
            left: 26mm; 
            top: 9mm; 
            height: 29mm; 
            border-left: 1.42pt solid black; 
        }}
        
        .line2 {{ 
            position: absolute; 
            left: 0; 
            top: 38mm; 
            width: 70mm; 
            border-top: 1.42pt solid black; 
        }}
        
        .mfr-box {{ 
            position: absolute; 
            left: 2mm; 
            top: 40mm; 
            width: 35mm; 
            font-size: 4.76pt; 
            line-height: 1.2; 
            font-weight: bold; 
        }}
        
        .bb-box {{ 
            position: absolute; 
            left: 47mm; 
            top: 40mm; 
            width: 27mm; 
            font-size: 4.2pt; 
            line-height: 1.2; 
            font-weight: bold; 
            white-space: nowrap; 
        }}
        
        .ing-box {{ 
            position: absolute; 
            left: 27mm; 
            top: 10mm; 
            width: 41mm; 
            height: 28mm; 
            font-size: 3.5pt; 
            line-height: 1.1; 
            overflow: hidden; 
            text-align: left; /* 🌟 1. 改成靠左對齊，避免單字被亂拉長 */
            font-weight: bold; 
            letter-spacing: 0.2pt; /* 🌟 2. 調整字母與字母之間的距離 (可調 0.1pt ~ 0.5pt) */
            word-spacing: 0.5pt;   /* 🌟 3. (可選) 調整英文單字與單字之間的距離 */
        }}

        /* 強制全域粗體 */
        .label-container, .label-container * {{ 
            font-weight: 900 !important; 
        }}
    </style></head><body>
        <div class="label-container">
            <div class="barcode-text">{b_text}</div>
            <div class="desc-text">{desc_text}</div>
            <div class="line1"></div>
            <div class="nutri-box">
                <div class="nutri-title">Nutrition Information</div>
                <br>
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
            <div class="ing-box">{ing_text}</div>
            <div class="line2"></div>
            <div class="mfr-box">{mfr_text}</div>
            <div class="bb-box">Best before({en_expiry}):<br>此日期前最佳({ch_expiry})<br>Show on package(見包裝)</div>
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


def process_homey_pdf(file_bytes):
    pdf_file = io.BytesIO(file_bytes)
    reader = PdfReader(pdf_file)
    writer = PdfWriter()
    temp_items = []
    product_no_tracker = {}
    df_master = load_master_db()
    
    # 🌟 取得 Base64 自訂字體，一次性生成好供後續所有標籤使用
    font_css = font_to_base64_css(DEFAULT_FONT_PATH)
    
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
            final_html = create_food_label_html(p_name, barcode_val, matched_data, qty, font_css)
        elif final_label == "蟲蟲Label": 
            needs_print = True
            final_html = create_insects_label_html(matched_data, qty, font_css)
        elif final_label == "Repack Lable":
            needs_print = True
            print_barcode = p_no if not barcode_val or barcode_val == "(N/A)" else barcode_val
            final_html = create_homey_repack_label_html(p_name, print_barcode, qty, font_css)
            
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
        
        return {
            "status": "success", "items": items, "duplicates": duplicates,
            "summary": {"total_pages": len(items), "has_duplicates": len(duplicates) > 0},
            "download_url": f"/generated_pdfs/{out_filename}", "font_css": ""
        }
    except Exception as e: 
        gc.collect()
        raise HTTPException(status_code=500, detail=str(e))