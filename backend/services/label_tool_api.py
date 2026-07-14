"""員工自助標籤打印 API.

兩個功能:
1) 搜尋產品(用智能查詢中心嘅 search_data,支援中文)→ 一鍵自動打印(food+jelly 自動合併)
2) 自助 Repack:員工自己輸入 barcode + 商品名 + 數量,打印 Repack 標
"""

import re as _regex
from typing import List, Dict, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.master_api import load_master_db, find_by_barcode, find_by_product_no
from services.unified_api import load_search_db
from services.homey_api import (
    create_food_label_html,
    create_insects_label_html,
    create_health_food_label_html,
    create_pet_food_label_html,
    create_homey_repack_label_html,
    create_barcode_only_label_html,
    font_to_base64_css as homey_font_css,
    DEFAULT_FONT_PATH as HOMEY_FONT,
)
from services.yummy_api import (
    create_caution_html,
    generate_jelly_html,
    smart_get_caution_text,
    check_data_status,
    get_best_results,
)


router = APIRouter()
FONT_PLACEHOLDER = "/* FONT_CSS_PLACEHOLDER */"


# ────────────────────────────────────────────────────────────
# 偵測有邊啲 label 可印(用嚟喺前端顯示 info chip)
# 注意:repack 唔再喺度自動偵測,要去專門「自助 Repack」頁
# ────────────────────────────────────────────────────────────
def detect_label_types_from_matches(matches) -> List[str]:
    """從 master DB matches(可能多 row)分析有邊啲 label 類型可印。"""
    if matches is None or matches.empty:
        return []
    types: List[str] = []
    label_types_lower = matches['Label_Type'].astype(str).str.lower() if 'Label_Type' in matches.columns else None

    # Food / Caution(非 jelly 嘅 main records)
    if label_types_lower is not None:
        non_jelly = matches[~label_types_lower.str.contains('jelly', na=False)]
    else:
        non_jelly = matches
    if not non_jelly.empty:
        try:
            best = get_best_results(non_jelly).fillna("")
            md = best.iloc[0].to_dict()
            lt_md = str(md.get('Label_Type', '')).lower()
            status = check_data_status(md)
            # 🌟 特殊 label_type 優先(避免被 status='food' 抢先)
            if '保健食品' in lt_md or 'health_food' in lt_md:
                types.append('health_food')
            elif 'pet food' in lt_md or 'pet_food' in lt_md:
                types.append('pet_food')
            elif 'best before' in lt_md:
                types.append('best_before')
            elif status == 'food':
                types.append('food')
            elif status == 'caution':
                types.append('caution')
        except Exception:
            pass

    # Jelly
    if label_types_lower is not None:
        jelly_rows = matches[label_types_lower.str.contains('jelly', na=False)]
        if not jelly_rows.empty:
            types.append('jelly')

        # 蟲蟲
        if label_types_lower.str.contains('蟲|insect', na=False, regex=True).any():
            types.append('insects')

    return types


# ────────────────────────────────────────────────────────────
# 1. 搜尋 endpoint — 改用智能查詢中心 search_data(支援中文)
# ────────────────────────────────────────────────────────────
@router.get("/search")
def search_products(q: str, limit: int = 200):
    """以智能查詢中心嘅 search_data 搜尋(支援中文模糊),再 enrich master DB 嘅 label types。

    預設 limit=200,同智能查詢中心一致(原本 20 太少,大關鍵字會被斬)。"""
    q = (q or "").strip()
    if not q:
        return {"results": []}

    df = load_search_db()
    if df is None or df.empty:
        return {"results": [], "warning": "智能查詢中心嘅資料庫未載入"}

    # 同 unified_api 一樣嘅模糊搜尋(中文 OK)
    q_low = q.lower()
    matched = df[df['_combined_search_text'].str.contains(q_low, na=False, regex=False)].head(limit)

    results = []
    for _, row in matched.iterrows():
        product_code = str(row.get("ProductCode", row.get("Product_No", ""))).strip()
        barcode = str(row.get("Barcode", "")).strip()
        name = str(row.get("Name", row.get("Description", ""))).strip()
        if name.upper() == "NAN":
            name = ""
        if barcode.upper() == "NAN":
            barcode = ""

        # 喺 master DB 查同一個 barcode,睇有冇 label 可印
        label_types = []
        has_label_data = False
        if barcode:
            m = find_by_barcode(barcode)
            if not m.empty:
                has_label_data = True
                label_types = detect_label_types_from_matches(m)
        if not has_label_data and product_code:
            m = find_by_product_no(product_code)
            if not m.empty:
                has_label_data = True
                label_types = detect_label_types_from_matches(m)

        results.append({
            "Barcode": barcode,
            "Product_No": product_code,
            "Name": name or "(無名稱)",
            "label_types": label_types,
            "has_label_data": has_label_data,
        })

    return {"results": results}


# ────────────────────────────────────────────────────────────
# 2. 一鍵 Smart Print — 自動跟 Yummy 3PL 一樣嘅邏輯
#    有 food + jelly → 交替打;有 food only → food;有 jelly only → jelly
# ────────────────────────────────────────────────────────────
class PrintRequest(BaseModel):
    barcode: str
    product_no: str = ""
    qty: int = 1


@router.post("/print")
def smart_print(req: PrintRequest):
    """跟 Yummy 3PL process_yummy_pdf 入面嘅邏輯一致:
    1) 喺 master DB 搵 matches(優先 barcode,次序 product_no)
    2) main_records = 非 jelly row → get_best_results → check food/caution
    3) jelly_records = jelly row → 取 Cautions 做 Jelly 警告貼
    4) 若兩者都有:food → jelly → food → jelly... × qty
    """
    if req.qty < 1 or req.qty > 500:
        raise HTTPException(status_code=400, detail="數量必須喺 1-500 之間")

    bc = req.barcode.strip()
    pno = req.product_no.strip()
    matches = find_by_barcode(bc) if bc else None
    if matches is None or matches.empty:
        matches = find_by_product_no(pno) if pno else None
    if matches is None or matches.empty:
        raise HTTPException(status_code=404, detail=f"喺 master DB 搵唔到 (barcode={bc}, product_no={pno})")

    label_types_lower = matches['Label_Type'].astype(str).str.lower() if 'Label_Type' in matches.columns else None
    if label_types_lower is not None:
        main_records = matches[~label_types_lower.str.contains('jelly', na=False)]
        jelly_records = matches[label_types_lower.str.contains('jelly', na=False)]
    else:
        main_records = matches
        jelly_records = matches.iloc[0:0]  # empty

    # ── 主標(health_food / pet_food / insects / food / caution)
    food_single = ""
    insects_single = ""
    health_food_single = ""
    pet_food_single = ""
    used_status = None
    p_name = ""
    if not main_records.empty:
        try:
            best = get_best_results(main_records).fillna("")
            md = best.iloc[0].to_dict()
            p_name = str(md.get('Name', '') or md.get('Description', '')).strip()
            status = check_data_status(md)
            lt_str = str(md.get('Label_Type', '')).lower()
            # 🌟 特殊 label_type 優先(避免被 status='food' 抢先)
            if '保健食品' in lt_str or 'health_food' in lt_str:
                health_food_single = create_health_food_label_html(md, 1, FONT_PLACEHOLDER)
                used_status = 'health_food'
            elif 'pet food' in lt_str or 'pet_food' in lt_str:
                pet_food_single = create_pet_food_label_html(md, 1, FONT_PLACEHOLDER)
                used_status = 'pet_food'
            elif 'best before' in lt_str:
                # Best Before 只需 barcode + 商品名(日期員工手寫),用 Repack layout
                food_single = create_homey_repack_label_html(p_name, bc, 1, FONT_PLACEHOLDER)
                used_status = 'best_before'
            elif '蟲' in lt_str or 'insect' in lt_str:
                insects_single = create_insects_label_html(md, 1, FONT_PLACEHOLDER)
                used_status = 'insects'
            elif status == 'food':
                food_single = create_food_label_html(p_name, bc, md, 1, FONT_PLACEHOLDER)
                used_status = 'food'
            elif status == 'caution':
                ctext = smart_get_caution_text(md) or "Caution Column Empty"
                food_single = create_caution_html(ctext, 1)
                used_status = 'caution'
        except Exception as e:
            print(f"[label_tool] main render err: {e}")

    # ── Jelly 警告貼
    jelly_single = ""
    if not jelly_records.empty:
        jd = jelly_records.iloc[0].fillna("").to_dict()
        ctext = smart_get_caution_text(jd) or jd.get('Cautions', '')
        # 🌟 Cautions 空 → 用果凍標準警告字(所有果凍都應該有呢個警告)
        if not ctext or str(ctext).strip().lower() in ('', 'nan'):
            ctext = "注意:勿一口吞食,長者及兒童須在監護下食用。Caution: Do not swallow whole. Elderly and children must consume under supervision."
        jelly_single = generate_jelly_html(ctext, 1)

    # ── 合併 + ×qty
    if food_single and jelly_single:
        # food → jelly 一對 × qty
        html = _interleave_pair(food_single, jelly_single, req.qty)
        msg = f"food + jelly 交替 × {req.qty}"
    elif food_single:
        html = _multiply_label(food_single, req.qty)
        msg = f"{used_status} × {req.qty}"
    elif health_food_single:
        html = _multiply_label(health_food_single, req.qty)
        msg = f"health_food × {req.qty}"
    elif pet_food_single:
        html = _multiply_label(pet_food_single, req.qty)
        msg = f"pet_food × {req.qty}"
    elif insects_single:
        html = _multiply_label(insects_single, req.qty)
        msg = f"insects × {req.qty}"
    elif jelly_single:
        # 只有 Jelly,冇 food → 用 caution_html(等於 Yummy 嘅 fallback)
        ctext = smart_get_caution_text(jelly_records.iloc[0].fillna("").to_dict()) or "Caution"
        html = create_caution_html(ctext, req.qty)
        msg = f"jelly only × {req.qty}"
    else:
        raise HTTPException(status_code=404, detail="呢個產品冇可印嘅 label 資料(可能 master DB 入面冇 Label_Type 或營養資料)")

    # 🌟 font_css 改由 /api/master/font-css 獨立 endpoint
    return {"html": html, "message": msg}


# ────────────────────────────────────────────────────────────
# 3. 自助 Repack endpoint(用戶自由輸入 barcode + 名稱 + 數量)
# ────────────────────────────────────────────────────────────
class RepackRequest(BaseModel):
    barcode: str
    name: str = ""              # only_barcode=True 時可為空
    qty: int = 1
    only_barcode: bool = False  # 🚀 True:只 print 條碼圖 + 數字,唔印商品名


@router.post("/repack")
def print_repack(req: RepackRequest):
    """員工自定義 Repack Label。
    only_barcode=False(預設): Repack 標 = 條碼 + 商品名(同 Hello Bear/Homey 一樣)
    only_barcode=True:       純 Barcode 標 = 條碼圖 + 條碼數字,冇商品名
    一律 70mm × 50mm。
    """
    if not req.barcode.strip():
        raise HTTPException(status_code=400, detail="barcode 不能為空")
    if req.qty < 1 or req.qty > 500:
        raise HTTPException(status_code=400, detail="數量必須喺 1-500 之間")

    if req.only_barcode:
        single = create_barcode_only_label_html(req.barcode.strip(), 1, FONT_PLACEHOLDER)
    else:
        if not req.name.strip():
            raise HTTPException(status_code=400, detail="商品名稱不能為空(或啟用『只係 Barcode』模式)")
        single = create_homey_repack_label_html(req.name.strip(), req.barcode.strip(), 1, FONT_PLACEHOLDER)

    html = _multiply_label(single, req.qty)
    return {"html": html}


# ────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────
def _multiply_label(single_html: str, qty: int) -> str:
    """將 single label HTML 嘅 body 內容 × qty。"""
    if qty <= 1:
        return single_html
    m = _regex.search(r"<body[^>]*>(.*?)</body>", single_html, _regex.DOTALL)
    if not m:
        return single_html
    body_inner = m.group(1)
    return single_html.replace(body_inner, body_inner * qty)


def _interleave_pair(food_html: str, jelly_div: str, qty: int) -> str:
    """food + jelly 一對 × qty(food → jelly → food → jelly...)."""
    m = _regex.search(r"<body[^>]*>(.*?)</body>", food_html, _regex.DOTALL)
    if not m:
        return food_html
    food_body = m.group(1)
    pair = food_body + (jelly_div or "")
    return food_html.replace(food_body, pair * qty)
