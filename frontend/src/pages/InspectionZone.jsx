import React, { useState, useEffect, useRef } from 'react';

// 🌟 動態判斷 API 網址
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
    
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    const inputRef = useRef(null); 
    const topRef = useRef(null); 
    const itemsRef = useRef([]); 
    const rowRefs = useRef({}); 

    useEffect(() => {
        if (activeTaskCode) {
            localStorage.setItem(`inspection_task_${apiZoneStr}`, activeTaskCode);
        } else {
            localStorage.removeItem(`inspection_task_${apiZoneStr}`);
        }
    }, [activeTaskCode, apiZoneStr]);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => { itemsRef.current = items; }, [items]);

    const fetchTaskStatus = async () => {
        if (!activeTaskCode) return; 
        try {
            const res = await fetch(`${API_BASE_URL}/api/inspection/task/${apiZoneStr}/${activeTaskCode}`);
            const data = await res.json();
            if (data.status === "success" && data.task) {
                setItems(data.task.items);
            } else {
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
        if (!isCameraOpen && activeTaskCode && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON' && inputRef.current) {
            inputRef.current.focus();
        }
    };

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
                throw new Error("請確認您已將新的 inspection.py 部署到後端伺服器！");
            } else {
                throw new Error("後端未返回任務碼");
            }
        } catch (error) { 
            alert("上傳異常：" + error.message); 
        } 
        finally { 
            setLoading(false); 
            e.target.value = null; 
        }
    };

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

    const clearTask = async () => {
        if (window.confirm("確定要結案並清除資料嗎？")) {
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

    // ================= 🌟 現代化 UI 渲染：大廳 (Lobby) =================
    if (!activeTaskCode) {
        return (
            <div className="page-content" style={{ padding: '20px', fontFamily: "'Inter', sans-serif", maxWidth: '900px', margin: '0 auto', background: '#f8fafc', minHeight: '100vh' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '40px', gap: '15px' }}>
                    <button onClick={() => window.location.href = '/inspection'} style={{ background: '#ffffff', border: '1px solid #e2e8f0', padding: '10px 16px', borderRadius: '12px', cursor: 'pointer', fontWeight: '600', color: '#475569', boxShadow: '0 2px 4px rgba(0,0,0,0.02)', transition: 'all 0.2s' }}>
                        ← 返回區域
                    </button>
                    <h2 style={{ fontSize: '28px', margin: 0, color: '#0f172a', fontWeight: '800', letterSpacing: '-0.5px' }}>📦 {zoneName} 檢測大廳</h2>
                </div>

                <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                    {/* 建立新任務 */}
                    {!isMobile && (
                        <div style={{ flex: '1', minWidth: '320px', background: '#ffffff', padding: '40px 30px', borderRadius: '24px', border: '1px solid #e2e8f0', textAlign: 'center', boxShadow: '0 10px 25px rgba(0,0,0,0.03)', transition: 'transform 0.2s', position: 'relative', overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)' }}></div>
                            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📄</div>
                            <h3 style={{ color: '#0f172a', marginBottom: '10px', fontSize: '22px', fontWeight: '700' }}>建立新任務</h3>
                            <p style={{ color: '#64748b', fontSize: '15px', marginBottom: '24px', lineHeight: '1.5' }}>上傳 PDF 系統將自動為您生成<br/>一組 <b>5 位數協作任務碼</b></p>
                            
                            <label style={{ display: 'block', background: '#f1f5f9', border: '2px dashed #cbd5e1', padding: '20px', borderRadius: '16px', cursor: 'pointer', transition: 'all 0.2s' }} onMouseOver={(e) => e.currentTarget.style.borderColor = '#3b82f6'} onMouseOut={(e) => e.currentTarget.style.borderColor = '#cbd5e1'}>
                                <input type="file" accept="application/pdf" onChange={handleFileUpload} style={{ display: 'none' }} />
                                <span style={{ color: '#3b82f6', fontWeight: '700', fontSize: '16px' }}>點擊選擇 PDF 檔案</span>
                            </label>
                            {loading && <p style={{ color: '#8b5cf6', fontWeight: '700', marginTop: '16px', fontSize: '15px' }}>⏳ 解析並生成任務中...</p>}
                        </div>
                    )}

                    {/* 加入現有任務 */}
                    <div style={{ flex: '1', minWidth: '320px', background: '#ffffff', padding: '40px 30px', borderRadius: '24px', border: '1px solid #e2e8f0', textAlign: 'center', boxShadow: '0 10px 25px rgba(0,0,0,0.03)', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: 'linear-gradient(90deg, #10b981, #3b82f6)' }}></div>
                        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🤝</div>
                        <h3 style={{ color: '#0f172a', marginBottom: '10px', fontSize: '22px', fontWeight: '700' }}>加入協作</h3>
                        <p style={{ color: '#64748b', fontSize: '15px', marginBottom: '24px', lineHeight: '1.5' }}>請輸入同事建立的<br/><b>5 位數任務碼</b></p>
                        
                        <input 
                            type="text" maxLength={5} placeholder="輸入 5 碼數字"
                            value={joinInputCode} onChange={(e) => setJoinInputCode(e.target.value.replace(/\D/g, ''))}
                            style={{ width: '100%', padding: '16px', fontSize: '28px', textAlign: 'center', borderRadius: '16px', border: '2px solid #e2e8f0', outline: 'none', fontWeight: '800', letterSpacing: '8px', boxSizing: 'border-box', marginBottom: '20px', color: '#0f172a', background: '#f8fafc', transition: 'border-color 0.2s' }}
                            onFocus={(e) => e.target.style.borderColor = '#10b981'}
                            onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                        />
                        <button onClick={() => { if(joinInputCode.length === 5) setActiveTaskCode(joinInputCode); else alert("請輸入完整的 5 位數密碼"); }} style={{ background: '#10b981', color: 'white', padding: '16px', fontSize: '18px', borderRadius: '16px', border: 'none', fontWeight: '700', cursor: 'pointer', width: '100%', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.2)', transition: 'transform 0.1s' }} onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.98)'} onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}>
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

    const focusedItem = focusedItemId ? items.find(i => i.id === focusedItemId) : null;
    const isFocusedCompleted = focusedItem && focusedItem.Scanned_Qty >= focusedItem.Target_Qty;

    // ================= 🌟 現代化 UI 渲染：任務清單 與 沉浸畫面 =================
    return (
        <div className="page-content" onClick={handleContainerClick} style={{ padding: '20px', fontFamily: "'Inter', sans-serif", maxWidth: '1000px', margin: '0 auto', background: '#f8fafc', minHeight: '100vh' }}>
            
            {/* 頂部 Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '15px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <button onClick={() => window.location.href = '/inspection'} style={{ background: '#ffffff', border: '1px solid #e2e8f0', padding: '10px 16px', borderRadius: '12px', cursor: 'pointer', fontWeight: '600', color: '#475569', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                        ← 離開
                    </button>
                    <h2 style={{ fontSize: '24px', margin: 0, color: '#0f172a', fontWeight: '800' }}>{zoneName}</h2>
                </div>

                {/* 現代化任務碼提示 (膠囊狀) */}
                {!focusedItem && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#ffffff', padding: '8px 16px', borderRadius: '99px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                        <span style={{ fontSize: '13px', color: '#64748b', fontWeight: '600' }}>任務碼</span>
                        <span style={{ fontSize: '18px', fontWeight: '800', color: '#3b82f6', letterSpacing: '2px', fontFamily: 'monospace' }}>{activeTaskCode}</span>
                        <div style={{ width: '1px', height: '20px', background: '#e2e8f0', margin: '0 8px' }}></div>
                        <button onClick={() => { navigator.clipboard.writeText(activeTaskCode); alert(`✅ 任務碼 ${activeTaskCode} 已複製！`); }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '4px' }} title="複製">📋</button>
                        <button onClick={() => { if(window.confirm("確定要退出並更換任務碼嗎？")) { setActiveTaskCode(""); setFocusedItemId(null); setItems([]); } }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '4px' }} title="更換">🔄</button>
                    </div>
                )}
            </div>

            {/* 現代化進度條 */}
            {!focusedItem && items.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: isAllCompleted ? '#ecfdf5' : '#ffffff', padding: '16px 24px', borderRadius: '16px', border: `1px solid ${isAllCompleted ? '#10b981' : '#e2e8f0'}`, marginBottom: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: isAllCompleted ? '#10b981' : '#3b82f6', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: '800' }}>
                            {isAllCompleted ? '✓' : Math.round((totalScanned/totalTarget)*100 || 0) + '%'}
                        </div>
                        <div>
                            <div style={{ fontSize: '13px', color: '#64748b', fontWeight: '600', marginBottom: '2px' }}>總檢測進度</div>
                            <div style={{ fontSize: '20px', fontWeight: '800', color: isAllCompleted ? '#065f46' : '#0f172a' }}>{totalScanned} / {totalTarget}</div>
                        </div>
                    </div>
                    {isAllCompleted && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={exportCSV} style={{ background: '#f1f5f9', color: '#334155', border: 'none', padding: '10px 16px', borderRadius: '10px', fontWeight: '700', cursor: 'pointer' }}>📥 匯出</button>
                            <button onClick={clearTask} style={{ background: '#10b981', color: 'white', border: 'none', padding: '10px 16px', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', boxShadow: '0 4px 10px rgba(16, 185, 129, 0.2)' }}>✅ 結案清除</button>
                        </div>
                    )}
                </div>
            )}

            {/* 掃碼輸入框 (永遠隱藏在背景接收輸入) */}
            <div style={{ marginBottom: '24px', position: 'relative' }}>
                <input 
                    ref={inputRef} type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={handleKeyDown} disabled={isCameraOpen} placeholder={focusedItem ? "等待掃描下一件商品..." : "請使用掃描槍，或在此手動輸入條碼尾數..."}
                    style={{ width: '100%', padding: '18px 24px', fontSize: '16px', borderRadius: '16px', border: '2px solid #cbd5e1', outline: 'none', fontWeight: '600', color: '#0f172a', backgroundColor: '#ffffff', boxSizing: 'border-box', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)', transition: 'border-color 0.2s' }}
                    onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                    onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                />
                <div style={{ position: 'absolute', right: '20px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }}>🔫</div>
            </div>

            {alertMsg && (
                <div style={{ position: 'fixed', top: '40px', left: '50%', transform: 'translateX(-50%)', backgroundColor: alertMsg.type === 'error' ? '#ef4444' : alertMsg.type === 'warning' ? '#f59e0b' : '#10b981', color: 'white', padding: '16px 24px', fontSize: '15px', fontWeight: '700', borderRadius: '12px', zIndex: 9999, boxShadow: '0 10px 25px rgba(0,0,0,0.2)', textAlign: 'center', minWidth: '280px', display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'center' }}>
                    {alertMsg.type === 'error' ? '❌' : alertMsg.type === 'warning' ? '⚠️' : '✅'} {alertMsg.msg}
                </div>
            )}

            {/* ================= 🌟 質感升級：沉浸式單品畫面 ================= */}
            {focusedItem ? (
                <div style={{ background: '#ffffff', borderRadius: '24px', padding: '32px 24px', border: `2px solid ${isFocusedCompleted ? '#10b981' : '#e2e8f0'}`, boxShadow: '0 20px 40px rgba(0,0,0,0.08)', position: 'relative', overflow: 'hidden' }}>
                    {isFocusedCompleted && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '6px', background: '#10b981' }}></div>}
                    
                    <button onClick={() => setFocusedItemId(null)} style={{ background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0', padding: '8px 16px', borderRadius: '10px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', marginBottom: '24px', display: 'inline-flex', alignItems: 'center', gap: '6px', transition: 'all 0.2s' }} onMouseOver={(e) => e.currentTarget.style.background = '#f1f5f9'}>
                        ✕ 關閉視窗
                    </button>

                    <div style={{ textAlign: 'left', marginBottom: '32px' }}>
                        <div style={{ fontSize: '14px', fontWeight: '700', color: '#64748b', marginBottom: '8px', fontFamily: 'monospace', background: '#f1f5f9', display: 'inline-block', padding: '4px 10px', borderRadius: '6px' }}>
                            {focusedItem.Product_No}
                        </div>
                        <h3 style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', margin: '0 0 12px 0', lineHeight: '1.4' }}>
                            {focusedItem.Name}
                        </h3>
                        <div style={{ fontSize: '15px', fontWeight: '600', color: '#3b82f6', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ color: '#94a3b8' }}>條碼：</span> {focusedItem.Barcode}
                        </div>
                    </div>

                    {/* 質感計數器區塊 */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: isFocusedCompleted ? '#ecfdf5' : '#f8fafc', padding: '24px', borderRadius: '20px', border: '1px solid #e2e8f0', marginBottom: '24px' }}>
                        <div>
                            <div style={{ fontSize: '13px', color: '#64748b', fontWeight: '700', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '1px' }}>Scanned</div>
                            <div style={{ fontSize: '48px', fontWeight: '900', color: isFocusedCompleted ? '#10b981' : '#3b82f6', lineHeight: '1' }}>{focusedItem.Scanned_Qty}</div>
                        </div>
                        <div style={{ fontSize: '32px', color: '#cbd5e1', fontWeight: '300' }}>/</div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '13px', color: '#64748b', fontWeight: '700', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '1px' }}>Target</div>
                            <div style={{ fontSize: '48px', fontWeight: '900', color: '#0f172a', lineHeight: '1' }}>{focusedItem.Target_Qty}</div>
                        </div>
                    </div>

                    {/* 整合控制面板 (一體化質感) */}
                    <div style={{ display: 'flex', gap: '12px', background: '#ffffff', padding: '12px', borderRadius: '20px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <div style={{ flex: '1', display: 'flex', alignItems: 'center', background: '#f8fafc', borderRadius: '12px', padding: '0 16px' }}>
                            <span style={{ fontSize: '14px', fontWeight: '700', color: '#94a3b8' }}>自訂:</span>
                            <input 
                                type="number" min="0" max={focusedItem.Target_Qty} value={focusedItem.Scanned_Qty}
                                onChange={(e) => updateItemQty(focusedItem.id, parseInt(e.target.value) || 0, false)}
                                style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: '20px', fontWeight: '800', color: '#0f172a', textAlign: 'center' }}
                            />
                        </div>
                        <button onClick={() => updateItemQty(focusedItem.id, focusedItem.Scanned_Qty + 1, false)} disabled={isFocusedCompleted} style={{ flex: '1.5', background: isFocusedCompleted ? '#e2e8f0' : '#3b82f6', color: isFocusedCompleted ? '#94a3b8' : 'white', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '700', cursor: isFocusedCompleted ? 'not-allowed' : 'pointer', transition: 'all 0.1s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} onMouseDown={(e) => !isFocusedCompleted && (e.currentTarget.style.transform = 'scale(0.96)')} onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}>
                            <span>+</span> 補 1 件
                        </button>
                        <button onClick={() => updateItemQty(focusedItem.id, focusedItem.Target_Qty, false)} disabled={isFocusedCompleted} style={{ flex: '1', background: isFocusedCompleted ? '#e2e8f0' : '#f59e0b', color: isFocusedCompleted ? '#94a3b8' : 'white', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '700', cursor: isFocusedCompleted ? 'not-allowed' : 'pointer', transition: 'all 0.1s' }} onMouseDown={(e) => !isFocusedCompleted && (e.currentTarget.style.transform = 'scale(0.96)')} onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}>
                            ⚡ 補滿
                        </button>
                    </div>

                    <div style={{ marginTop: '24px', color: '#94a3b8', fontSize: '13px', fontWeight: '600' }}>
                        直接用掃描槍刷下一件，系統會自動跳轉
                    </div>
                </div>
            ) : (
                /* ================= 🌟 現代化清單畫面 ================= */
                items.length > 0 && (
                    <div style={{ background: '#ffffff', borderRadius: '24px', overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.03)', border: '1px solid #e2e8f0' }}>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '700px' }}>
                                <thead>
                                    <tr style={{ background: '#f8fafc', color: '#64748b', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                        <th style={{ padding: '20px 24px', borderBottom: '1px solid #e2e8f0', fontWeight: '700' }}>商品資訊</th>
                                        <th style={{ padding: '20px 24px', borderBottom: '1px solid #e2e8f0', fontWeight: '700' }}>條碼</th>
                                        <th style={{ padding: '20px 24px', borderBottom: '1px solid #e2e8f0', textAlign: 'center', fontWeight: '700' }}>進度</th>
                                        <th style={{ padding: '20px 24px', borderBottom: '1px solid #e2e8f0', textAlign: 'right', fontWeight: '700' }}>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((item) => {
                                        const hasLetterSuffix = /[A-Za-z]+$/.test(String(item.Barcode).trim());
                                        const shouldHighlightYellow = item.is_duplicate || hasLetterSuffix;
                                        const isDone = item.Scanned_Qty >= item.Target_Qty;

                                        return (
                                            <tr 
                                                key={item.id} 
                                                ref={el => rowRefs.current[item.id] = el}
                                                style={{ 
                                                    background: isDone ? '#f8fafc' : shouldHighlightYellow ? '#fefce8' : '#ffffff',
                                                    borderBottom: '1px solid #f1f5f9', transition: 'all 0.2s', opacity: isDone ? 0.6 : 1
                                                }}
                                            >
                                                <td style={{ padding: '20px 24px', lineHeight: '1.5' }}>
                                                    <div style={{ fontWeight: '800', color: '#0f172a', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                        {item.Product_No}
                                                        {item.is_duplicate && <span style={{ background: '#f59e0b', color: 'white', fontSize: '11px', padding: '2px 8px', borderRadius: '99px', fontWeight: '700' }}>重複項總和</span>}
                                                        {hasLetterSuffix && <span style={{ background: '#8b5cf6', color: 'white', fontSize: '11px', padding: '2px 8px', borderRadius: '99px', fontWeight: '700' }}>特規</span>}
                                                        {isDone && <span style={{ background: '#10b981', color: 'white', fontSize: '11px', padding: '2px 8px', borderRadius: '99px', fontWeight: '700' }}>完成</span>}
                                                    </div>
                                                    <div style={{ color: '#475569', marginTop: '6px', fontSize: '14px', fontWeight: '500' }}>{item.Name}</div>
                                                </td>
                                                <td style={{ padding: '20px 24px' }}>
                                                    <span style={{ background: isDone ? 'transparent' : '#f1f5f9', padding: '6px 10px', borderRadius: '8px', fontFamily: 'monospace', fontWeight: '700', color: '#3b82f6', fontSize: '14px' }}>
                                                        {item.Barcode}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '20px 24px', textAlign: 'center' }}>
                                                    <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: '4px' }}>
                                                        <span style={{ fontSize: '20px', fontWeight: '900', color: isDone ? '#10b981' : '#0f172a' }}>{item.Scanned_Qty}</span>
                                                        <span style={{ fontSize: '14px', color: '#94a3b8', fontWeight: '600' }}>/ {item.Target_Qty}</span>
                                                    </div>
                                                </td>
                                                <td style={{ padding: '20px 24px', textAlign: 'right' }}>
                                                    <button 
                                                        onClick={() => setFocusedItemId(item.id)}
                                                        style={{ background: isDone ? '#e2e8f0' : '#0f172a', color: isDone ? '#64748b' : 'white', border: 'none', padding: '10px 16px', borderRadius: '10px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', transition: 'all 0.2s', boxShadow: isDone ? 'none' : '0 4px 10px rgba(0,0,0,0.1)' }}
                                                    >
                                                        處理
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