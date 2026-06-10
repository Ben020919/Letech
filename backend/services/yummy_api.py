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
from services.master_api import load_master_db, find_by_product_no, find_by_barcode
from services.pdf_core import delete_file_later

DATA_DIR = "data"
PDF_OUT_DIR = "generated_pdfs"

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(PDF_OUT_DIR, exist_ok=True)

DEFAULT_FONT_PATH = os.path.join(DATA_DIR, "font1.ttf")
SERIF_FONT_PATH = os.path.join(DATA_DIR, "syst.ttf")  # 思源宋體 CN (Source Han Serif), 開源 SIL OFL

router = APIRouter()

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

def font_to_base64_css(font_path, serif_path=SERIF_FONT_PATH):
    # 🌟 預設 embed 思源宋體 syst.ttf — 之前怕 14MB × N labels 引起 OOM 所以 disable,
    # 但 frontend 已用 FONT_PLACEHOLDER 模式,font_css 只 inject 一次,唔再 × N。
    # 後端 / Render 嘅瀏覽器冇 system Chinese font,必須 embed 先可以 render 中文字。
    """嵌入主字體 (Microsoft YaHei → CustomLabelFont) 與可選的中文 serif
    (Source Han Serif CN → CustomLabelSerif)。任何元素加上 class="serif"
    即會用思源宋體;其餘維持原本 sans 樣式。"""
    blocks = []
    if os.path.exists(font_path):
        try:
            with open(font_path, "rb") as f:
                b64_str = base64.b64encode(f.read()).decode('utf-8')
            blocks.append(
                f"@font-face {{ font-family: 'CustomLabelFont'; "
                f"src: url(data:font/ttf;base64,{b64_str}) format('truetype'); "
                f"font-weight: bold; font-style: normal; }}"
            )
        except Exception:
            pass
    if serif_path and os.path.exists(serif_path):
        try:
            with open(serif_path, "rb") as f:
                s64 = base64.b64encode(f.read()).decode('utf-8')
            blocks.append(
                f"@font-face {{ font-family: 'CustomLabelSerif'; "
                f"src: url(data:font/ttf;base64,{s64}) format('truetype'); "
                f"font-weight: normal; font-style: normal; }}"
            )
        except Exception:
            pass
    if not blocks:
        return ""
    # 🌟 font1.ttf (CustomLabelFont) 係英文 font,冇 CJK glyphs。
    # 加 CustomLabelSerif(syst.ttf 思源宋體)同系統 CJK font 做 fallback,
    # 否則「此日期前最佳」、「見包裝」呢類中文字會變空白。
    blocks.append(
        "body, .label-container, div, span { "
        "font-family: 'CustomLabelFont', 'CustomLabelSerif', "
        "'Source Han Serif SC', 'Songti SC', SimSun, "
        "Helvetica, Arial, sans-serif !important; }"
    )
    blocks.append(
        ".serif, .label-container .serif { "
        "font-family: 'CustomLabelSerif', 'Source Han Serif SC', "
        "'Songti SC', SimSun, serif !important; }"
    )
    return "".join(blocks)

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

# 🌟 將 font_css 直接當作參數傳入
def create_label_html_on_the_fly(item, matched_data, qty, font_css=""):
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

    # 動態取得日期格式 (使用 Expiry_Date_Format 作為 Key)
    expiry_raw = data.get('Expiry_Date_Format', data.get('AD', ''))
    en_expiry, ch_expiry = format_expiry_date(expiry_raw)

    single_label_html = f"""
    <html><head><style>
        {font_css}
        @page {{ size: 70mm 50mm; margin: 0; }} /* 🎨 強制 page 大細 = label 大細,唔再出現白色外圍 */
        
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
            /* 🎨 跟足 label.py:冇外框,只有 3 條內部分隔線 */
            page-break-after: always;
            overflow: hidden;
            font-weight: bold;
        }}

        /* === TOP 0-7mm === */
        .barcode-text {{
            position: absolute;
            left: 2mm;
            top: 0.7mm;
            font-size: 4.5pt;
            font-weight: 900;
            line-height: 1;
        }}

        .desc-text {{
            position: absolute;
            left: 2mm;
            top: 3.5mm; /* 🎨 留多 1mm 空間,唔再貼住 barcode */
            width: 65mm;
            max-height: 3.3mm;
            overflow: hidden;
            font-size: 4.5pt;
            line-height: 1.15;
            font-weight: 900;
        }}

        .line1 {{
            position: absolute;
            left: 0;
            right: 0;
            top: 7mm; /* 跟足 label.py middle_top_y=mm(43) */
            border-top: 1.5pt solid black;
        }}

        /* === MIDDLE 7-41mm === */
        .nutri-box {{
            position: absolute;
            left: 2mm;
            top: 8.5mm; /* 🎨 line1 下面留 1.5mm 透氣位 */
            width: 21mm; /* 🎨 vline 喺 24.5,留 1.5mm padding 唔貼住豎線 */
            max-height: 31mm;
            overflow: hidden;
            font-size: 4pt;
            line-height: 1.3;
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
            left: 24.5mm; /* label.py: c.line(mm(24.5), ...) */
            top: 7mm;
            height: 34mm;
            border-left: 1.5pt solid black;
        }}

        .line2 {{
            position: absolute;
            left: 0;
            right: 0;
            top: 41mm; /* label.py: middle_bottom_y=mm(8.8) → 50-8.8≈41 */
            border-top: 1.5pt solid black;
        }}

        /* === BOTTOM 41-50mm === */
        /* 🎨 兩邊都 flex column + justify-content: center —— 唔同 line 數(2 vs 3)
           都垂直置中,視覺上對稱;唔再左短右長嗰種唔對齊感 */
        .mfr-box {{
            position: absolute;
            left: 2mm;
            top: 41.5mm;
            width: 44mm;
            height: 8mm; /* 由 max-height 改 height,等 flex centering 有固定高 */
            overflow: hidden;
            font-size: 4pt;
            line-height: 1.3;
            font-weight: 900;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }}

        .bb-box {{
            position: absolute;
            left: 48mm;
            top: 41.5mm;
            width: 20mm;
            height: 8mm;
            overflow: hidden;
            font-size: 4pt;
            line-height: 1.4;
            font-weight: 900;
            white-space: nowrap;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }}

        .ing-box {{
            position: absolute;
            left: 26.5mm; /* 🎨 vline 喺 24.5mm,留 2mm padding 唔貼住豎線 */
            top: 8.5mm; /* 🎨 line1 下面留 1.5mm 透氣位 */
            width: 41mm;
            height: 31mm;
            font-size: 4pt;
            line-height: 1.2;
            overflow: hidden;
            text-align: left;
            font-weight: bold;
            letter-spacing: 0.2pt;
            word-spacing: 0.5pt;
        }}

        /* 強制全域粗體 — 加埋 text-shadow 製造 faux-bold 視覺重量,
           因為 syst.ttf 思源宋體本身係 regular weight,真.bold 唔存在嗰個 file 入面 */
        .label-container, .label-container * {{
            font-weight: 900 !important;
            text-shadow: 0 0 0.08mm currentColor;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }}
    </style>
    <script>
    /* 🚀 Shrink-to-fit:每個容器內容若 overflow,自動縮細字直至塞得入 */
    (function() {{
      function fitText(el, minPx) {{
        if (!el) return;
        var size = parseFloat(getComputedStyle(el).fontSize);
        if (!size) return;
        var min = minPx || 4;
        var iters = 0;
        while (el.scrollHeight > el.clientHeight && size > min && iters < 50) {{
          size -= 0.3;
          el.style.fontSize = size + 'px';
          iters++;
        }}
      }}
      function fitTextWH(el, minPx) {{
        /* 同時檢查橫向 + 縱向 overflow,適合 bb-box 嗰類 white-space: nowrap 元素 */
        if (!el) return;
        var size = parseFloat(getComputedStyle(el).fontSize);
        if (!size) return;
        var min = minPx || 3;
        var iters = 0;
        while ((el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) && size > min && iters < 50) {{
          size -= 0.3;
          el.style.fontSize = size + 'px';
          iters++;
        }}
      }}
      function fitAll() {{
        document.querySelectorAll('.desc-text').forEach(function(el) {{ fitText(el, 4); }});
        document.querySelectorAll('.nutri-box').forEach(function(el) {{ fitText(el, 4); }});
        document.querySelectorAll('.ing-box').forEach(function(el) {{ fitText(el, 3); }});
        document.querySelectorAll('.mfr-box').forEach(function(el) {{ fitText(el, 3.5); }});
        document.querySelectorAll('.bb-box').forEach(function(el) {{ fitTextWH(el, 3); }});
      }}
      if (document.readyState === 'loading') {{
        document.addEventListener('DOMContentLoaded', fitAll);
      }} else {{
        fitAll();
      }}
    }})();
    </script>
    </head><body>
        <div class="label-container">
            <div class="barcode-text">{barcode_text}</div>
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

def create_caution_html(text, qty):
    formatted = str(text).replace('\n', '<br/>')
    if not formatted or formatted == "nan": formatted = ""
    single = f"""
    <html><head><style>
        @page {{ size: 70mm 50mm; margin: 0; }} /* 🎨 強制 page 大細 = label 大細,唔再出現白色外圍 */
        
        body {{ 
            margin: 0; 
            padding: 0; 
            font-family: Helvetica, Arial, sans-serif; 
        }}
        
        .label-container {{ 
            width: 70mm; 
            height: 50mm; 
            box-sizing: border-box; 
            padding: 2mm; 
            page-break-after: always; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            text-align: center; 
        }}
        
        .caution-text {{ 
            font-size: 15pt; 
            font-weight: 900; /* 粗體 */
            text-decoration: underline; /* 🌟 加上底線 */
            line-height: 1.2; 
            word-wrap: break-word; 
            color: black; 
        }}
        
        /* 強制全域粗體 */
        .label-container, .label-container * {{ 
            font-weight: 900 !important; 
        }}
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

# ================= 新增：Jelly 警告標籤片段生成 (附加於主標籤內) =================
def generate_jelly_html(cautions_text, qty):
    formatted = str(cautions_text).replace('\n', '<br/>')
    if not formatted or formatted == "nan": return ""
    # 單純生成附帶 qty 數量的 DIV 片段，大小與主標籤(70mm x 50mm)一致，並設定 page-break-after 換頁
    single = f"""
    <div class="jelly-label" style="width: 70mm; height: 50mm; box-sizing: border-box; padding: 2mm; page-break-after: always; display: flex; align-items: center; justify-content: center; text-align: center; font-family: Helvetica, Arial, sans-serif; background: #fff; color: #000; font-weight: 900 !important;">
        <div style="font-size: 15pt; font-weight: 900 !important; text-decoration: underline; line-height: 1.2; word-wrap: break-word;">
            {formatted}
        </div>
    </div>
    """
    return single * qty

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
            # 🚀 O(1) hash-map 查表(原本係 O(N) 每次掃晒成個 DataFrame)
            matches = find_by_product_no(p_no)
            if matches.empty and barcode_val != "(N/A)":
                matches = find_by_barcode(barcode_val)

            if not matches.empty:
                    # ====== 1. 優先抓出 Food Label 的紀錄 (排除 Label_Type 包含 Jelly 的) ======
                    main_records = matches[~matches['Label_Type'].astype(str).str.lower().str.contains('jelly', na=False)]
                    
                    if not main_records.empty:
                        best_match_df = get_best_results(main_records).fillna("")
                    else:
                        best_match_df = get_best_results(matches).fillna("")
                        
                    matched_data = best_match_df.iloc[0].to_dict()
                    data_status = check_data_status(matched_data)
                    
                    # 🚀 改成「先做一對(food+jelly),再 × qty」,實現交替打印
                    # 先用 qty=1 生成單份 food / caution(內部仲未做 ×qty 複製)
                    # 🌟 傳 FONT_PLACEHOLDER 等 frontend 統一 inject 嵌入字體,中文先 render 到
                    if data_status == 'food':
                        final_html = create_label_html_on_the_fly({"Name": p_name_pdf, "Barcode": barcode_val}, matched_data, 1, "/* FONT_CSS_PLACEHOLDER */")
                    elif data_status == 'caution':
                        caution_text = smart_get_caution_text(matched_data) or "Caution Column Empty"
                        final_html = create_caution_html(caution_text, 1)

                    # ====== 2. 尋找 Jelly Label,單份生成 ======
                    jelly_single = ""  # 一份 Jelly 警告貼嘅 HTML div
                    jelly_cautions_text = ""
                    jelly_records = matches[matches['Label_Type'].astype(str).str.lower().str.contains('jelly', na=False)]
                    if not jelly_records.empty:
                        jelly_data = jelly_records.iloc[0].to_dict()
                        jelly_cautions_text = smart_get_caution_text(jelly_data)
                        if jelly_cautions_text:
                            jelly_single = generate_jelly_html(jelly_cautions_text, 1)

                    # ====== 3. 組合一對(food+jelly)然後 × qty,實現交替 ======
                    if final_html and "</body></html>" in final_html:
                        import re as _regex
                        body_match = _regex.search(r'<body>(.*?)</body>', final_html, _regex.DOTALL)
                        if body_match:
                            single_body = body_match.group(1)
                            # 一對:[food/caution] + [jelly(如有)]
                            pair = single_body + jelly_single
                            # × qty:food→jelly→food→jelly→...
                            full_body = pair * qty
                            final_html = final_html.replace(single_body, full_body)
                    elif jelly_single and not final_html:
                        # 只有 Jelly,冇 food/caution → 直接用 caution_html × qty
                        final_html = create_caution_html(jelly_cautions_text, qty)
                        data_status = 'caution'

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
        # 🌟 font_css 唔再喺 response 度返(39MB 太大會 Render OOM),
        # 改由 /api/master/font-css 獨立 endpoint,frontend cache 一次共用

        return {
            "status": "success", "items": items, "duplicates": duplicates,
            "summary": {"total_pages": len(items), "has_duplicates": len(duplicates) > 0},
            "download_url": f"/generated_pdfs/{out_filename}",
        }
    except Exception as e: 
        gc.collect()
        raise HTTPException(status_code=500, detail=str(e))