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
