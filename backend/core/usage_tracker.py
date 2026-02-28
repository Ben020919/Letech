import streamlit as st
from supabase import create_client, Client

# ========================================================
# 1. 初始化 Supabase 連線
# ========================================================
@st.cache_resource
def init_connection():
    try:
        # 從 Streamlit Secrets 讀取網址與金鑰
        url = st.secrets["SUPABASE_URL"]
        key = st.secrets["SUPABASE_KEY"]
        return create_client(url, key)
    except Exception as e:
        print("❌ Supabase 連線失敗，請檢查 Streamlit Secrets 設定！")
        return None

supabase = init_connection()

# ========================================================
# 2. 讀取統計數據
# ========================================================
def load_stats():
    """從 Supabase 資料庫讀取統計數據"""
    if supabase is None:
        return {}
        
    try:
        # 從 Supabase 抓取所有數據
        response = supabase.table("usage_stats").select("*").execute()
        
        # 將資料轉換成原本 JSON 的字典格式 (Dict)
        stats = {}
        for row in response.data:
            stats[row['action_name']] = row['action_count']
        return stats
    except Exception as e:
        print(f"Error loading stats from Supabase: {e}")
        return {}

# ========================================================
# 3. 記錄動作次數 (+1)
# ========================================================
def log_action(action_name):
    """
    每次觸發功能時，將對應的 action_name 次數 +1 並寫入 Supabase
    """
    if supabase is None:
        return
        
    try:
        # 先查詢目前資料庫中的次數
        response = supabase.table("usage_stats").select("action_count").eq("action_name", action_name).execute()
        
        # 如果資料庫裡已經有這個功能，抓出它的數字；如果沒有，就是 0
        if len(response.data) > 0:
            current_count = response.data[0]['action_count']
        else:
            current_count = 0
            
        # 次數加 1
        new_count = current_count + 1
        
        # 將新的數字寫回 Supabase 
        # (upsert 的意思是：如果 action_name 存在就更新數字，不存在就建立新的一列)
        supabase.table("usage_stats").upsert({
            "action_name": action_name, 
            "action_count": new_count
        }).execute()
        
    except Exception as e:
        print(f"Error logging action to Supabase: {e}")
