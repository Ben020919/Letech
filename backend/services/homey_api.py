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
# 🌟 統一借大腦，不自己建立 cache
from services.master_api import load_master_db, find_by_product_no, find_by_barcode
from services.pdf_core import delete_file_later, generate_barcode_b64

router = APIRouter()
DATA_DIR = "data"
PDF_OUT_DIR = "generated_pdfs"
# 🌟 修改預設字體為 msyh.ttf
DEFAULT_FONT_PATH = os.path.join(DATA_DIR, "font1.ttf")
SERIF_FONT_PATH = os.path.join(DATA_DIR, "syst.ttf")  # 思源宋體 CN (Source Han Serif), 開源 SIL OFL

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(PDF_OUT_DIR, exist_ok=True)

def clean_val(val):
    if pd.isna(val) or str(val).lower() == 'nan': return ""
    return str(val).strip()

def get_nutri_val(data, key):
    val = data.get(key)
    if pd.isna(val) or str(val).lower() == 'nan': return "0"
    return str(val).strip()

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
                f"font-weight: normal; font-style: normal; }}"
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
    # 🌟 CustomLabelFont (font1.ttf) 係英文 font 冇 CJK glyphs,加 CustomLabelSerif
    # (syst.ttf,embedded 確保 print preview 都用到)做 CJK fallback。
    blocks.append(
        "body, .label-container, .label-box, div, span { "
        "font-family: 'CustomLabelFont', 'CustomLabelSerif', "
        "'Microsoft YaHei', 'PingFang SC', 'Heiti SC', "
        "Helvetica, Arial, sans-serif !important; }"
    )
    blocks.append(
        ".serif, .label-container .serif, .label-box .serif { "
        "font-family: 'CustomLabelSerif', 'Source Han Serif SC', "
        "'Songti SC', SimSun, serif !important; }"
    )
    return "".join(blocks)

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

# 🌟 將 font_css 直接當作參數傳入，取消自訂粗體
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
            font-size: 14pt; 
            margin-top: 2px; 
            letter-spacing: 1px; 
            color: black;
        }}
        
        .name-text {{
            font-size: 10pt;
            margin-top: 6px;
            width: 95%;
            word-wrap: break-word;
            line-height: 1.2;
            color: black;
        }}

        /* 強制全域粗體 — font 本身已經係 Bold variant,唔需要 faux-bold */
        .label-container, .label-container * {{
            font-weight: 900 !important;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
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

def create_barcode_only_label_html(barcode_val, qty, font_css=""):
    """🚀 純 barcode label:只有條碼圖 + 條碼數字,冇商品名。
    一律 70mm × 50mm — barcode 圖 28mm 高、文字 18pt。
    """
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
            padding: 4mm;
            overflow: hidden;
            text-align: center;
        }}

        .barcode-img {{
            height: 28mm;
            width: 92%;
            object-fit: contain;
        }}

        .barcode-text {{
            font-family: monospace;
            font-size: 18pt;
            margin-top: 4mm;
            letter-spacing: 1.5px;
            color: black;
            font-weight: bold;
        }}

        /* 強制全域粗體 — font 本身已經係 Bold variant,唔需要 faux-bold */
        .label-container, .label-container * {{
            font-weight: 900 !important;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }}
    </style></head><body>
        <div class="label-container">
            <img class="barcode-img" src="{barcode_img_src}">
            <div class="barcode-text">{barcode_val}</div>
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
            padding: 2mm 2.5mm;
            overflow: hidden;
            background-color: white;
            color: black;
            font-size: 6pt;
            line-height: 1.2;
            font-weight: 900;
            page-break-after: always;
        }}

        .insect-row {{
            margin-bottom: 1.4mm;
            word-wrap: break-word;
            word-break: break-word;
            font-weight: 900;
        }}

        .insect-row:last-child {{ margin-bottom: 0; }}

        /* 強制全域粗體 */
        .label-box, .label-box * {{
            font-weight: 900 !important;
        }}
    </style>
    <script>
    /* 🚀 Shrink-to-fit:同步縮 font + margin + line-height,直至全部內容塞得入
       用戶要求「70x50mm 固定,內容多就自動適應位置,要顯示所有的資料」*/
    (function() {{
      function fitLabel(box) {{
        if (!box) return;
        // 由 6pt 開始試,逐步縮到 1.5pt 為止(極限可讀)
        var size = parseFloat(getComputedStyle(box).fontSize);  // px
        var mb = 1.4;   // margin-bottom in mm
        var lh = 1.2;   // line-height
        var minSize = 1.5 * 96/72;  // 1.5pt → px
        var iters = 0;
        while (box.scrollHeight > box.clientHeight + 1 && size > minSize && iters < 100) {{
          size -= 0.2;
          mb = Math.max(0.2, mb * 0.95);
          lh = Math.max(1.02, lh - 0.005);
          box.style.fontSize = size + 'px';
          box.style.lineHeight = lh;
          box.querySelectorAll('.insect-row').forEach(function(r) {{
            r.style.marginBottom = mb + 'mm';
          }});
          iters++;
        }}
      }}
      function run() {{
        document.querySelectorAll('.label-box').forEach(fitLabel);
      }}
      if (document.readyState === 'loading') {{
        document.addEventListener('DOMContentLoaded', run);
      }} else {{
        run();
      }}
    }})();
    </script>
    </head><body>
        <div class="label-box">
            <div class="insect-row">{barcode}</div>
            <div class="insect-row">{desc}</div>
            {f'<div class="insect-row">{features}</div>' if features else ''}
            {f'<div class="insect-row">{cautions}</div>' if cautions else ''}
            {f'<div class="insect-row">{net_content}</div>' if net_content else ''}
            {f'<div class="insect-row">{ingredients}</div>' if ingredients else ''}
            {f'<div class="insect-row">{warnings}</div>' if warnings else ''}
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
        'Servings_Per_Package': get_nutri_val(data, 'Servings_Per_Package'),
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
    # 🌟 過敏原資訊(若有,append 落 ingredient text)
    allergen_text = clean_val(data.get('Allergen', ''))
    if allergen_text:
        ing_text = (ing_text + " " if ing_text else "") + f"Allergen specified ingredients: {allergen_text}"
    mfr_text = f"{clean_val(data.get('Madeby_Prefix', ''))} {clean_val(data.get('Madeby', ''))}".strip()
    if mfr_text and "Manufacturer" not in mfr_text: mfr_text = "Manufacturer: " + mfr_text
    # 🌟 Storage 提示(放 manufacturer 下面)
    storage_text = clean_val(data.get('Storage.1', '')) or clean_val(data.get('Storage', ''))

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

        /* === TOP 0-7mm (跟 label.py:middle_top_y=mm(43) → 50-43=7mm) === */
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
            top: 7mm; /* label.py: middle_top_y = mm(43) → 50-43=7mm */
            border-top: 1.5pt solid black;
        }}

        /* === MIDDLE 7-41mm (34mm,跟足 label.py:middle_height=43-8.8) === */
        .nutri-box {{
            position: absolute;
            left: 2mm;
            top: 8.5mm;        /* line1 下面留 1.5mm 透氣位 */
            width: 20mm;        /* vline 喺 24.5,留 2mm 透氣 */
            max-height: 30mm;   /* line2 上面留 1mm 透氣 */
            overflow: hidden;
            font-size: 4pt;
            line-height: 1.3;
            font-weight: bold;
        }}

        .nutri-title {{
            font-weight: bold;
            margin-bottom: 1mm;
        }}

        .nutri-row {{
            display: flex;
            justify-content: space-between;
        }}

        .indent {{
            padding-left: 2mm;
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
            top: 41mm; /* label.py: middle_bottom_y = mm(7+1.8)=8.8 → 50-8.8≈41mm */
            border-top: 1.5pt solid black;
        }}

        /* === BOTTOM 41-50mm (9mm) === */
        /* 🎨 mfr-box 同 bb-box top-align,兩邊第一行齊頭 */
        .mfr-box {{
            position: absolute;
            left: 2mm;
            top: 42.5mm;       /* 離 line2 多 1mm 透氣 */
            width: 44mm;
            height: 7mm;
            overflow: hidden;
            font-size: 4pt;
            line-height: 1.3;
            font-weight: 900;
        }}

        .bb-box {{
            position: absolute;
            left: 48mm;
            top: 42.5mm;       /* 同 mfr-box 同步 */
            width: 20mm;
            height: 7mm;
            overflow: hidden;
            font-size: 5pt;     /* 加大,填滿空間 */
            line-height: 1.35;
            font-weight: 900;
            white-space: nowrap;
            text-align: left;
        }}

        /* Storage line(放 manufacturer 下面) */
        .storage-line {{
            margin-top: 0.5mm;
            font-size: 3.7pt;
        }}

        .ing-box {{
            position: absolute;
            left: 27mm;        /* vline 喺 24.5,離 vline 2.5mm 透氣 */
            top: 8.5mm;        /* line1 下面留 1.5mm 透氣位 */
            width: 41mm;
            height: 30mm;      /* line2 上面留 1mm 透氣 */
            font-size: 4pt;
            line-height: 1.2;
            overflow: hidden;
            text-align: left;
            font-weight: bold;
            letter-spacing: 0.2pt;
            word-spacing: 0.5pt;
        }}

        /* 強制全域粗體 — font 本身已經係 Bold variant,唔需要 faux-bold */
        .label-container, .label-container * {{
            font-weight: 900 !important;
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
        document.querySelectorAll('.mfr-box').forEach(function(el) {{ fitText(el, 3); }});
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
            <div class="barcode-text">{b_text}</div>
            <div class="desc-text">{desc_text}</div>
            <div class="line1"></div>
            <div class="nutri-box">
                <div class="nutri-title">Nutrition Information</div>
                <br>
                {f'<div class="nutri-row"><span>Servings Per Package:</span><span>{nutri["Servings_Per_Package"]}</span></div>' if nutri['Servings_Per_Package'] and nutri['Servings_Per_Package'] != '0' else ''}
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
            <div class="mfr-box">
                <div>{mfr_text}</div>
                {f'<div class="storage-line">{storage_text}</div>' if storage_text else ''}
            </div>
            <div class="bb-box">Best before({en_expiry}):<br>Show on package</div>
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


def create_health_food_label_html(matched_data, qty, font_css=""):
    """保健食品 layout — 仿 letech.com.hk PDF generate_health_food_label
    左:barcode/name/ingredient/Net Content/Country/Storage/Manufacturer/Best Before
    右:Nutrition Information(Serving Size + Energy/Protein/Fat/Carb/Sugar/Sodium)
    中間 mm(42) 垂直分隔線"""
    data = matched_data if matched_data else {}
    barcode = clean_val(data.get('Barcode', ''))
    name = clean_val(data.get('Description', ''))
    ingredient = clean_val(data.get('Ingredients', ''))
    net_content = clean_val(data.get('Net Content', '')) or clean_val(data.get('Net_Content', ''))
    country = clean_val(data.get('Country_Of_Origin', ''))
    storage = clean_val(data.get('Cautions', '')) or clean_val(data.get('Storage', ''))
    mfr_pref = clean_val(data.get('Madeby_Prefix', ''))
    mfr_main = clean_val(data.get('Madeby', ''))
    mfr = (mfr_pref + ' ' + mfr_main).strip()
    if mfr and 'Manufacturer' not in mfr:
        mfr = 'Manufacturer:' + mfr

    # Serving Size:用 Instructions(letech.com 嘅 AW,通常已含 "a day"),否則用 Serving_Size + " a day"
    instructions = clean_val(data.get('Instructions', ''))
    if instructions:
        serving = instructions
    else:
        ss = clean_val(data.get('Serving_Size', ''))
        serving = (ss + ' a day') if ss else ''

    # Nutrition values
    def nv(key):
        v = clean_val(data.get(key, ''))
        return v if v else ''

    energy = nv('Energy')
    protein = nv('Protein')
    total_fat = nv('Total_Fat')
    sat_fat = nv('Sat_Fat')
    trans_fat = nv('Trans_Fat')
    carb = nv('Carb')
    sugar = nv('Sugar')
    sodium = nv('Sodium')

    # Expiry
    expiry_raw = data.get('Expiry_Date_Format', '')
    en_ex, ch_ex = format_expiry_date(expiry_raw)

    single_label_html = f"""
    <html><head><style>
        {font_css}
        @page {{ size: 70mm 50mm; margin: 0; }}

        body {{ margin: 0; padding: 0; font-family: Helvetica, Arial, sans-serif; }}

        .label-container {{
            width: 70mm;
            height: 50mm;
            position: relative;
            box-sizing: border-box;
            page-break-after: always;
            overflow: hidden;
            font-weight: bold;
            color: black;
            background: white;
        }}

        /* === 垂直分隔線 mm(42) (對應 letech.com label.py:c.line(mm(42),0,mm(42),mm(50))) === */
        .vline {{
            position: absolute;
            left: 42mm;
            top: 0;
            height: 50mm;
            border-left: 1.5pt solid black;
        }}

        /* === 右側水平分隔線 mm(35) (右半邊上面有 Nutrition Information 區) === */
        .hline-right {{
            position: absolute;
            left: 42mm;
            right: 0;
            top: 15mm;          /* label.py: c.line(mm(42),mm(35),...) → 50-35=15mm */
            border-top: 1.5pt solid black;
        }}

        /* === LEFT (0-42mm) === */
        .barcode-text {{
            position: absolute;
            left: 2mm;
            top: 1mm;           /* label.py mm(47) → 50-47=3mm... 用 1mm 留多啲位 */
            font-size: 4pt;
            font-weight: 900;
        }}

        .name-text {{
            position: absolute;
            left: 2mm;
            top: 3.5mm;         /* label.py mm(44) → 50-44=6mm... 收緊 */
            width: 38mm;
            max-height: 5mm;
            overflow: hidden;
            font-size: 4pt;
            line-height: 1.2;
            font-weight: 900;
        }}

        .ingredient-box {{
            position: absolute;
            left: 2mm;
            top: 9mm;           /* 商品名底下 */
            width: 38mm;
            max-height: 14mm;
            overflow: hidden;
            font-size: 3.5pt;
            line-height: 1.15;
            font-weight: 900;
            word-wrap: break-word;
        }}

        .info-line {{
            position: absolute;
            left: 2mm;
            width: 38mm;
            font-size: 4pt;
            line-height: 1.2;
            font-weight: 900;
            overflow: hidden;
        }}

        .info-net {{ top: 24mm; }}       /* label.py mm(24) → 50-24=26mm */
        .info-country {{ top: 27mm; }}    /* label.py mm(22) → 50-22=28mm */

        .storage-box {{
            position: absolute;
            left: 2mm;
            top: 30mm;
            width: 38mm;
            max-height: 4.5mm;
            overflow: hidden;
            font-size: 3.5pt;
            line-height: 1.15;
            font-weight: 900;
            word-wrap: break-word;
        }}

        .mfr-box {{
            position: absolute;
            left: 2mm;
            top: 35mm;
            width: 38mm;
            max-height: 6mm;
            overflow: hidden;
            font-size: 3.5pt;
            line-height: 1.15;
            font-weight: 900;
            word-wrap: break-word;
        }}

        .bb-box {{
            position: absolute;
            left: 2mm;
            top: 42mm;          /* label.py mm(8/6/4) */
            width: 38mm;
            font-size: 3.7pt;
            line-height: 1.25;
            font-weight: 900;
        }}

        /* === RIGHT (42-70mm) === */
        .nutri-title {{
            position: absolute;
            left: 44mm;
            top: 1.5mm;
            width: 24mm;
            font-size: 4.5pt;
            font-weight: 900;
        }}

        .serving-label {{
            position: absolute;
            left: 44mm;
            top: 5mm;
            width: 24mm;
            font-size: 4pt;
            font-weight: 900;
        }}

        .serving-val {{
            position: absolute;
            left: 44mm;
            top: 8mm;
            width: 24mm;
            max-height: 5.5mm;
            overflow: hidden;
            font-size: 4pt;
            line-height: 1.15;
            font-weight: 900;
            word-wrap: break-word;
        }}

        .nutri-row {{
            position: absolute;
            left: 44mm;
            width: 24mm;
            font-size: 4pt;
            line-height: 1.2;
            font-weight: 900;
            overflow: hidden;
            white-space: nowrap;
        }}

        /* label.py: Energy=mm(29), Protein=mm(26)... Sodium=mm(8) */
        .row-energy   {{ top: 17mm; }}    /* 50-29=21mm... 但要避開分隔線(15mm),用 17mm 開始 */
        .row-protein  {{ top: 20mm; }}
        .row-totalfat {{ top: 23mm; }}
        .row-satfat   {{ top: 26mm; }}
        .row-transfat {{ top: 29mm; }}
        .row-carb     {{ top: 32mm; }}
        .row-sugar    {{ top: 35mm; }}
        .row-sodium   {{ top: 38mm; }}

        .label-container, .label-container * {{
            font-weight: 900 !important;
            -webkit-font-smoothing: antialiased;
        }}
    </style>
    <script>
    /* Shrink-to-fit:左邊 ingredient-box + storage-box + mfr-box overflow 自動縮字 */
    (function() {{
      function fitText(el, minPt) {{
        if (!el) return;
        var size = parseFloat(getComputedStyle(el).fontSize);
        var minPx = (minPt || 2) * 96/72;
        var iters = 0;
        while (el.scrollHeight > el.clientHeight && size > minPx && iters < 50) {{
          size -= 0.2;
          el.style.fontSize = size + 'px';
          iters++;
        }}
      }}
      function run() {{
        document.querySelectorAll('.name-text, .ingredient-box, .storage-box, .mfr-box, .serving-val').forEach(function(el) {{ fitText(el, 2); }});
      }}
      if (document.readyState === 'loading') {{
        document.addEventListener('DOMContentLoaded', run);
      }} else {{
        run();
      }}
    }})();
    </script>
    </head><body>
        <div class="label-container">
            <!-- LEFT -->
            <div class="barcode-text">{barcode}</div>
            <div class="name-text">{name}</div>
            <div class="ingredient-box">Ingredient:{ingredient}</div>
            <div class="info-line info-net">Net Content:{net_content}</div>
            <div class="info-line info-country">Country Of Origin:{country}</div>
            <div class="storage-box">{storage}</div>
            <div class="mfr-box">{mfr}</div>
            <div class="bb-box">Best before(End {en_ex}):<br>此日期前最佳({ch_ex})<br>Show on package(見包裝)</div>

            <!-- DIVIDERS -->
            <div class="vline"></div>
            <div class="hline-right"></div>

            <!-- RIGHT -->
            <div class="nutri-title">Nutrition Information</div>
            <div class="serving-label">Serving Size:</div>
            <div class="serving-val">{serving}</div>
            <div class="nutri-row row-energy">Energy: {energy}</div>
            <div class="nutri-row row-protein">Protein: {protein}</div>
            <div class="nutri-row row-totalfat">Total Fat: {total_fat}</div>
            <div class="nutri-row row-satfat">Saturated: {sat_fat}</div>
            <div class="nutri-row row-transfat">Trans Fat: {trans_fat}</div>
            <div class="nutri-row row-carb">Carbohydrate: {carb}</div>
            <div class="nutri-row row-sugar">Sugars: {sugar}</div>
            <div class="nutri-row row-sodium">Sodium: {sodium}</div>
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


def create_pet_food_label_html(matched_data, qty, font_css=""):
    """Pet Food layout — 仿用戶 sample PDF。
    左:9 個 nutrition rows (Servings Per Package / Serving Size / Energy /
       Crude Protein / Crude Fat / Crude Fibre / Moisture / Net Content /
       Country Of Origin)
    右:Ingredients (column AT = pandas header 'Ingredients.1')
    底:Distributor + Storage + Best Before + Show on package
    Excel column letter → header name:
      A=Barcode, B=Description, AT=Ingredients.1,
      AU=Servings Per Package:, AV=Serving Size:, AW=Energy:,
      AX=Crude Protein:, AY=Crude Fat:, AZ=Crude Fibre:,
      BA=Moisture:, BB=Net Content:, BC=Country Of Origin:,
      BD=Distributor:, BE=. (storage txt), BF=Best before:, BG=..1 (show on pkg)
    """
    data = matched_data if matched_data else {}
    barcode = clean_val(data.get('Barcode', ''))
    name = clean_val(data.get('Description', ''))
    ing = clean_val(data.get('Ingredients.1', '')) or clean_val(data.get('Ingredients', ''))
    servings_pkg = clean_val(data.get('Servings Per Package:', ''))
    serving_size = clean_val(data.get('Serving Size:', ''))
    energy = clean_val(data.get('Energy:', ''))
    protein = clean_val(data.get('Crude Protein:', ''))
    fat = clean_val(data.get('Crude Fat:', ''))
    fibre = clean_val(data.get('Crude Fibre:', ''))
    moisture = clean_val(data.get('Moisture:', ''))
    net_content = clean_val(data.get('Net Content:', '')) or clean_val(data.get('Net_Content', ''))
    country = clean_val(data.get('Country Of Origin:', '')) or clean_val(data.get('Country_Of_Origin', ''))
    distributor = clean_val(data.get('Distributor:', ''))
    storage_txt = clean_val(data.get('.', '')) or clean_val(data.get('Storage', ''))
    best_before_fmt = clean_val(data.get('Best before:', '')) or 'YYYY-MM-DD'
    show_on_pkg = clean_val(data.get('..1', '')) or 'Show on package'

    single_label_html = f"""
    <html><head><style>
        {font_css}
        @page {{ size: 70mm 50mm; margin: 0; }}
        body {{ margin: 0; padding: 0; font-family: Helvetica, Arial, sans-serif; }}

        .label-container {{
            width: 70mm; height: 50mm;
            position: relative;
            box-sizing: border-box;
            page-break-after: always;
            overflow: hidden;
            font-weight: bold;
            color: black;
            background: white;
        }}

        /* === TOP 0-7mm — barcode + product name === */
        .barcode-text {{
            position: absolute;
            left: 2mm; top: 0.7mm;
            font-size: 4.5pt;
            font-weight: 900;
        }}
        .name-text {{
            position: absolute;
            left: 2mm; top: 3.3mm;
            width: 66mm;
            max-height: 3.5mm;
            overflow: hidden;
            font-size: 4.5pt;
            line-height: 1.15;
            font-weight: 900;
        }}
        .line1 {{
            position: absolute;
            left: 0; right: 0;
            top: 7mm;
            border-top: 1.5pt solid black;
        }}

        /* === MIDDLE 7-40mm — nutrition (left) + ingredients (right) === */
        .nutri-box {{
            position: absolute;
            left: 2mm; top: 8mm;
            width: 26mm; max-height: 31mm;
            overflow: hidden;
            font-size: 3.7pt;
            line-height: 1.35;
            font-weight: 900;
        }}
        .nutri-title {{ margin-bottom: 0.8mm; font-weight: 900; font-size: 4pt; }}
        .nutri-row {{ display: flex; justify-content: space-between; gap: 3px; }}
        .nutri-row span:last-child {{ text-align: right; }}

        .vline {{
            position: absolute;
            left: 29mm; top: 7mm;
            height: 33mm;
            border-left: 1.5pt solid black;
        }}

        .ing-box {{
            position: absolute;
            left: 30mm; top: 8mm;
            width: 38mm; height: 31mm;
            overflow: hidden;
            font-size: 3.4pt;
            line-height: 1.2;
            font-weight: 900;
            text-align: left;
            letter-spacing: 0.15pt;
        }}

        .line2 {{
            position: absolute;
            left: 0; right: 0;
            top: 40mm;
            border-top: 1.5pt solid black;
        }}

        /* === BOTTOM 40-50mm — distributor+storage (left) + best before (right) === */
        .mfr-box {{
            position: absolute;
            left: 2mm; top: 41mm;
            width: 44mm; height: 8.5mm;
            overflow: hidden;
            font-size: 3.4pt;
            line-height: 1.2;
            font-weight: 900;
        }}
        .mfr-box .line {{ margin-bottom: 0.4mm; }}

        .bb-box {{
            position: absolute;
            left: 47mm; top: 41mm;
            width: 21mm; height: 8.5mm;
            overflow: hidden;
            font-size: 3.8pt;
            line-height: 1.3;
            font-weight: 900;
            text-align: right;   /* 靠右對齊,fill 右邊空位 */
        }}

        .label-container, .label-container * {{
            font-weight: 900 !important;
            -webkit-font-smoothing: antialiased;
        }}
    </style>
    <script>
    /* Shrink-to-fit:內容超咗自動縮字 */
    (function() {{
      function fitText(el, minPt) {{
        if (!el) return;
        var size = parseFloat(getComputedStyle(el).fontSize);
        var minPx = (minPt || 2) * 96/72;
        var iters = 0;
        while (el.scrollHeight > el.clientHeight && size > minPx && iters < 50) {{
          size -= 0.2;
          el.style.fontSize = size + 'px';
          iters++;
        }}
      }}
      function run() {{
        document.querySelectorAll('.name-text, .nutri-box, .ing-box, .mfr-box, .bb-box').forEach(function(el) {{ fitText(el, 2); }});
      }}
      if (document.readyState === 'loading') {{
        document.addEventListener('DOMContentLoaded', run);
      }} else {{
        run();
      }}
    }})();
    </script>
    </head><body>
        <div class="label-container">
            <!-- TOP -->
            <div class="barcode-text">{barcode}</div>
            <div class="name-text">{name}</div>
            <div class="line1"></div>

            <!-- MIDDLE LEFT: Nutrition -->
            <div class="nutri-box">
                <div class="nutri-title">Nutrition Information</div>
                <div class="nutri-row"><span>Servings Per Package:</span><span>{servings_pkg}</span></div>
                <div class="nutri-row"><span>Serving Size:</span><span>{serving_size}</span></div>
                <div class="nutri-row"><span>Energy:</span><span>{energy}</span></div>
                <div class="nutri-row"><span>Crude Protein:</span><span>{protein}</span></div>
                <div class="nutri-row"><span>Crude Fat:</span><span>{fat}</span></div>
                <div class="nutri-row"><span>Crude Fibre:</span><span>{fibre}</span></div>
                <div class="nutri-row"><span>Moisture:</span><span>{moisture}</span></div>
                <div class="nutri-row"><span>Net Content:</span><span>{net_content}</span></div>
                <div class="nutri-row"><span>Country Of Origin:</span><span>{country}</span></div>
            </div>

            <div class="vline"></div>

            <!-- MIDDLE RIGHT: Ingredients (long text) -->
            <div class="ing-box">{ing}</div>

            <div class="line2"></div>

            <!-- BOTTOM LEFT: Distributor + Storage -->
            <div class="mfr-box">
                <div class="line">Distributor:{distributor}</div>
                <div class="line">{storage_txt}</div>
            </div>

            <!-- BOTTOM RIGHT: Best before + Show on package -->
            <div class="bb-box">
                Best before({best_before_fmt}):<br>{show_on_pkg}
            </div>
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
            # 🚀 O(1) hash-map 查表(原本係 O(N) 每次掃晒成個 DataFrame)
            matches = find_by_product_no(p_no)
            # 🌟 如果 Product_No 找不到，嘗試用 Barcode 找
            if matches.empty and barcode_val and barcode_val != "(N/A)":
                matches = find_by_barcode(barcode_val)

            if not matches.empty:
                matched_data = matches.iloc[0].fillna("").to_dict()
                # 🌟 增強：不區分大小寫與底線，自動尋找 Label Type 欄位
                for key, val in matched_data.items():
                    k_norm = str(key).strip().lower().replace("_", "").replace(" ", "")
                    if k_norm == "labeltype":
                        if pd.notna(val) and str(val).lower() != "nan":
                            excel_label = str(val).strip()
                        break
                        
        final_label = "普通Label"
        excel_label_lower = excel_label.lower()

        # 🌟 保健食品 / Pet Food 要行專屬 layout(要放喺 "food" 之前判斷)
        if "保健食品" in excel_label or "health_food" in excel_label_lower:
            final_label = "保健食品"
        elif "pet food" in excel_label_lower or "pet_food" in excel_label_lower:
            final_label = "Pet Food"
        elif "food" in excel_label_lower:
            final_label = "Food Label"
        # 🌟 增強：同時支援繁體「蟲」與簡體「虫」
        elif "蟲" in excel_label or "虫" in excel_label or "insect" in excel_label_lower:
            final_label = "蟲蟲Label"
        elif (barcode_val and barcode_val[-1].isalpha()) or (not barcode_val or barcode_val.strip() == "" or barcode_val == p_no or barcode_val == "(N/A)"):
            final_label = "Repack Lable"
        else:
            final_label = "普通Label"

        final_html = ""
        needs_print = False

        # 🚀 用 placeholder 取代 inline embed,response 由 ~2GB 縮到 ~19MB
        # frontend handlePrint 會用 resultData.font_css 喺 print 嗰刻先 replace
        FONT_PLACEHOLDER = "/* FONT_CSS_PLACEHOLDER */"
        if final_label == "保健食品":
            needs_print = True
            final_html = create_health_food_label_html(matched_data, qty, FONT_PLACEHOLDER)
        elif final_label == "Pet Food":
            needs_print = True
            final_html = create_pet_food_label_html(matched_data, qty, FONT_PLACEHOLDER)
        elif final_label == "Food Label":
            needs_print = True
            final_html = create_food_label_html(p_name, barcode_val, matched_data, qty, FONT_PLACEHOLDER)
        elif final_label == "蟲蟲Label":
            needs_print = True
            final_html = create_insects_label_html(matched_data, qty, FONT_PLACEHOLDER)
        elif final_label == "Repack Lable":
            needs_print = True
            print_barcode = p_no if not barcode_val or barcode_val == "(N/A)" else barcode_val
            final_html = create_homey_repack_label_html(p_name, print_barcode, qty, FONT_PLACEHOLDER)
            
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
    return temp_items, product_no_tracker, out_filename, font_css

@router.post("/upload")
async def upload_homey_pdf(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    try:
        file_bytes = await file.read()
        items, tracker, out_filename, font_css = await asyncio.to_thread(process_homey_pdf, file_bytes)
        
        # 🌟 釋放記憶體
        del file_bytes
        gc.collect()

        # 🌟 註冊背景任務
        out_path = os.path.join(PDF_OUT_DIR, out_filename)
        background_tasks.add_task(delete_file_later, out_path)

        duplicates = [{"Product_No": k, "Count": len(v), "Pages": ", ".join(map(str, v))} for k, v in tracker.items() if len(v) > 1]
        # 🌟 font_css 改由 /api/master/font-css 獨立 endpoint 供應(避免 OOM)
        return {
            "status": "success", "items": items, "duplicates": duplicates,
            "summary": {"total_pages": len(items), "has_duplicates": len(duplicates) > 0},
            "download_url": f"/generated_pdfs/{out_filename}",
        }
    except Exception as e: 
        gc.collect()
        raise HTTPException(status_code=500, detail=str(e))