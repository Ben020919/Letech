import React, { useState, useEffect, useRef } from 'react';

// 🌟 動態判斷 API 網址：解決編譯器報錯的問題
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? "http://127.0.0.1:8000" 
    : "https://letech-pro.onrender.com";

// ================= 1. 內建音效產生器 (極速版) =================
let sharedAudioCtx = null;
const playSound = (type) => {
    try {
        if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = sharedAudioCtx.createOscillator();
        const gainNode = sharedAudioCtx.createGain();
        osc.connect(gainNode);
        gainNode.connect(sharedAudioCtx.destination);

        if (type === 'success') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, sharedAudioCtx.currentTime);
            gainNode.gain.setValueAtTime(0.5, sharedAudioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, sharedAudioCtx.currentTime + 0.3);
            osc.start();
            osc.stop(sharedAudioCtx.currentTime + 0.3);
            if (navigator.vibrate) navigator.vibrate(100); 
        } else {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(250, sharedAudioCtx.currentTime); 
            gainNode.gain.setValueAtTime(0.5, sharedAudioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, sharedAudioCtx.currentTime + 0.4); 
            osc.start();
            osc.stop(sharedAudioCtx.currentTime + 0.4);
            if (navigator.vibrate) navigator.vibrate(150); 
        }
    } catch (e) { console.log("音效播放失敗", e); }
};

export default function InspectionZone({ zoneName = "Anymall" }) {
    const apiZoneStr = zoneName.toLowerCase().replace(/\s/g, "");

    // 🌟 任務碼狀態：初始化時檢查 localStorage 是否有上次未離開的任務
    const [activeTaskCode, setActiveTaskCode] = useState(() => {
        return localStorage.getItem(`inspection_task_${apiZoneStr}`) || "";
    }); 
    const [joinInputCode, setJoinInputCode] = useState("");
    const [focusedItemId, setFocusedItemId] = useState(null);

    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [alertMsg, setAlertMsg] = useState(null);
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const [inputValue, setInputValue] = useState(""); 
    
    // 🌟 判斷是否為手機版，用於隱藏上傳區塊
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    const inputRef = useRef(null); 
    const topRef = useRef(null); 
    const itemsRef = useRef([]); 
    const rowRefs = useRef({}); 

    // 🌟 監聽任務碼變化：只要有進度就自動存入 localStorage，離開則清除
    useEffect(() => {
        if (activeTaskCode) {
            localStorage.setItem(`inspection_task_${apiZoneStr}`, activeTaskCode);
        } else {
            localStorage.removeItem(`inspection_task_${apiZoneStr}`);
        }
    }, [activeTaskCode, apiZoneStr]);

    // 監聽視窗大小改變 (RWD)
    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => { itemsRef.current = items; }, [items]);

    // ================= 2. 多人協作：定時獲取最新進度 =================
    const fetchTaskStatus = async () => {
        if (!activeTaskCode) return; 
        try {
            const res = await fetch(`${API_BASE_URL}/api/inspection/task/${apiZoneStr}/${activeTaskCode}`);
            const data = await res.json();
            if (data.status === "success" && data.task) {
                setItems(data.task.items);
            } else {
                // 🌟 防呆機制：如果後端找不到這個任務 (代表有人已經按了「結案清除」)，就自動重置所有人的畫面
                setItems([]); 
                if (data.status === "no_task") {
                    setActiveTaskCode("");
                }
            }
        } catch (err) { console.error("同步資料失敗", err); }
    };

    useEffect(() => {
        fetchTaskStatus();
        if (!activeTaskCode) return;
        const interval = setInterval(fetchTaskStatus, 2000);
        return () => clearInterval(interval);
    }, [apiZoneStr, activeTaskCode]);

    useEffect(() => {
        if (!isCameraOpen && inputRef.current && activeTaskCode) {
            inputRef.current.focus();
        }
    }, [isCameraOpen, activeTaskCode, focusedItemId]); 

    const handleContainerClick = (e) => {
        if (!isCameraOpen && activeTaskCode && e.target.tagName !== 'INPUT' && inputRef.current) {
            inputRef.current.focus();
        }
    };

    // ================= 3. 處理 PDF 上傳 (建立新任務) =================
    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append("file", file);

        setLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/inspection/upload/${apiZoneStr}`, {
                method: "POST", body: formData
            });
            
            if (!res.ok) {
                let errorMsg = "上傳失敗";
                try {
                    const errorData = await res.json();
                    errorMsg = errorData.detail || errorMsg;
                } catch (e) {
                    console.error("無法解析錯誤訊息", e);
                }
                throw new Error(errorMsg);
            }

            const data = await res.json();
            
            if (data.task_code) {
                setActiveTaskCode(data.task_code);
            } else if (data.status === 'success') {
                throw new Error("請確認您已將新的 inspection.py 部署到後端伺服器！(目前伺服器仍是舊版，因此無法產生任務碼)");
            } else {
                throw new Error("後端未返回任務碼");
            }
        } catch (error) { 
            alert("上傳異常：" + error.message); 
            console.error("上傳錯誤詳情:", error);
        } 
        finally { 
            setLoading(false); 
            e.target.value = null; 
        }
    };

    // ================= 4. 掃碼判定與更新後端 =================
    const updateItemQty = async (itemId, newQty, isScanner = false) => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/inspection/update/${apiZoneStr}`, {
                method: "POST",
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_id: itemId, scanned_qty: newQty })
            });
            
            if (res.ok) {
                const data = await res.json();
                setItems(prev => prev.map(i => i.id === itemId ? data.item : i));
                
                if (data.item.Scanned_Qty >= data.item.Target_Qty) {
                    if (!isScanner) playSound('success');
                } 
            }
        } catch (err) { console.error("更新數量失敗", err); }
    };

    const processBarcode = (scannedCode) => {
        if (itemsRef.current.length === 0) return;
        const cleanScanned = String(scannedCode).trim();
        
        let matchedItems = [];

        for (let item of itemsRef.current) {
            const pdfBarcode = String(item.Barcode).trim();
            const purePdfBarcode = pdfBarcode.replace(/[A-Za-z]+$/, ''); 
            
            if (pdfBarcode === cleanScanned || purePdfBarcode === cleanScanned) {
                matchedItems.push(item);
            } 
            else if (cleanScanned.length > 0 && cleanScanned.length <= 8) {
                 if (pdfBarcode.endsWith(cleanScanned) || purePdfBarcode.endsWith(cleanScanned)) {
                     matchedItems.push(item);
                 }
            }
        }

        if (matchedItems.length === 0) {
            playSound('error');
            showAlert("❌ 拿錯貨了！找不到此條碼：" + cleanScanned, "error");
        } else if (matchedItems.length > 1) {
            playSound('error');
            showAlert(`⚠️ 找到 ${matchedItems.length} 個符合的條碼，請輸入更長的尾數！`, "warning");
        } else {
            const targetItem = matchedItems[0];
            
            setFocusedItemId(targetItem.id);

            if (targetItem.Scanned_Qty < targetItem.Target_Qty) {
                playSound('success');
                updateItemQty(targetItem.id, targetItem.Scanned_Qty + 1, true); 
            } else {
                playSound('error');
                showAlert("⚠️ 數量已滿！請勿多拿！", "warning");
            }
        }

        setTimeout(() => setInputValue(""), 100);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && inputValue.trim()) {
            processBarcode(inputValue);
        }
    };

    const showAlert = (msg, type) => {
        setAlertMsg({ msg, type });
        setTimeout(() => setAlertMsg(null), 2500); 
    };

    // 🌟 結案並清除數據 (這會清空伺服器資料，並讓所有協作的人自動跳出)
    const clearTask = async () => {
        if (window.confirm("確定要「結案並清除數據」嗎？\n這會把雲端上這個任務的所有資料徹底重置，所有人也會一起結束任務喔！")) {
            await fetch(`${API_BASE_URL}/api/inspection/clear/${apiZoneStr}/${activeTaskCode}`, { method: "POST" });
            setActiveTaskCode(""); 
            setFocusedItemId(null);
            setItems([]);
        }
    };

    const exportCSV = () => {
        const headers = "商品編號,商品名稱,條碼,應檢數量,已掃數量,狀態\n";
        const rows = items.map(i => `${i.Product_No},${i.Name.replace(/,/g, " ")},${i.Barcode},${i.Target_Qty},${i.Scanned_Qty},${i.Status}`).join("\n");
        const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + encodeURIComponent(headers + rows);
        const link = document.createElement("a");
        link.href = csvContent;
        link.download = `${zoneName}_Task_${activeTaskCode}_檢測報告.csv`;
        link.click();
    };

    // ================= 🌟 UI 渲染：大廳 (Lobby) =================
    if (!activeTaskCode) {
        return (
            <div className="page-content" style={{ padding: '15px', fontFamily: 'sans-serif', maxWidth: '800px', margin: '0 auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '30px', gap: '15px' }}>
                    <button onClick={() => window.location.href = '/inspection'} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '10px 15px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>⬅️ 返回區域選擇</button>
                    <h2 style={{ fontSize: '28px', margin: 0, color: '#0f172a' }}>📦 {zoneName} 任務大廳</h2>
                </div>

                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                    {/* 建立新任務 - 手機版隱藏 */}
                    {!isMobile && (
                        <div style={{ flex: '1', minWidth: '300px', background: '#ffffff', padding: '30px', borderRadius: '20px', border: '2px dashed #cbd5e1', textAlign: 'center' }}>
                            <div style={{ fontSize: '40px', marginBottom: '10px' }}>📄</div>
                            <h3 style={{ color: '#0f172a', marginBottom: '15px' }}>建立新檢測任務</h3>
                            <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '20px' }}>上傳 PDF 將自動生成一組 5 位數任務碼</p>
                            <input type="file" accept="application/pdf" onChange={handleFileUpload} style={{ border: '1px solid #cbd5e1', padding: '10px', borderRadius: '8px', width: '100%', boxSizing: 'border-box' }} />
                            {loading && <p style={{ color: '#3b82f6', fontWeight: 'bold', marginTop: '15px' }}>⏳ 解析並生成任務中...</p>}
                        </div>
                    )}

                    {/* 加入現有任務 */}
                    <div style={{ flex: '1', minWidth: '300px', background: '#eff6ff', padding: '30px', borderRadius: '20px', border: '2px solid #bfdbfe', textAlign: 'center' }}>
                        <div style={{ fontSize: '40px', marginBottom: '10px' }}>🤝</div>
                        <h3 style={{ color: '#1e3a8a', marginBottom: '15px' }}>加入協作任務</h3>
                        <p style={{ color: '#3b82f6', fontSize: '14px', marginBottom: '20px' }}>請輸入同事建立的 5 位數任務碼</p>
                        <input 
                            type="text" maxLength={5} placeholder="例如: 49201"
                            value={joinInputCode} onChange={(e) => setJoinInputCode(e.target.value.replace(/\D/g, ''))}
                            style={{ width: '100%', padding: '15px', fontSize: '24px', textAlign: 'center', borderRadius: '10px', border: '2px solid #93c5fd', outline: 'none', fontWeight: 'bold', letterSpacing: '2px', boxSizing: 'border-box', marginBottom: '15px' }}
                        />
                        <button onClick={() => { if(joinInputCode.length === 5) setActiveTaskCode(joinInputCode); else alert("請輸入完整的 5 位數密碼"); }} style={{ background: '#2563eb', color: 'white', padding: '15px', fontSize: '18px', borderRadius: '10px', border: 'none', fontWeight: 'bold', cursor: 'pointer', width: '100%' }}>
                            🚀 進入任務
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // 計算進度
    const totalTarget = items.reduce((acc, curr) => acc + curr.Target_Qty, 0);
    const totalScanned = items.reduce((acc, curr) => acc + curr.Scanned_Qty, 0);
    const isAllCompleted = totalTarget > 0 && totalTarget === totalScanned;

    // 當前聚焦的商品
    const focusedItem = focusedItemId ? items.find(i => i.id === focusedItemId) : null;
    const isFocusedCompleted = focusedItem && focusedItem.Scanned_Qty >= focusedItem.Target_Qty;

    // ================= 🌟 UI 渲染：任務清單 與 沉浸畫面 =================
    return (
        <div className="page-content" onClick={handleContainerClick} style={{ padding: '15px', fontFamily: 'sans-serif', maxWidth: '1000px', margin: '0 auto' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    {/* 🌟 真正的暫時離開，不清除 localStorage 進度 */}
                    <button onClick={() => window.location.href = '/inspection'} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '10px 15px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                        ⬅️ 暫時離開 (保留進度)
                    </button>
                    <h2 style={{ fontSize: '24px', margin: 0, color: '#0f172a' }}>{zoneName}</h2>
                </div>
            </div>

            {/* 🌟 頂部常駐醒目任務碼提示區塊 */}
            <div style={{ background: '#eff6ff', border: '3px dashed #3b82f6', padding: '15px 25px', borderRadius: '16px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px', boxShadow: '0 4px 10px rgba(59, 130, 246, 0.1)' }}>
                <div>
                    <div style={{ fontSize: '15px', color: '#1e40af', fontWeight: 'bold', marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>當前協作任務碼</span>
                        <span style={{ background: '#dbeafe', color: '#1e3a8a', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' }}>系統已自動記憶，跳出不遺失</span>
                    </div>
                    <div style={{ fontSize: '38px', fontWeight: '900', color: '#1e3a8a', letterSpacing: '6px', fontFamily: 'monospace' }}>
                        {activeTaskCode}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button 
                        onClick={() => {
                            const tempInput = document.createElement('input');
                            tempInput.value = activeTaskCode;
                            document.body.appendChild(tempInput);
                            tempInput.select();
                            document.execCommand('copy');
                            document.body.removeChild(tempInput);
                            alert(`✅ 任務碼 ${activeTaskCode} 已複製！快貼給同事一起理貨吧！`);
                        }} 
                        style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '10px 15px', borderRadius: '10px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer', boxShadow: '0 4px 6px rgba(59, 130, 246, 0.2)' }}
                    >
                        📋 複製號碼給同事
                    </button>
                    {/* 🌟 獨立的換號碼按鈕，避免誤觸結案 */}
                    <button 
                        onClick={() => {
                            if(window.confirm("確定要退出這個任務碼嗎？\n(伺服器上的資料不會消失，但您需要重新輸入號碼才能再次進入)")) {
                                setActiveTaskCode(""); 
                                setFocusedItemId(null); 
                                setItems([]);
                            }
                        }} 
                        style={{ background: '#e2e8f0', color: '#475569', border: '1px solid #cbd5e1', padding: '10px 15px', borderRadius: '10px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer' }}
                    >
                        🔄 更換任務碼
                    </button>
                </div>
            </div>

            {/* 全局進度與工具列 */}
            {!focusedItem && items.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px', background: isAllCompleted ? '#dcfce7' : '#ffffff', padding: '10px 20px', borderRadius: '12px', border: `1px solid ${isAllCompleted ? '#bbf7d0' : '#e2e8f0'}`, marginBottom: '20px' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '18px', color: isAllCompleted ? '#166534' : '#0f172a' }}>
                        進度：{totalScanned} / {totalTarget} {isAllCompleted && '🎉 (全部齊貨)'}
                    </div>
                    {isAllCompleted && (
                        <>
                            <button onClick={exportCSV} style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>📥 下載</button>
                            <button onClick={clearTask} style={{ background: '#16a34a', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '15px' }}>✅ 結案並清除數據</button>
                        </>
                    )}
                </div>
            )}

            {/* 🌟 永遠存在的掃碼引擎 */}
            <div ref={topRef} style={{ marginBottom: '20px', background: '#f8fafc', padding: '15px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 10px rgba(0,0,0,0.05)' }}>
                <input 
                    ref={inputRef} type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={handleKeyDown} disabled={isCameraOpen} placeholder={focusedItem ? "在此畫面直接掃描下一件商品..." : "在此掃描，或輸入條碼末幾碼..."}
                    style={{ width: '100%', padding: '12px', fontSize: '18px', textAlign: 'center', borderRadius: '10px', border: '2px solid #3b82f6', outline: 'none', fontWeight: 'bold', color: '#0f172a', backgroundColor: isCameraOpen ? '#e2e8f0' : '#ffffff', boxSizing: 'border-box' }}
                />
            </div>

            {alertMsg && (
                <div style={{ position: 'fixed', top: '15%', left: '50%', transform: 'translateX(-50%)', backgroundColor: alertMsg.type === 'error' ? '#ef4444' : alertMsg.type === 'warning' ? '#f59e0b' : '#10b981', color: 'white', padding: '20px 30px', fontSize: '20px', fontWeight: '900', borderRadius: '12px', zIndex: 9999, boxShadow: '0 10px 25px rgba(0,0,0,0.3)', textAlign: 'center', width: '80%', maxWidth: '400px' }}>
                    {alertMsg.msg}
                </div>
            )}

            {/* ================= 🌟 沉浸式單品畫面 (Focused View) ================= */}
            {focusedItem ? (
                <div style={{ background: isFocusedCompleted ? '#dcfce7' : '#ffffff', borderRadius: '24px', padding: '40px 20px', border: `3px solid ${isFocusedCompleted ? '#22c55e' : '#3b82f6'}`, boxShadow: '0 20px 50px rgba(0,0,0,0.1)', textAlign: 'center', transition: 'background 0.3s' }}>
                    
                    <button onClick={() => setFocusedItemId(null)} style={{ background: '#0f172a', color: 'white', border: 'none', padding: '12px 25px', borderRadius: '12px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '30px', boxShadow: '0 4px 10px rgba(0,0,0,0.2)' }}>
                        🔙 確認完成，返回清單
                    </button>

                    <div style={{ fontSize: '24px', fontWeight: '900', color: '#475569', marginBottom: '10px', fontFamily: 'monospace' }}>
                        {focusedItem.Product_No}
                    </div>
                    
                    <div style={{ fontSize: '36px', fontWeight: '900', color: '#0f172a', marginBottom: '20px', lineHeight: '1.3' }}>
                        {focusedItem.Name}
                    </div>

                    <div style={{ background: isFocusedCompleted ? '#22c55e' : '#f1f5f9', display: 'inline-block', padding: '10px 20px', borderRadius: '12px', fontSize: '22px', fontWeight: 'bold', fontFamily: 'monospace', color: isFocusedCompleted ? 'white' : '#3b82f6', marginBottom: '40px' }}>
                        條碼: {focusedItem.Barcode}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '30px', marginBottom: '30px' }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '18px', color: '#64748b', fontWeight: 'bold', marginBottom: '10px' }}>目前已拿</div>
                            <div style={{ fontSize: '80px', fontWeight: '900', color: isFocusedCompleted ? '#166534' : '#2563eb', lineHeight: '1' }}>
                                {focusedItem.Scanned_Qty}
                            </div>
                        </div>
                        <div style={{ fontSize: '60px', color: '#cbd5e1', fontWeight: '300' }}>/</div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '18px', color: '#64748b', fontWeight: 'bold', marginBottom: '10px' }}>總共需要</div>
                            <div style={{ fontSize: '80px', fontWeight: '900', color: '#0f172a', lineHeight: '1' }}>
                                {focusedItem.Target_Qty}
                            </div>
                        </div>
                    </div>

                    {/* 🌟 升級版手動修改區：支援直接輸入、加1、一鍵加滿 */}
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px', flexWrap: 'wrap', background: '#f8fafc', padding: '20px', borderRadius: '16px', border: '1px dashed #cbd5e1' }}>
                        
                        {/* 手動輸入框 */}
                        <div style={{ display: 'flex', alignItems: 'center', background: '#ffffff', padding: '8px 12px', borderRadius: '12px', border: '2px solid #e2e8f0' }}>
                            <span style={{ fontSize: '16px', fontWeight: 'bold', color: '#64748b', marginRight: '10px' }}>自行輸入:</span>
                            <input 
                                type="number" 
                                min="0" 
                                max={focusedItem.Target_Qty}
                                value={focusedItem.Scanned_Qty}
                                onChange={(e) => updateItemQty(focusedItem.id, parseInt(e.target.value) || 0, false)}
                                style={{ width: '80px', padding: '10px', textAlign: 'center', fontSize: '24px', fontWeight: 'bold', borderRadius: '8px', border: '2px solid #cbd5e1', outline: 'none' }}
                            />
                        </div>

                        {/* 加 1 按鈕 */}
                        <button 
                            onClick={() => updateItemQty(focusedItem.id, focusedItem.Scanned_Qty + 1, false)}
                            disabled={isFocusedCompleted}
                            style={{ background: isFocusedCompleted ? '#cbd5e1' : '#3b82f6', color: 'white', border: 'none', padding: '15px 25px', borderRadius: '12px', fontSize: '20px', fontWeight: 'bold', cursor: isFocusedCompleted ? 'not-allowed' : 'pointer', boxShadow: isFocusedCompleted ? 'none' : '0 4px 15px rgba(59, 130, 246, 0.3)' }}
                        >
                            ➕ 加 1
                        </button>

                        {/* 一鍵加滿按鈕 */}
                        <button 
                            onClick={() => updateItemQty(focusedItem.id, focusedItem.Target_Qty, false)}
                            disabled={isFocusedCompleted}
                            style={{ background: isFocusedCompleted ? '#cbd5e1' : '#ea580c', color: 'white', border: 'none', padding: '15px 25px', borderRadius: '12px', fontSize: '20px', fontWeight: 'bold', cursor: isFocusedCompleted ? 'not-allowed' : 'pointer', boxShadow: isFocusedCompleted ? 'none' : '0 4px 15px rgba(234, 88, 12, 0.3)' }}
                        >
                            ⚡ 一鍵加滿
                        </button>

                    </div>

                    <p style={{ marginTop: '30px', color: '#64748b', fontSize: '15px', fontWeight: 'bold' }}>
                        💡 提示：在此畫面直接用掃描槍掃描「下一個商品」，系統會自動幫您跳轉！
                    </p>
                </div>
            ) : (
                /* ================= 🌟 傳統清單畫面 ================= */
                items.length > 0 && (
                    <div style={{ background: 'white', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 4px 10px rgba(0,0,0,0.05)' }}>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '700px' }}>
                                <thead>
                                    <tr style={{ background: '#f8fafc', color: '#64748b', fontSize: '14px' }}>
                                        <th style={{ padding: '15px', borderBottom: '1px solid #e2e8f0' }}>商品資訊</th>
                                        <th style={{ padding: '15px', borderBottom: '1px solid #e2e8f0' }}>條碼</th>
                                        <th style={{ padding: '15px', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>應檢</th>
                                        <th style={{ padding: '15px', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>已掃</th>
                                        <th style={{ padding: '15px', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>動作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((item) => {
                                        const hasLetterSuffix = /[A-Za-z]+$/.test(String(item.Barcode).trim());
                                        const shouldHighlightYellow = item.is_duplicate || hasLetterSuffix;

                                        return (
                                            <tr 
                                                key={item.id} 
                                                ref={el => rowRefs.current[item.id] = el}
                                                style={{ 
                                                    backgroundColor: item.Status === 'completed' ? '#f0fdf4' : shouldHighlightYellow ? '#fef08a' : 'white',
                                                    borderBottom: '1px solid #f1f5f9', transition: 'background-color 0.3s'
                                                }}
                                            >
                                                <td style={{ padding: '15px', fontSize: '14px', lineHeight: '1.4' }}>
                                                    <div style={{ fontWeight: '900', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                        {item.Product_No}
                                                        {item.is_duplicate && <span style={{ background: '#b45309', color: 'white', fontSize: '11px', padding: '2px 6px', borderRadius: '4px' }}>總和</span>}
                                                        {hasLetterSuffix && <span style={{ background: '#ca8a04', color: 'white', fontSize: '11px', padding: '2px 6px', borderRadius: '4px' }}>特規條碼</span>}
                                                    </div>
                                                    <div style={{ color: '#475569', marginTop: '4px', fontSize: '13px' }}>{item.Name}</div>
                                                </td>
                                                <td style={{ padding: '15px', fontFamily: 'monospace', fontWeight: 'bold', color: '#3b82f6', fontSize: '15px' }}>{item.Barcode}</td>
                                                <td style={{ padding: '15px', textAlign: 'center', fontWeight: '900', color: '#64748b', fontSize: '18px' }}>{item.Target_Qty}</td>
                                                
                                                <td style={{ padding: '15px', textAlign: 'center' }}>
                                                    <div style={{ fontSize: '20px', fontWeight: '900', color: item.Scanned_Qty === item.Target_Qty ? '#15803d' : '#0f172a' }}>
                                                        {item.Scanned_Qty}
                                                    </div>
                                                </td>

                                                <td style={{ padding: '15px', textAlign: 'center' }}>
                                                    <button 
                                                        onClick={() => setFocusedItemId(item.id)}
                                                        style={{ background: '#0f172a', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                                                    >
                                                        🔍 進入專注模式
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            )}
        </div>
    );
}