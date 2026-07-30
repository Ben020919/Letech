"""
Gym check-in sync API.
單一使用者(user Ben),用 password 保護,data 存 Supabase gym_data table。
"""
import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("缺少 SUPABASE_URL 或 SUPABASE_KEY 環境變數")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
router = APIRouter()

GYM_PASSWORD = "020919"   # 同前端 gate 一樣
ROW_ID = "main"           # 單一 row


class GymPayload(BaseModel):
    password: str
    plan: dict | None = None
    logs: dict | None = None
    reasons: dict | None = None


def _check_password(pw: str):
    if pw != GYM_PASSWORD:
        raise HTTPException(status_code=401, detail="密碼錯誤")


@router.get("/data")
def get_gym_data(password: str = ""):
    """讀取現有 gym 資料。password 用 query string 傳入。"""
    _check_password(password)
    try:
        res = supabase.table("gym_data").select("*").eq("id", ROW_ID).execute()
        rows = res.data or []
        if not rows:
            # Table 空 → 返回空 shell
            return {"plan": None, "logs": {}, "reasons": {}, "updated_at": None}
        row = rows[0]
        return {
            "plan": row.get("plan"),
            "logs": row.get("logs") or {},
            "reasons": row.get("reasons") or {},
            "updated_at": row.get("updated_at"),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"讀取失敗: {e}")


@router.post("/data")
def save_gym_data(payload: GymPayload):
    """整份 upsert (plan + logs + reasons)。缺少嘅欄唔改。"""
    _check_password(payload.password)
    try:
        update_data = {"id": ROW_ID}
        if payload.plan is not None:
            update_data["plan"] = payload.plan
        if payload.logs is not None:
            update_data["logs"] = payload.logs
        if payload.reasons is not None:
            update_data["reasons"] = payload.reasons
        # Supabase upsert
        res = supabase.table("gym_data").upsert(update_data).execute()
        return {"status": "success", "row": res.data[0] if res.data else None}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"儲存失敗: {e}")
