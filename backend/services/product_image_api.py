"""
商品圖片 lazy lookup API。

流程:
  GET /api/product_image/?sku=LOTT-112488
  1. Supabase product_images cache 有 → 即刻返
  2. 冇 → 由 search DB 搵 SKU 嘅完整 HKTV code (AdditionalAttribute 欄,
     格式 H0956006_S_LOTT-112488) → fetch hktvmall.com/p/{code} 頁面
     → 抽 og:image → 存 cache → 返
  3. 搵唔到 code / 頁面 Oops → cache status='not_found',下次唔再試

圖片本身 host 喺 HKTVmall 公開 CDN(cdn-media.hktvmall.com),
前端直接 hotlink,唔使我哋存圖。
"""
import os
import re
import requests
from fastapi import APIRouter, Query
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

_supabase = None
def _get_supabase():
    global _supabase
    if _supabase is None and SUPABASE_URL and SUPABASE_KEY:
        try:
            from supabase import create_client
            _supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        except Exception as e:
            print(f"[product_image] supabase init fail: {e}")
    return _supabase

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

HKTV_CODE_RE = re.compile(r'^[A-Z]\d{7}_S_')


def find_hktv_code(sku: str) -> str:
    """由 search DB 個 row 嘅 AdditionalAttribute 欄搵完整 HKTV 商品碼。"""
    try:
        from services.unified_api import load_search_db
        df = load_search_db()
        if df is None or df.empty:
            return ""
        col = "ProductCode" if "ProductCode" in df.columns else "Product_No"
        rows = df[df[col].astype(str).str.strip() == sku.strip()]
        if rows.empty:
            return ""
        row = rows.iloc[0]
        for k, v in row.items():
            s = str(v).strip()
            if s and HKTV_CODE_RE.match(s):
                return s
    except Exception as e:
        print(f"[product_image] find_hktv_code fail: {e}")
    return ""


def fetch_og_image(full_code: str):
    """Fetch hktvmall.com/p/{code},抽 og:image。

    Returns:
        str  — 圖片 URL(搵到)
        ""   — 商品真係唔存在(Oops / 冇 og:image)→ 可以 cache not_found
        None — 網絡錯誤(transient)→ 唔好 cache,下次再試
    """
    url = f"https://www.hktvmall.com/p/{full_code}"
    headers = {"User-Agent": UA, "Accept-Language": "zh-HK,zh;q=0.9"}
    try:
        with requests.get(url, headers=headers, timeout=(10, 25),
                          stream=True, allow_redirects=True) as r:
            if r.status_code != 200:
                return None  # 5xx/403 等當 transient
            buf = b""
            for chunk in r.iter_content(16384):
                buf += chunk
                # og:image:secure_url 排喺 og:image 之後 → 見到佢就保證 og:image 完整
                if b"og:image:secure_url" in buf or len(buf) > 500_000:
                    break
            html = buf.decode("utf-8", errors="ignore")
            if "<title>Oops" in html:
                return ""
            # HKTV 將 og:image 藏喺 JSON MetaTagData:{"name":"og:image","content":"URL"}
            m = re.search(r'"name"\s*:\s*"og:image"\s*,\s*"content"\s*:\s*"([^"]+)"', html)
            if not m:
                # fallback: 標準 HTML meta tag 格式
                m = re.search(r'og:image"\s+content="([^"]+)"', html)
            return m.group(1) if m else ""
    except Exception as e:
        print(f"[product_image] fetch fail {full_code}: {type(e).__name__}")
        return None


@router.get("/")
def get_product_image(sku: str = Query(..., min_length=1)):
    sku = sku.strip()
    sb = _get_supabase()

    # 1. cache lookup
    if sb is not None:
        try:
            res = sb.table("product_images").select("*").eq("sku", sku).execute()
            if res.data:
                row = res.data[0]
                return {"sku": sku, "image_url": row.get("image_url") or "",
                        "status": row.get("status"), "cached": True}
        except Exception as e:
            print(f"[product_image] cache read fail: {e}")

    # 2. resolve code + live fetch
    code = find_hktv_code(sku)
    img = fetch_og_image(code) if code else ""

    if img is None:
        # transient 網絡錯誤 → 唔 cache,下次 request 再試
        return {"sku": sku, "image_url": "", "status": "error", "cached": False}

    status = "ok" if img else "not_found"

    # 3. save cache (真 not_found 都 cache,避免每次都翻 fetch)
    if sb is not None:
        try:
            sb.table("product_images").upsert({
                "sku": sku, "hktv_code": code, "image_url": img, "status": status,
            }).execute()
        except Exception as e:
            print(f"[product_image] cache write fail: {e}")

    return {"sku": sku, "image_url": img, "status": status, "cached": False}
