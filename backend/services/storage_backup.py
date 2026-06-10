"""Supabase Storage 備份 helper.

Render free tier 嘅 disk 每次 redeploy 都 reset,用戶上傳嘅
`data.xlsx` / `search_data.csv` 就會消失。
呢個 helper 將呢啲 file mirror 到 Supabase Storage(`wms-backups` bucket),
等下次啟動 / cold start 之後可以自動 restore 返。

Best-effort:Storage 出錯都唔會 crash 個 app,只係 log error。
"""
import os
from typing import Optional

try:
    from supabase import create_client, Client  # type: ignore
    _HAVE_SUPABASE = True
except ImportError:
    _HAVE_SUPABASE = False

BUCKET = os.getenv("SUPABASE_STORAGE_BUCKET", "wms-backups")

_client: Optional["Client"] = None


def _get_client():
    """Lazy-init Supabase client。冇 env vars 嘅話 return None,所有操作變 no-op。"""
    global _client
    if _client is not None:
        return _client
    if not _HAVE_SUPABASE:
        return None
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        return None
    try:
        _client = create_client(url, key)
    except Exception as e:
        print(f"[storage_backup] Supabase client init failed: {e}")
        return None
    return _client


def upload_to_storage(local_path: str, remote_name: str) -> bool:
    """將本地 file mirror 到 Supabase Storage。Upsert = 覆蓋舊版本。"""
    client = _get_client()
    if client is None:
        return False
    if not os.path.exists(local_path):
        print(f"[storage_backup] upload skipped — 本地 file 唔存在: {local_path}")
        return False
    try:
        with open(local_path, "rb") as f:
            data = f.read()
        # supabase-py 嘅 upsert 語法兼容多版本:用 string 'true'
        try:
            client.storage.from_(BUCKET).upload(
                path=remote_name,
                file=data,
                file_options={"upsert": "true", "content-type": "application/octet-stream"},
            )
        except Exception:
            # 後備方案:先刪舊再上載
            try:
                client.storage.from_(BUCKET).remove([remote_name])
            except Exception:
                pass
            client.storage.from_(BUCKET).upload(path=remote_name, file=data)
        print(f"[storage_backup] uploaded {local_path} -> {BUCKET}/{remote_name} ({len(data)} bytes)")
        return True
    except Exception as e:
        print(f"[storage_backup] upload failed for {remote_name}: {e}")
        return False


def restore_from_storage(local_path: str, remote_name: str) -> bool:
    """由 Supabase Storage 攞返 file 寫入本地。仲喺度嘅話直接 return True。"""
    if os.path.exists(local_path):
        return True  # already present
    client = _get_client()
    if client is None:
        return False
    try:
        data = client.storage.from_(BUCKET).download(remote_name)
        if not data:
            return False
        os.makedirs(os.path.dirname(local_path) or ".", exist_ok=True)
        with open(local_path, "wb") as f:
            f.write(data)
        print(f"[storage_backup] restored {BUCKET}/{remote_name} -> {local_path} ({len(data)} bytes)")
        return True
    except Exception as e:
        # 通常因為 remote 都冇 file(第一次部署)
        print(f"[storage_backup] restore skipped for {remote_name}: {e}")
        return False


def restore_one_of(candidates: list) -> Optional[str]:
    """畀一個 `(local_path, remote_name)` 嘅 list,逐個試 restore,
    return 第一個成功嘅 local_path,全部失敗 return None。
    主要用於有 .csv / .xlsx 唔同 extension 嘅情況。"""
    for local_path, remote_name in candidates:
        if os.path.exists(local_path):
            return local_path
    for local_path, remote_name in candidates:
        if restore_from_storage(local_path, remote_name):
            return local_path
    return None
