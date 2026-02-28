from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any
import pandas as pd
import os
import base64
import re
# 🌟 統一向 master_api 借大腦
from services.master_api import load_master_db

# 🌟 匯入打卡系統
try:
    from services.stats_api import log_action
except ImportError:
    def log_action(name): pass

# ================= 補上遺失的路徑定義 =================
DATA_DIR = "data"
os.makedirs(DATA_DIR, exist_ok=True)
DEFAULT_FONT_PATH = os.path.join(DATA_DIR, "font.ttf")
# ======================================================

router = APIRouter()

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

def check_data_status(data_dict):
    if not data_dict: return 'empty'
    
    # 0. 優先檢查是否為蟲蟲標籤
    for k, v in data_dict.items():
        k_lower = str(k).lower()
        val = str(v).strip().lower()
        if val and val not in ['nan', '0', 'none', '']:
            if 'label' in k_lower and ('蟲' in val or 'insect' in val):
                return 'insect'
            if k_lower in ['features', '警告字眼']:
                return 'insect'

    # 1. 檢查是否有 Food 欄位
    food_keywords = ['ingredient', 'energy', 'protein', 'fat', 'carb', 'sodium', 'serving']
    for k, v in data_dict.items():
        if any(fw in str(k).lower() for fw in food_keywords):
            val = str(v).strip().lower()
            if val and val not in ['nan', '0', 'none', '']: return 'food'
            
    # 2. 檢查警告
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
        if status == 'insect': scores.append(3)
        elif status == 'food': scores.append(2)
        elif status == 'caution': scores.append(1)
        else: scores.append(0)
    results_df = results_df.copy()
    results_df['__score'] = scores
    results_df = results_df.sort_values(by='__score', ascending=False)
    target_col = 'Product_No' if 'Product_No' in results_df.columns else 'ProductCode'
    if target_col in results_df.columns:
        results_df = results_df.drop_duplicates(subset=[target_col], keep='first')
    return results_df

# ================= HTML Generators =================

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

# ================= API 路由 =================

@router.get("/search")
async def search_food_label(q: str):
    df_master = load_master_db()
    if df_master is None or df_master.empty:
        raise HTTPException(status_code=404, detail="資料庫尚未載入")
        
    query = q.strip().lower()
    match_col = 'Product_No' if 'Product_No' in df_master.columns else 'ProductCode'
    if match_col not in df_master.columns and 'Product No' in df_master.columns:
        match_col = 'Product No'
        
    # 確保 Barcode 欄位存在以防報錯
    barcode_col_exists = 'Barcode' in df_master.columns
        
    # 同時比對商品編號、條碼、名稱
    mask = df_master[match_col].astype(str).str.lower().str.contains(query, na=False)
    
    if barcode_col_exists:
        mask = mask | df_master['Barcode'].astype(str).str.lower().str.contains(query, na=False)
        
    name_col = df_master.get('Name', df_master.get('Description', pd.Series(dtype=str)))
    mask = mask | name_col.astype(str).str.lower().str.contains(query, na=False)
    
    results = df_master[mask]
    if results.empty: return []
        
    # 智能排序，優先顯示有完整資料的 (蟲蟲 > 食品 > 警告 > 空)
    best_results = get_best_results(results).fillna("")
    
    output = []
    for _, row in best_results.iterrows():
        matched_data = row.to_dict()
        data_status = check_data_status(matched_data)
        
        p_no = str(row.get(match_col, ''))
        barcode = str(row.get('Barcode', '')) if barcode_col_exists else ""
        name = clean_val(row.get('Name', row.get('Description', '')))
        
        output.append({
            "Product_No": p_no,
            "Barcode": barcode,
            "Name": name,
            "status": data_status,
            "matched_data": matched_data
        })
        
    return output

class PrintRequest(BaseModel):
    item: Dict[str, Any]
    matched_data: Dict[str, Any]
    qty: int
    status: str

@router.post("/generate_html")
async def generate_print_html(req: PrintRequest):
    qty = req.qty
    status = req.status
    matched_data = req.matched_data
    item = req.item
    
    final_html = ""
    if status == 'insect':
        final_html = create_insects_label_html(matched_data, qty)
    elif status == 'caution':
        caution_text = smart_get_caution_text(matched_data) or "Caution Column Empty"
        final_html = create_caution_html(caution_text, qty)
    elif status == 'food':
        final_html = create_food_label_html(item.get('Name', ''), item.get('Barcode', ''), matched_data, qty)
    else:
        raise HTTPException(status_code=400, detail="此商品無有效標籤資料")
        
    font_css = font_to_base64_css(DEFAULT_FONT_PATH)
    if final_html:
        final_html = final_html.replace('/* FONT_CSS_PLACEHOLDER */', font_css)
        
    log_action("FoodLabel_Search")
    return {"html": final_html}