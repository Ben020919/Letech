from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import shutil # 🌟 引入檔案清理工具
from routers import inspection 

# 匯入各個模組
from services.search_tool import router as search_router
from services.stats_api import router as stats_router
from services.yummy_api import router as yummy_router
from services.anymall_api import router as anymall_router
from services.hello_api import router as hellobear_router
from services.homey_api import router as homey_router 
from services.food_label_api import router as food_label_router
from services.chat_api import router as chat_router
from services.master_api import router as master_router
from services.inventory_api import router as inventory_router # 👇 新增這行：匯入我們剛寫好的 DEAR 庫存 API

app = FastAPI()

# 允許跨域請求 (讓前端可以連線)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =====================================================================
# 🌟 終極硬碟防護：每次 Render 啟動時，無情清空所有舊的 PDF 殘留檔案！
# =====================================================================
PDF_DIR = "generated_pdfs"
if os.path.exists(PDF_DIR):
    shutil.rmtree(PDF_DIR) # 砍掉整個資料夾與裡面的所有檔案
os.makedirs(PDF_DIR, exist_ok=True) # 重新建立一個乾淨的空資料夾

# 掛載乾淨的資料夾，讓前端可以下載檔案
app.mount("/generated_pdfs", StaticFiles(directory=PDF_DIR), name="generated_pdfs")


# 註冊路由
app.include_router(stats_router, prefix="/api/stats", tags=["Stats"])
app.include_router(search_router, prefix="/api/search", tags=["Search"])
app.include_router(yummy_router, prefix="/api/yummy", tags=["Yummy"])
app.include_router(anymall_router, prefix="/api/anymall", tags=["Anymall"])
app.include_router(hellobear_router, prefix="/api/hellobear", tags=["HelloBear"])
app.include_router(homey_router, prefix="/api/homey", tags=["Homey"])
app.include_router(food_label_router, prefix="/api/food_label", tags=["FoodLabel"])
app.include_router(chat_router, prefix="/api/chat", tags=["Chat"])
app.include_router(master_router, prefix="/api/master", tags=["MasterDB"])
app.include_router(inspection.router, prefix="/api/inspection", tags=["Inspection"])
app.include_router(inventory_router, prefix="/api/inventory", tags=["Inventory"]) # 👇 新增這行：註冊庫存路由

@app.get("/")
def read_root():
    return {"message": "Letech 3PL System Backend is Running!"}