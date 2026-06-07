#!/usr/bin/env bash
# 一鍵啟動 Letech 前後端
# 用法: ./start.sh   (或者 bash start.sh)
# 停止: Ctrl+C 一次,會一齊收兩個 server

set -u

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BACK_PID=""
FRONT_PID=""

cleanup() {
  echo ""
  echo "🛑 停止前後端..."
  [ -n "$BACK_PID" ] && kill "$BACK_PID" 2>/dev/null
  [ -n "$FRONT_PID" ] && kill "$FRONT_PID" 2>/dev/null
  wait 2>/dev/null
  exit 0
}
trap cleanup INT TERM

echo "📦 Letech — 一鍵啟動"
echo "   專案目錄: $PROJECT_ROOT"
echo ""

# === 1. 後端 ===
if [ ! -f "$PROJECT_ROOT/backend/venv/bin/activate" ]; then
  echo "❌ 找不到 backend/venv,請先建立 venv 並 pip install -r backend/requirements.txt"
  exit 1
fi

echo "→ 啟動 backend (http://127.0.0.1:8000)..."
(
  cd "$PROJECT_ROOT/backend"
  # shellcheck disable=SC1091
  source venv/bin/activate
  # 注意:唔用 --reload,因為 macOS 上 uvicorn reload 嘅 multiprocessing.spawn
  # 有時會令 worker 永遠 sleeping。改咗 Python code 後手動 Ctrl+C 再行一次。
  exec uvicorn main:app --port 8000
) &
BACK_PID=$!

# 等少少俾後端啲 log 行先
sleep 1

# === 2. 前端 ===
if [ ! -d "$PROJECT_ROOT/frontend/node_modules" ]; then
  echo "⚠️  frontend/node_modules 唔存在,執行 npm install..."
  (cd "$PROJECT_ROOT/frontend" && npm install)
fi

echo "→ 啟動 frontend (http://localhost:5173)..."
(
  cd "$PROJECT_ROOT/frontend"
  exec npm run dev
) &
FRONT_PID=$!

echo ""
echo "✅ 已啟動:"
echo "   Backend  pid=$BACK_PID  →  http://127.0.0.1:8000  (Swagger: /docs)"
echo "   Frontend pid=$FRONT_PID  →  http://localhost:5173"
echo ""
echo "   ⏳ 首次啟動 fastapi/pandas 載入需要 10–30 秒,請耐心等到出"
echo "      'Application startup complete.' 同 Vite 嘅 'ready in ...' 才算成功"
echo ""
echo "   按 Ctrl+C 停止兩個 server"
echo ""

wait
