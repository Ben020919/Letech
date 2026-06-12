"""📍 Bin Location(倉位)API.

員工想知道一件貨喺倉庫邊個位置。數據存喺 Supabase `bin_locations` 表,
系統內可即時加/刪,多人協作。一個 SKU 可以有多個倉位。

Supabase schema(喺 SQL Editor 跑一次):
    CREATE TABLE IF NOT EXISTS bin_locations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        sku text NOT NULL,
        barcode text DEFAULT '',
        name text DEFAULT '',
        bin text NOT NULL,
        loc_type text DEFAULT '貨架',   -- '貨架'(shelf) 或 '板位'(pallet)
        note text DEFAULT '',
        created_at timestamptz DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_bin_locations_sku ON bin_locations (lower(sku));
    CREATE INDEX IF NOT EXISTS idx_bin_locations_barcode ON bin_locations (barcode);

如果之前已建表,加欄:
    ALTER TABLE bin_locations ADD COLUMN IF NOT EXISTS loc_type text DEFAULT '貨架';
"""

VALID_LOC_TYPES = ("貨架", "板位")
import os
from typing import List, Dict, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase import create_client, Client
from dotenv import load_dotenv

from services.unified_api import load_search_db

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("缺少 SUPABASE_URL 或 SUPABASE_KEY 環境變數")

# 🔒 刪除倉位嘅密碼(只有 Full Time 同事知)。喺 Render env / .env 設 BIN_DELETE_PASSWORD。
# 唔設嘅話冇人刪到(安全 default)。
BIN_DELETE_PASSWORD = os.getenv("BIN_DELETE_PASSWORD", "")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
router = APIRouter()


def _bins_by_sku(skus: List[str]) -> Dict[str, List[dict]]:
    """一次過攞一堆 SKU 嘅所有倉位 → {sku: [bin rows]}。"""
    if not skus:
        return {}
    out: Dict[str, List[dict]] = {}
    # 分批(Supabase .in_ URL 太長會出事)
    chunk = 100
    for i in range(0, len(skus), chunk):
        part = skus[i:i + chunk]
        res = supabase.table("bin_locations").select("*").in_("sku", part).execute()
        for row in (res.data or []):
            out.setdefault(row["sku"], []).append(row)
    return out


def _bin_sort_key(b: dict):
    """FIFO 排序:有日期嘅排前(舊→新),冇日期嘅排最後。"""
    d = (b.get("stock_date") or "").strip()
    # 空日期 → 排最後(用一個好大嘅字串);有日期 → 直接用 ISO 字串排序(YYYY-MM-DD 字典序 = 時間序)
    return (1, "") if not d else (0, d)


def _format_bin(b: dict) -> dict:
    """統一 output 一個 bin 嘅 display 欄位。"""
    return {
        "id": b["id"],
        "bin": b["bin"],
        "loc_type": b.get("loc_type") or "貨架",
        "stock_date": (b.get("stock_date") or ""),
        "note": b.get("note", ""),
    }


def _sorted_formatted_bins(rows: List[dict]) -> List[dict]:
    return [_format_bin(b) for b in sorted(rows, key=_bin_sort_key)]


# ────────────────────────────────────────────────────────────
# 1. 搜尋:由智能查詢中心嘅 search DB 揾產品,再 attach 倉位
# ────────────────────────────────────────────────────────────
@router.get("/search")
def search_bin(q: str, limit: int = 50):
    q = (q or "").strip()
    if not q:
        return {"results": []}

    df = load_search_db()
    if df is None or df.empty:
        return {"results": [], "warning": "智能查詢中心嘅資料庫未載入"}

    q_low = q.lower()
    matched = df[df['_combined_search_text'].str.contains(q_low, na=False, regex=False)].head(limit)

    # 收集 SKU 一次過攞倉位
    rows = []
    for _, row in matched.iterrows():
        sku = str(row.get("ProductCode", row.get("Product_No", ""))).strip()
        barcode = str(row.get("Barcode", "")).strip()
        name = str(row.get("Name", row.get("Description", ""))).strip()
        if name.upper() == "NAN":
            name = ""
        if barcode.upper() == "NAN":
            barcode = ""
        rows.append({"sku": sku, "barcode": barcode, "name": name or "(無名稱)"})

    bins_map = _bins_by_sku([r["sku"] for r in rows if r["sku"]])

    results = []
    for r in rows:
        bins = bins_map.get(r["sku"], [])
        results.append({
            **r,
            "bins": _sorted_formatted_bins(bins),
        })
    return {"results": results}


# ────────────────────────────────────────────────────────────
# 2. 精準 lookup(掃 barcode 用):直接由 bin_locations + search DB
# ────────────────────────────────────────────────────────────
@router.get("/lookup")
def lookup_bin(barcode: str = "", sku: str = ""):
    barcode = (barcode or "").strip()
    sku = (sku or "").strip()
    if not barcode and not sku:
        raise HTTPException(status_code=400, detail="要俾 barcode 或 sku")

    # 先由 search DB 補返產品資料
    name = ""
    df = load_search_db()
    if df is not None and not df.empty:
        if barcode:
            m = df[df['Barcode'].astype(str).str.strip() == barcode]
        else:
            pcol = 'ProductCode' if 'ProductCode' in df.columns else 'Product_No'
            m = df[df[pcol].astype(str).str.strip() == sku]
        if not m.empty:
            row = m.iloc[0]
            if not sku:
                sku = str(row.get("ProductCode", row.get("Product_No", ""))).strip()
            if not barcode:
                barcode = str(row.get("Barcode", "")).strip()
            name = str(row.get("Name", row.get("Description", ""))).strip()

    query = supabase.table("bin_locations").select("*")
    if sku:
        query = query.eq("sku", sku)
    else:
        query = query.eq("barcode", barcode)
    res = query.execute()
    bins = _sorted_formatted_bins(res.data or [])

    return {"sku": sku, "barcode": barcode, "name": name or "(無名稱)", "bins": bins}


# ────────────────────────────────────────────────────────────
# 3. 加倉位
# ────────────────────────────────────────────────────────────
def _norm_date(s: str):
    """'2024-01-15' → '2024-01-15';空 → None。簡單驗證 YYYY-MM-DD。"""
    s = (s or "").strip()
    if not s:
        return None
    import re as _re
    if not _re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        raise HTTPException(status_code=400, detail=f"日期格式要 YYYY-MM-DD,收到:{s}")
    return s


class AddBinReq(BaseModel):
    sku: str
    barcode: str = ""
    name: str = ""
    bin: str
    loc_type: str = "貨架"   # '貨架' 或 '板位'
    stock_date: str = ""      # 批次日期 YYYY-MM-DD(可空)
    note: str = ""


@router.post("/add")
def add_bin(req: AddBinReq):
    sku = req.sku.strip()
    bin_val = req.bin.strip()
    loc_type = req.loc_type.strip() if req.loc_type.strip() in VALID_LOC_TYPES else "貨架"
    stock_date = _norm_date(req.stock_date)
    if not sku:
        raise HTTPException(status_code=400, detail="SKU 不能為空")
    if not bin_val:
        raise HTTPException(status_code=400, detail="位置不能為空")

    # 避免同一個 SKU + 同類型 + 同位置 + 同日期 重複
    existing = (
        supabase.table("bin_locations").select("id")
        .eq("sku", sku).eq("bin", bin_val).eq("loc_type", loc_type).execute()
    )
    dup = [r for r in (existing.data or [])]
    # 進一步用 stock_date 區分(允許同位置不同日期)
    if dup:
        same_date = (
            supabase.table("bin_locations").select("id")
            .eq("sku", sku).eq("bin", bin_val).eq("loc_type", loc_type)
        )
        if stock_date:
            same_date = same_date.eq("stock_date", stock_date)
        else:
            same_date = same_date.is_("stock_date", "null")
        if same_date.execute().data:
            raise HTTPException(status_code=409, detail=f"SKU {sku} 嘅{loc_type} {bin_val}({stock_date or '無日期'})已經有")

    supabase.table("bin_locations").insert({
        "sku": sku,
        "barcode": req.barcode.strip(),
        "name": req.name.strip(),
        "bin": bin_val,
        "loc_type": loc_type,
        "stock_date": stock_date,
        "note": req.note.strip(),
    }).execute()
    return {"status": "success", "message": f"已加{loc_type} {bin_val} 俾 {sku}"}


# ────────────────────────────────────────────────────────────
# 3b. 改日期(FIFO:舊貨執晒就改/刪)
# ────────────────────────────────────────────────────────────
class UpdateBinReq(BaseModel):
    id: str
    stock_date: str = ""   # 新日期 YYYY-MM-DD,空 = 清走日期


@router.post("/update")
def update_bin(req: UpdateBinReq):
    if not req.id:
        raise HTTPException(status_code=400, detail="缺少 id")
    stock_date = _norm_date(req.stock_date)
    supabase.table("bin_locations").update({"stock_date": stock_date}).eq("id", req.id).execute()
    return {"status": "success", "message": "已更新日期"}


# ────────────────────────────────────────────────────────────
# 4. 刪倉位
# ────────────────────────────────────────────────────────────
class RemoveBinReq(BaseModel):
    id: str
    password: str = ""


@router.post("/remove")
def remove_bin(req: RemoveBinReq):
    if not req.id:
        raise HTTPException(status_code=400, detail="缺少 id")
    # 🔒 權限檢查:只有知道密碼嘅 Full Time 同事先可以刪
    if not BIN_DELETE_PASSWORD:
        raise HTTPException(status_code=500, detail="系統未設定刪除密碼(請喺 Render 設 BIN_DELETE_PASSWORD)")
    if (req.password or "").strip() != BIN_DELETE_PASSWORD:
        raise HTTPException(status_code=403, detail="密碼錯誤,只有 Full Time 同事先可以刪除舊貨位置")
    supabase.table("bin_locations").delete().eq("id", req.id).execute()
    return {"status": "success", "message": "已刪除位置"}
