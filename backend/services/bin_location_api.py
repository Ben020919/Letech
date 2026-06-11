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
        note text DEFAULT '',
        created_at timestamptz DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_bin_locations_sku ON bin_locations (lower(sku));
    CREATE INDEX IF NOT EXISTS idx_bin_locations_barcode ON bin_locations (barcode);
"""
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
            "bins": [{"id": b["id"], "bin": b["bin"], "note": b.get("note", "")} for b in bins],
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
    bins = [{"id": b["id"], "bin": b["bin"], "note": b.get("note", "")} for b in (res.data or [])]

    return {"sku": sku, "barcode": barcode, "name": name or "(無名稱)", "bins": bins}


# ────────────────────────────────────────────────────────────
# 3. 加倉位
# ────────────────────────────────────────────────────────────
class AddBinReq(BaseModel):
    sku: str
    barcode: str = ""
    name: str = ""
    bin: str
    note: str = ""


@router.post("/add")
def add_bin(req: AddBinReq):
    sku = req.sku.strip()
    bin_val = req.bin.strip()
    if not sku:
        raise HTTPException(status_code=400, detail="SKU 不能為空")
    if not bin_val:
        raise HTTPException(status_code=400, detail="倉位不能為空")

    # 避免同一個 SKU 重複加完全一樣嘅倉位
    existing = supabase.table("bin_locations").select("id").eq("sku", sku).eq("bin", bin_val).execute()
    if existing.data:
        raise HTTPException(status_code=409, detail=f"SKU {sku} 已經有倉位 {bin_val}")

    supabase.table("bin_locations").insert({
        "sku": sku,
        "barcode": req.barcode.strip(),
        "name": req.name.strip(),
        "bin": bin_val,
        "note": req.note.strip(),
    }).execute()
    return {"status": "success", "message": f"已加倉位 {bin_val} 俾 {sku}"}


# ────────────────────────────────────────────────────────────
# 4. 刪倉位
# ────────────────────────────────────────────────────────────
class RemoveBinReq(BaseModel):
    id: str


@router.post("/remove")
def remove_bin(req: RemoveBinReq):
    if not req.id:
        raise HTTPException(status_code=400, detail="缺少 id")
    supabase.table("bin_locations").delete().eq("id", req.id).execute()
    return {"status": "success", "message": "已刪除倉位"}
