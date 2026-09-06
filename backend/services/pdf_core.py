"""共用的 PDF / 條碼工具。

原本 anymall / hello / yummy / homey 各自重複一份 delete_file_later 與
generate_barcode_b64,現集中於此,各 service 直接 import 使用。
"""

import os
import io
import gc
import base64
import asyncio
import barcode
from barcode.writer import ImageWriter


async def delete_file_later(file_path: str):
    """暫存 PDF 於 5 分鐘後自動刪除,並回收記憶體。"""
    await asyncio.sleep(300)
    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except Exception:
            pass
    gc.collect()


def generate_barcode_b64(data: str) -> str:
    """產生 Code128 條碼圖,回傳 base64 data URI;失敗回傳空字串。"""
    try:
        Code128 = barcode.get_barcode_class('code128')
        rv = io.BytesIO()
        Code128(data, writer=ImageWriter()).write(
            rv, options={"write_text": False, "module_height": 10.0, "quiet_zone": 1.0}
        )
        b64 = base64.b64encode(rv.getvalue()).decode("utf-8")
        return f"data:image/png;base64,{b64}"
    except Exception:
        return ""


def parse_new_format_page(lines):
    """解析 2026-08 新格式 3PL label PDF 頁面。

    新格式一頁一商品:
        SKU                          (第一行)
        [SKU] 商品名(可能多行)        (或者冇 [SKU] prefix)
        Exp Date: YYYYMMDD           (可選,Yummy 先有)
        數量: N
        *BARCODE*                    (可以係 EAN 或 SKU,可帶字母)
        YYYYMMDD                     (可選,Yummy 頁尾重複日期)

    認到(有「數量:」行)就回傳 dict,認唔到回傳 None → caller 行舊格式邏輯。
    """
    import re as _re

    qty_idx = -1
    qty = 1
    for idx, line in enumerate(lines):
        m = _re.match(r'^數量\s*[:：]\s*(\d+)\s*$', line.strip())
        if m:
            qty_idx = idx
            qty = int(m.group(1))
            break
    if qty_idx == -1:
        return None  # 唔係新格式

    p_no = lines[0].strip() if lines else "Unknown"

    # 商品名 = SKU 之後、(Exp Date / 數量)之前嘅行,去走 [SKU] prefix
    exp_date = ""
    name_parts = []
    for line in lines[1:qty_idx]:
        m_exp = _re.match(r'^Exp\s*Date\s*[:：]\s*(\d{8})\s*$', line.strip(), _re.IGNORECASE)
        if m_exp:
            exp_date = m_exp.group(1)
            continue
        name_parts.append(line.strip())
    p_name = " ".join(name_parts)
    p_name = _re.sub(r'^\[[^\]]*\]\s*', '', p_name).strip()

    # barcode = 數量行之後第一個 *...* 包住嘅內容
    barcode_val = ""
    for line in lines[qty_idx + 1:]:
        m_bc = _re.search(r'\*\s*([^*]+?)\s*\*', line)
        if m_bc:
            barcode_val = _re.sub(r'\s', '', m_bc.group(1))
            break
    if not barcode_val:
        barcode_val = p_no

    return {
        "p_no": p_no,
        "name": p_name,
        "qty": qty,
        "barcode": barcode_val,
        "exp_date": exp_date,
    }
