import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
// 🌟 改用更強大、可以強制後置鏡頭的底層引擎
import { Html5Qrcode } from 'html5-qrcode';

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

export default function InspectionZone({ zoneName }) {
    const navigate = useNavigate();
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [alertMsg, setAlertMsg] = useState(null);
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const [inputValue, setInputValue] = useState(""); 
    
    const inputRef = useRef(null); 
    const topRef = useRef(null); // 🌟 最頂端的定位器
    const lastCameraScan = useRef(""); 
    const itemsRef = useRef([]); 
    const rowRefs = useRef({}); 

    const apiZoneStr = zoneName.toLowerCase().replace(/\s/g, "");

    useEffect(() => { itemsRef.current = items; }, [items]);

    // ================= 2. 多人協作：定時獲取最新進度 =================
    const fetchTaskStatus = async () => {
        try {
            const res = await fetch(`https://letech-pro.onrender.com/api/inspection/task/${apiZoneStr}`);
            const data = await res.json();
            if (data.status === "success" && data.task) {
                setItems(data.task.items);
            } else {
                setItems([]); 
            }
        } catch (err) { console.error("同步資料失敗", err); }
    };

    useEffect(() => {
        fetchTaskStatus();
        const interval = setInterval(fetchTaskStatus, 2000);
        return () => clearInterval(interval);
    }, [apiZoneStr]);

    // 🌟 只有相機關閉時，才強制鎖定游標
    useEffect(() => {
        if (!isCameraOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isCameraOpen]);

    // 🌟 點擊空白處時，如果沒開相機，才把游標抓回來
    const handleContainerClick = (e) => {
        if (!isCameraOpen && e.target.tagName !== 'INPUT' && inputRef.current) {
            inputRef.current.focus();
        }
    };

    // ================= 3. 處理 PDF 上傳 =================
    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append("file", file);

        setLoading(true);
        try {
            const res = await fetch(`https://letech-pro.onrender.com/api/inspection/upload/${apiZoneStr}`, {
                method: "POST", body: formData
            });
            if (!res.ok) throw new Error("上傳失敗");
            await fetchTaskStatus(); 
        } catch (error) { alert("上傳失敗：" + error.message); } 
        finally { setLoading(false); e.target.value = null; }
    };

    // ================= 4. 掃碼判定與更新後端 =================
    const updateItemQty = async (itemId, newQty, isScanner = false) => {
        try {
            const res = await fetch(`https://letech-pro.onrender.com/api/inspection/update/${apiZoneStr}`, {
                method: "POST",
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_id: itemId, scanned_qty: newQty })
            });
            
            if (res.ok) {
                const data = await res.json();
                setItems(prev => prev.map(i => i.id === itemId ? data.item : i));
                
                // 🌟 當數量達成目標時（不管是掃描還是人手改的）
                if (data.item.Scanned_Qty >= data.item.Target_Qty) {
                    if (!isScanner) {
                        playSound('success');
                    }
                    // 🌟 齊貨了！延遲 0.5 秒後精準滑回輸入框
                    setTimeout(() => {
                        if (topRef.current) {
                            topRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                        if (!isCameraOpen && inputRef.current) {
                            inputRef.current.focus();
                        }
                    }, 500); 
                } 
                // 如果還沒齊，且是用掃描槍掃的，自動滑動尋找商品
                else if (isScanner && rowRefs.current[itemId]) {
                    rowRefs.current[itemId].scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        } catch (err) { console.error("更新數量失敗", err); }
    };

    const processBarcode = (scannedCode) => {
        if (itemsRef.current.length === 0) return;
        const cleanScanned = String(scannedCode).trim();
        let matchFound = false;
        let isFull = false;

        for (let item of itemsRef.current) {
            const pdfBarcode = String(item.Barcode).trim();
            const purePdfBarcode = pdfBarcode.replace(/[A-Za-z]+$/, '');

            if (pdfBarcode === cleanScanned || purePdfBarcode === cleanScanned) {
                matchFound = true;
                if (item.Scanned_Qty < item.Target_Qty) {
                    playSound('success');
                    showAlert(`✅ 掃描成功！(${cleanScanned})`, "success");
                    updateItemQty(item.id, item.Scanned_Qty + 1, true); 
                } else {
                    isFull = true;
                }
                break; 
            }
        }

        if (!matchFound) {
            playSound('error');
            showAlert("❌ 拿錯貨了！找不到此條碼：" + cleanScanned, "error");
        } else if (isFull) {
            playSound('error');
            showAlert("⚠️ 數量已滿！請勿多拿！", "warning");
        }

        setTimeout(() => setInputValue(""), 200);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && inputValue.trim()) {
            processBarcode(inputValue);
        }
    };

    // ================= 5. 強制後置相機掃碼器 =================
    useEffect(() => {
        let html5QrCode;

        if (isCameraOpen) {
            html5QrCode = new Html5Qrcode("inspection-reader");
            const cameraConfig = { facingMode: "environment" }; 
            const scanConfig = { fps: 5, qrbox: { width: 250, height: 150 }, aspectRatio: 1.0 };

            html5QrCode.start(
                cameraConfig,
                scanConfig,
                (decodedText) => {
                    if (lastCameraScan.current === decodedText) return;
                    lastCameraScan.current = decodedText;
                    setTimeout(() => { lastCameraScan.current = ""; }, 2000);
                    setInputValue(decodedText);
                    processBarcode(decodedText);
                },
                (error) => {} 
            ).catch(err => {
                console.error("相機啟動失敗", err);
                alert("無法開啟相機，請確認設備是否有後置鏡頭並給予權限！");
                setIsCameraOpen(false);
            });
        }

        return () => {
            if (html5QrCode && html5QrCode.isScanning) {
                html5QrCode.stop().then(() => html5QrCode.clear()).catch(e => console.log(e));
            }
        };
    }, [isCameraOpen]);

    const showAlert = (msg, type) => {
        setAlertMsg({ msg, type });
        setTimeout(() => setAlertMsg(null), 2500); 
    };

    // ================= 6. 結束任務 =================
    const clearTask = async () => {
        if (window.confirm("確定要結案並清除資料嗎？")) {
            await fetch(`https://letech-pro.onrender.com/api/inspection/clear/${apiZoneStr}`, { method: "POST" });
            fetchTaskStatus();
        }
    };

    const exportCSV = () => {
        const headers = "商品編號,商品名稱,條碼,應檢數量,已掃數量,狀態\n";
        const rows = items.map(i => `${i.Product_No},${i.Name.replace(/,/g, " ")},${i.Barcode},${i.Target_Qty},${i.Scanned_Qty},${i.Status}`).join("\n");
        const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + encodeURIComponent(headers + rows);
        const link = document.createElement("a");
        link.href = csvContent;
        link.download = `${zoneName}_檢測報告.csv`;
        link.click();
    };

    const totalTarget = items.reduce((acc, curr) => acc + curr.Target_Qty, 0);
    const totalScanned = items.reduce((acc, curr) => acc + curr.Scanned_Qty, 0);
    const isAllCompleted = totalTarget > 0 && totalTarget === totalScanned;

    return (
        <div className="page-content" onClick={handleContainerClick} style={{ padding: '15px', fontFamily: 'sans-serif', maxWidth: '1000px', margin: '0 auto' }}>
            
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px', gap: '15px' }}>
                <button onClick={() => navigate('/inspection')} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '10px 15px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    ⬅️ 返回
                </button>
                <h2 style={{ fontSize: '24px', margin: 0, color: '#0f172a' }}>📦 {zoneName} 檢測區</h2>
            </div>
            
            {items.length === 0 && (
                <div style={{ background: 'white', padding: '30px', borderRadius: '16px', boxShadow: '0 4px 10px rgba(0,0,0,0.05)', textAlign: 'center' }}>
                    <h3 style={{ color: '#64748b', marginBottom: '20px' }}>📄 請上傳 {zoneName} Delivery Note (PDF) 開始檢測</h3>
                    <input type="file" accept="application/pdf" onChange={handleFileUpload} style={{ border: '1px solid #cbd5e1', padding: '10px', borderRadius: '8px' }} />
                    {loading && <p style={{ color: '#3b82f6', fontWeight: 'bold', marginTop: '15px' }}>⏳ 正在解析 PDF，請稍候...</p>}
                </div>
            )}

            {/* 🌟 實體掃碼輸入框與相機區塊 */}
            {items.length > 0 && (
                <div ref={topRef} style={{ marginBottom: '20px', background: '#f8fafc', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 10px rgba(0,0,0,0.05)' }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#64748b', marginBottom: '8px' }}>
                        {isCameraOpen ? '📷 相機掃描模式中...' : '⌨️ 游標已鎖定，請直接使用實體掃碼槍'}
                    </div>
                    <input 
                        ref={inputRef} type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={handleKeyDown} disabled={isCameraOpen} placeholder="在此掃描或輸入條碼..."
                        style={{ width: '100%', padding: '16px', fontSize: '20px', textAlign: 'center', borderRadius: '10px', border: '2px solid #3b82f6', outline: 'none', fontWeight: 'bold', color: '#0f172a', backgroundColor: isCameraOpen ? '#e2e8f0' : '#ffffff' }}
                    />
                    
                    <button 
                        onClick={() => setIsCameraOpen(!isCameraOpen)} 
                        style={{ width: '100%', marginTop: '15px', background: isCameraOpen ? '#ef4444' : '#3b82f6', color: 'white', padding: '12px', fontSize: '16px', borderRadius: '10px', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                        {isCameraOpen ? '❌ 關閉相機 (切換回掃描槍)' : '📷 開啟手機相機掃描'}
                    </button>
                    
                    {/* 相機顯示區 */}
                    <div style={{ display: isCameraOpen ? 'block' : 'none', marginTop: '15px' }}>
                        <div id="inspection-reader" style={{ width: '100%', borderRadius: '12px', overflow: 'hidden', border: '2px solid #cbd5e1' }}></div>
                    </div>
                </div>
            )}

            {items.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', background: isAllCompleted ? '#dcfce7' : '#eff6ff', padding: '15px 20px', borderRadius: '12px', border: `1px solid ${isAllCompleted ? '#bbf7d0' : '#bfdbfe'}` }}>
                    <div style={{ fontWeight: 'bold', fontSize: '18px', color: isAllCompleted ? '#166534' : '#1e40af' }}>
                        總進度：{totalScanned} / {totalTarget} {isAllCompleted && '🎉 (全部完成！)'}
                    </div>
                    {isAllCompleted && (
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={exportCSV} style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '10px 15px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
                                📥 下載
                            </button>
                            <button onClick={clearTask} style={{ background: '#16a34a', color: 'white', border: 'none', padding: '10px 15px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
                                ✅ 結案清除
                            </button>
                        </div>
                    )}
                </div>
            )}

            {alertMsg && (
                <div style={{ position: 'fixed', top: '15%', left: '50%', transform: 'translateX(-50%)', backgroundColor: alertMsg.type === 'error' ? '#ef4444' : alertMsg.type === 'warning' ? '#f59e0b' : '#10b981', color: 'white', padding: '20px 30px', fontSize: '20px', fontWeight: '900', borderRadius: '12px', zIndex: 9999, boxShadow: '0 10px 25px rgba(0,0,0,0.3)', textAlign: 'center', width: '80%', maxWidth: '400px' }}>
                    {alertMsg.msg}
                </div>
            )}

            {/* 響應式表格 */}
            {items.length > 0 && (
                <div style={{ background: 'white', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 4px 10px rgba(0,0,0,0.05)' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '700px' }}>
                            <thead>
                                <tr style={{ background: '#f8fafc', color: '#64748b', fontSize: '14px' }}>
                                    <th style={{ padding: '15px', borderBottom: '1px solid #e2e8f0' }}>商品資訊</th>
                                    <th style={{ padding: '15px', borderBottom: '1px solid #e2e8f0' }}>條碼</th>
                                    <th style={{ padding: '15px', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>應檢</th>
                                    <th style={{ padding: '15px', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>已掃 (可手動修改)</th>
                                    <th style={{ padding: '15px', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>狀態</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((item) => {
                                    // 🌟 判斷條碼結尾是否包含英文字母 (A-Z)
                                    const hasLetterSuffix = /[A-Za-z]+$/.test(String(item.Barcode).trim());
                                    // 決定是否要亮黃色 (重複商品 或 帶有字母的條碼)
                                    const shouldHighlightYellow = item.is_duplicate || hasLetterSuffix;

                                    return (
                                        <tr 
                                            key={item.id} 
                                            ref={el => rowRefs.current[item.id] = el}
                                            style={{ 
                                                // 🌟 完成亮綠底，需警示的亮黃底，否則白底
                                                backgroundColor: item.Status === 'completed' ? '#f0fdf4' : shouldHighlightYellow ? '#fef08a' : 'white',
                                                borderBottom: '1px solid #f1f5f9', transition: 'background-color 0.3s'
                                            }}
                                        >
                                            <td style={{ padding: '15px', fontSize: '14px', lineHeight: '1.4' }}>
                                                <div style={{ fontWeight: '900', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                    {item.Product_No}
                                                    {item.is_duplicate && <span style={{ background: '#b45309', color: 'white', fontSize: '11px', padding: '2px 6px', borderRadius: '4px' }}>總和</span>}
                                                    {/* 🌟 帶英文字母的專屬警示標籤 */}
                                                    {hasLetterSuffix && <span style={{ background: '#ca8a04', color: 'white', fontSize: '11px', padding: '2px 6px', borderRadius: '4px' }}>特規條碼</span>}
                                                </div>
                                                <div style={{ color: '#475569', marginTop: '4px', fontSize: '13px' }}>{item.Name}</div>
                                            </td>
                                            <td style={{ padding: '15px', fontFamily: 'monospace', fontWeight: 'bold', color: '#3b82f6', fontSize: '15px' }}>{item.Barcode}</td>
                                            <td style={{ padding: '15px', textAlign: 'center', fontWeight: '900', color: '#64748b', fontSize: '18px' }}>{item.Target_Qty}</td>
                                            
                                            <td style={{ padding: '15px', textAlign: 'center' }}>
                                                <input 
                                                    type="number" 
                                                    min="0" 
                                                    max={item.Target_Qty}
                                                    value={item.Scanned_Qty}
                                                    onChange={(e) => updateItemQty(item.id, parseInt(e.target.value) || 0, false)}
                                                    style={{ 
                                                        width: '60px', padding: '8px', textAlign: 'center', fontSize: '18px', fontWeight: 'bold', 
                                                        borderRadius: '8px', border: `2px solid ${item.Scanned_Qty === item.Target_Qty ? '#15803d' : '#cbd5e1'}`, 
                                                        color: item.Scanned_Qty === item.Target_Qty ? '#15803d' : '#0f172a', outline: 'none'
                                                    }}
                                                />
                                            </td>

                                            <td style={{ padding: '15px', textAlign: 'center' }}>
                                                <span style={{ 
                                                    padding: '6px 10px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', whiteSpace: 'nowrap',
                                                    background: item.Status === 'completed' ? '#dcfce7' : item.Status === 'partial' ? '#fef3c7' : '#f1f5f9',
                                                    color: item.Status === 'completed' ? '#166534' : item.Status === 'partial' ? '#b45309' : '#64748b'
                                                }}>
                                                    {item.Status === 'completed' ? '✅ 完成' : item.Status === 'partial' ? '⏳ 處理中' : '未開始'}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}