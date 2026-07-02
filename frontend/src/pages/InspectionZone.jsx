import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';

// 🌟 動態判斷 API 網址(VITE_API_BASE 可覆寫俾 local 預覽用)
const API_BASE_URL =
    import.meta.env.VITE_API_BASE ||
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? "http://127.0.0.1:8000"
        : "https://letech-pro.onrender.com");

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
    const [searchParams] = useSearchParams();
    const urlTaskCode = searchParams.get('task'); // 🌟 由 Dashboard 過嚟嗰陣會帶住 task_code

    const [activeTaskCode, setActiveTaskCode] = useState(() => {
        // 優先級:URL 嘅 task > localStorage 嘅
        return urlTaskCode || localStorage.getItem(`inspection_task_${apiZoneStr}`) || "";
    });
    const [joinInputCode, setJoinInputCode] = useState("");

    // 🌟 URL task 變(用 react-router navigate)就同步入 state
    useEffect(() => {
        if (urlTaskCode && urlTaskCode !== activeTaskCode) {
            setActiveTaskCode(urlTaskCode);
        }
    }, [urlTaskCode]);
    const [focusedItemId, setFocusedItemId] = useState(null);

    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [alertMsg, setAlertMsg] = useState(null);
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const [inputValue, setInputValue] = useState(""); 
    
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    // 📷 Camera scanner state
    const [torchOn, setTorchOn] = useState(false);
    const [torchSupported, setTorchSupported] = useState(false);
    const [scanHint, setScanHint] = useState('');   // 顯示提示畀模糊鏡頭嘅同事
    const scannerRef = useRef(null);

    // 📸 拍照掃碼 state(自製 camera preview + 一撳即 capture,冇 iOS「使用照片」確認)
    const [photoDecoding, setPhotoDecoding] = useState(false);
    const [isPhotoModeOpen, setIsPhotoModeOpen] = useState(false);
    const [photoTorchOn, setPhotoTorchOn] = useState(false);
    const [photoTorchSupported, setPhotoTorchSupported] = useState(false);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const photoStreamRef = useRef(null);
    const photoTrackRef = useRef(null);
    // (legacy) photoInputRef 已經唔用,舊 flow 用 <input capture> 但會彈 iOS「使用照片」確認

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
        // 🌟 強效防禦：將使用者掃出來的條碼也把 '-' 和空格清掉，全部轉大寫
        const cleanScanned = String(scannedCode).trim().replace(/[\s-]/g, '').toUpperCase();
        
        let matchedItems = [];

        for (let item of itemsRef.current) {
            // 🌟 強效防禦：將資料庫裡的條碼也把 '-' 和空格清掉，全部轉大寫，確保雙方在同一個基準點比對
            const pdfBarcode = String(item.Barcode).trim().replace(/[\s-]/g, '').toUpperCase();
            const purePdfBarcode = pdfBarcode.replace(/[A-Z]+$/, ''); // 移除尾部字母
            
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
            showAlert("❌ 拿錯貨了！找不到此條碼：" + scannedCode, "error");
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

    // ================= 📸 拍照掃碼 (自製 camera + tap-to-capture) =================
    // 唔用 <input capture> 因為 iOS 會強制彈「使用照片 / 重拍」確認畫面。
    // 改用 getUserMedia 直接開 video stream,用戶睇實時 preview,一撳就 capture,
    // canvas.toBlob 拎 raw frame 上傳 backend zxing-cpp decode。
    //
    // 好處:
    //   1. 冇「使用照片」確認 — 一撳直接 decode
    //   2. 用戶睇實時 preview,可以慢慢對準先撳影
    //   3. Backend 用多 pre-process 策略,寬容模糊鏡頭
    //   4. 有手電筒 toggle
    const openPhotoMode = async () => {
        if (isPhotoModeOpen) return;
        setIsPhotoModeOpen(true);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' },   // 後鏡頭
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                    // 連續對焦(部分手機支援)
                    focusMode: 'continuous',
                    advanced: [{ focusMode: 'continuous' }],
                },
                audio: false,
            });
            photoStreamRef.current = stream;
            // 等 <video> render 出嚟(下面 modal JSX 條件 mount)
            setTimeout(async () => {
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    try { await videoRef.current.play(); } catch (_) {}
                }
            }, 50);
            // 檢查手電筒
            const track = stream.getVideoTracks()[0];
            photoTrackRef.current = track;
            try {
                const caps = track.getCapabilities?.();
                if (caps && caps.torch) setPhotoTorchSupported(true);
            } catch (_) {}
        } catch (err) {
            console.error('相機開唔到:', err);
            const msg = err.name === 'NotAllowedError'
                ? '相機權限被拒 — 請喺 browser 設定俾權限'
                : (err.message || err);
            showAlert('❌ ' + msg, 'error');
            setIsPhotoModeOpen(false);
        }
    };

    const closePhotoMode = () => {
        if (photoStreamRef.current) {
            photoStreamRef.current.getTracks().forEach(t => t.stop());
            photoStreamRef.current = null;
        }
        photoTrackRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        setIsPhotoModeOpen(false);
        setPhotoTorchOn(false);
        setPhotoTorchSupported(false);
    };

    // 撳「📸 影相 decode」→ 立即 capture 一 frame + 上傳
    const captureAndDecode = async () => {
        if (!videoRef.current || photoDecoding) return;
        const video = videoRef.current;
        if (!video.videoWidth || !video.videoHeight) {
            showAlert('⚠️ Camera 未 ready,等 1 秒再試', 'warning');
            return;
        }
        setPhotoDecoding(true);
        try {
            // Canvas 抓 video 當前 frame
            if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
            const canvas = canvasRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0);
            // 轉 blob 上傳
            const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
            if (!blob) throw new Error('無法擷取影像');

            const formData = new FormData();
            formData.append('file', blob, 'capture.jpg');
            const res = await fetch(`${API_BASE_URL}/api/inspection/decode_image`, {
                method: 'POST', body: formData,
            });
            if (!res.ok) {
                const er = await res.json().catch(() => ({}));
                throw new Error(er.detail || '解碼失敗');
            }
            const data = await res.json();
            if (data.barcodes && data.barcodes.length > 0) {
                processBarcode(data.barcodes[0]);
                showAlert(`✅ 掃到: ${data.barcodes[0]}`, 'success');
                closePhotoMode();
            } else {
                playSound('error');
                showAlert('❌ 呢張掃唔到,對準啲再影一張', 'error');
            }
        } catch (err) {
            playSound('error');
            showAlert('❌ ' + (err.message || err), 'error');
        } finally {
            setPhotoDecoding(false);
        }
    };

    const togglePhotoTorch = async () => {
        if (!photoTrackRef.current) return;
        try {
            await photoTrackRef.current.applyConstraints({
                advanced: [{ torch: !photoTorchOn }],
            });
            setPhotoTorchOn(!photoTorchOn);
        } catch (err) {
            console.error('手電筒 toggle 失敗:', err);
            showAlert('⚠️ 呢部手機唔支援手電筒', 'warning');
        }
    };

    // Cleanup:leave page 記住 stop stream
    useEffect(() => {
        return () => {
            if (photoStreamRef.current) {
                photoStreamRef.current.getTracks().forEach(t => t.stop());
            }
        };
    }, []);

    // ================= 📷 Camera scanner (優化模糊鏡頭) =================
    const openCamera = async () => {
        if (isCameraOpen) return;
        setIsCameraOpen(true);
        setScanHint('');
        // 等 modal render 完先 attach scanner
        setTimeout(async () => {
            try {
                if (!scannerRef.current) {
                    scannerRef.current = new Html5Qrcode('qr-scan-region', /* verbose */ false);
                }
                const cfg = {
                    fps: 15,   // 15 fps 平衡電量同反應速度
                    // 大 qrbox — 模糊鏡頭易啲對準
                    qrbox: (w, h) => {
                        const minEdge = Math.min(w, h);
                        const box = Math.floor(minEdge * 0.8);
                        return { width: box, height: box };
                    },
                    aspectRatio: 1.0,
                    // 🚀 用原生 BarcodeDetector(如手機支援)—— 快 10x 且對模糊條碼更寬容
                    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
                    // 用番去次 camera(唔使成日俾人揀)
                    rememberLastUsedCamera: true,
                    // 高解像度 + continuous focus
                    videoConstraints: {
                        facingMode: 'environment',   // 後鏡頭
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                        focusMode: 'continuous',
                        advanced: [{ focusMode: 'continuous' }],
                    },
                };

                await scannerRef.current.start(
                    { facingMode: 'environment' },
                    cfg,
                    (decodedText) => {
                        // 掃到就即刻 process + 關 camera
                        processBarcode(decodedText);
                        closeCamera();
                    },
                    (_errMsg) => {
                        // 不停 scan 期間會有 error,唔理
                    }
                );

                // 檢查 torch(手電筒)支唔支援
                try {
                    const caps = scannerRef.current.getRunningTrackCameraCapabilities?.();
                    if (caps && typeof caps.torchFeature === 'function' && caps.torchFeature().isSupported()) {
                        setTorchSupported(true);
                    } else {
                        // 舊 API fallback
                        const capsOld = scannerRef.current.getRunningTrackCapabilities?.();
                        if (capsOld && capsOld.torch) setTorchSupported(true);
                    }
                } catch (_) {}

                // 8 秒後仲未掃到 → 提示改用手動輸入
                setTimeout(() => {
                    if (isCameraOpen && scannerRef.current) {
                        setScanHint('掃唔到?可以關咗 camera 用鍵盤輸入 barcode 末幾碼');
                    }
                }, 8000);
            } catch (err) {
                console.error('相機開啟失敗:', err);
                showAlert('❌ 相機開啟失敗:' + (err.message || err), 'error');
                setIsCameraOpen(false);
            }
        }, 150);
    };

    const closeCamera = () => {
        if (scannerRef.current) {
            scannerRef.current.stop().catch(() => {}).finally(() => {
                try { scannerRef.current.clear(); } catch (_) {}
                scannerRef.current = null;
            });
        }
        setIsCameraOpen(false);
        setTorchOn(false);
        setTorchSupported(false);
        setScanHint('');
    };

    const toggleTorch = async () => {
        if (!scannerRef.current) return;
        const target = !torchOn;
        try {
            // 新版 html5-qrcode API
            const caps = scannerRef.current.getRunningTrackCameraCapabilities?.();
            if (caps && typeof caps.torchFeature === 'function') {
                await caps.torchFeature().apply(target);
            } else {
                // Fallback:直接 applyVideoConstraints
                await scannerRef.current.applyVideoConstraints({
                    advanced: [{ torch: target }],
                });
            }
            setTorchOn(target);
        } catch (err) {
            console.error('手電筒 toggle 失敗:', err);
            showAlert('⚠️ 呢部手機唔支援手電筒', 'warning');
        }
    };

    // 離開 page 前記住 stop camera(避免相機 leak)
    useEffect(() => {
        return () => {
            if (scannerRef.current) {
                scannerRef.current.stop().catch(() => {});
            }
        };
    }, []);

    const showAlert = (msg, type) => {
        setAlertMsg({ msg, type });
        setTimeout(() => setAlertMsg(null), 2500); 
    };

    const clearTask = async (early = false) => {
        // early=true:未齊貨提前結案,confirm 提示仲有幾多件/幾多 SKU 未掃
        let msg = "確定要結案並歸檔嗎?(可喺歷史記錄睇返)";
        if (early) {
            const shortItems = items.filter(i => i.Scanned_Qty < i.Target_Qty);
            const shortQty = shortItems.reduce((acc, i) => acc + (i.Target_Qty - i.Scanned_Qty), 0);
            msg = `⚠️ 仲未齊貨!\n\n` +
                  `重 ${shortItems.length} 個 SKU 未執,合共差 ${shortQty} 件未掃。\n\n` +
                  `確定要提前結案並歸檔嗎?\n` +
                  `(歷史記錄會標示邊啲係未執,你可以之後睇返)`;
        }
        if (window.confirm(msg)) {
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

    // ================= 🌟 復原的單純 UI 渲染：大廳 (Lobby) =================
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

    const focusedItem = focusedItemId ? items.find(i => i.id === focusedItemId) : null;
    const isFocusedCompleted = focusedItem && focusedItem.Scanned_Qty >= focusedItem.Target_Qty;

    // ================= 🌟 復原的單純 UI 渲染：任務清單 與 沉浸畫面 =================
    return (
        <div className="page-content" onClick={handleContainerClick} style={{ padding: '15px', fontFamily: 'sans-serif', maxWidth: '1000px', margin: '0 auto' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <button onClick={() => window.location.href = '/inspection'} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '10px 15px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                        ⬅️ 暫時離開 (保留進度)
                    </button>
                    <h2 style={{ fontSize: '24px', margin: 0, color: '#0f172a' }}>{zoneName}</h2>
                </div>
            </div>

            {/* 🌟 頂部常駐任務碼提示區塊 (隱藏於專注模式中節省空間) */}
            {!focusedItem && (
                <div style={{ background: '#eff6ff', border: '3px dashed #3b82f6', padding: '15px 25px', borderRadius: '16px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
                    <div>
                        <div style={{ fontSize: '15px', color: '#1e40af', fontWeight: 'bold', marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span>當前協作任務碼</span>
                            <span style={{ background: '#dbeafe', color: '#1e3a8a', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' }}>自動記憶</span>
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
                                alert(`✅ 任務碼 ${activeTaskCode} 已複製！`);
                            }} 
                            style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '10px 15px', borderRadius: '10px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer' }}
                        >
                            📋 複製
                        </button>
                        <button 
                            onClick={() => {
                                if(window.confirm("確定要退出這個任務碼嗎？\n(需要重新輸入號碼才能再次進入)")) {
                                    setActiveTaskCode(""); 
                                    setFocusedItemId(null); 
                                    setItems([]);
                                }
                            }} 
                            style={{ background: '#e2e8f0', color: '#475569', border: '1px solid #cbd5e1', padding: '10px 15px', borderRadius: '10px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer' }}
                        >
                            🔄 換號碼
                        </button>
                    </div>
                </div>
            )}

            {/* 全局進度與工具列 + 進度條 */}
            {!focusedItem && items.length > 0 && (() => {
                const pct = totalTarget > 0 ? Math.round((totalScanned / totalTarget) * 100) : 0;
                const completedSku = items.filter(i => i.Scanned_Qty >= i.Target_Qty).length;
                return (
                    <div style={{ background: isAllCompleted ? '#dcfce7' : '#ffffff', padding: '14px 20px', borderRadius: '12px', border: `1px solid ${isAllCompleted ? '#bbf7d0' : '#e2e8f0'}`, marginBottom: '20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '15px', marginBottom: '10px', flexWrap: 'wrap' }}>
                            <div style={{ fontWeight: 'bold', fontSize: '18px', color: isAllCompleted ? '#166534' : '#0f172a' }}>
                                進度:<span style={{ fontFamily: 'monospace', marginLeft: '4px' }}>{totalScanned}</span>
                                <span style={{ color: '#94a3b8', margin: '0 2px' }}>/</span>
                                <span style={{ fontFamily: 'monospace' }}>{totalTarget}</span>
                                <span style={{ marginLeft: '10px', fontSize: '14px', color: isAllCompleted ? '#166534' : '#64748b', fontWeight: 'normal' }}>
                                    ({pct}% · SKU {completedSku}/{items.length})
                                </span>
                                {isAllCompleted && <span style={{ marginLeft: '8px' }}>🎉 全部齊貨</span>}
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button onClick={exportCSV} style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>📥 下載</button>
                                {isAllCompleted ? (
                                    <button onClick={() => clearTask(false)} style={{ background: '#16a34a', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '15px' }}>✅ 結案並歸檔</button>
                                ) : (
                                    <button onClick={() => clearTask(true)} style={{ background: '#f59e0b', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '15px' }} title="未齊貨都可以提前結案,歷史記錄會標示未執">⚠️ 提前結案</button>
                                )}
                            </div>
                        </div>
                        {/* 🌟 進度條 */}
                        <div style={{ background: '#e2e8f0', borderRadius: '999px', overflow: 'hidden', height: '12px' }}>
                            <div style={{
                                width: `${pct}%`,
                                background: isAllCompleted ? '#16a34a' : 'linear-gradient(90deg, #3b82f6 0%, #60a5fa 100%)',
                                height: '100%',
                                transition: 'width 0.4s ease',
                            }} />
                        </div>
                    </div>
                );
            })()}

            {/* 🌟 永遠存在的掃碼引擎 — 手動輸入 + 📸 拍照掃碼 + 📷 相機 live 掃碼 */}
            <div ref={topRef} style={{ marginBottom: '15px', background: '#f8fafc', padding: '8px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch', flexWrap: 'wrap' }}>
                    <input
                        ref={inputRef} type="text" value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown} disabled={isCameraOpen || photoDecoding}
                        placeholder={focusedItem ? "在此掃描下一個..." : "掃描條碼，或輸入末幾碼..."}
                        style={{ flex: '1 1 200px', minWidth: '150px', padding: '10px', fontSize: '16px', textAlign: 'center', borderRadius: '8px', border: '2px solid #3b82f6', outline: 'none', fontWeight: 'bold', color: '#0f172a', backgroundColor: (isCameraOpen || photoDecoding) ? '#e2e8f0' : '#ffffff', boxSizing: 'border-box' }}
                    />
                    {/* 📸 拍照掃碼 —— 自製 camera + 一撳即 capture,冇 iOS「使用照片」確認 */}
                    <button
                        onClick={openPhotoMode} disabled={isCameraOpen || isPhotoModeOpen || photoDecoding}
                        title="開自製 camera,撳一下即 capture 上傳 decode(冇「使用照片」確認)"
                        style={{ background: (photoDecoding || isPhotoModeOpen) ? '#94a3b8' : '#16a34a', color: 'white', border: 'none', padding: '10px 14px', borderRadius: '8px', fontWeight: 'bold', cursor: (isCameraOpen || isPhotoModeOpen || photoDecoding) ? 'wait' : 'pointer', fontSize: '15px', whiteSpace: 'nowrap' }}
                    >
                        {photoDecoding ? '⏳ 解碼中...' : '📸 拍照掃碼'}
                    </button>
                    {/* 📷 Live 相機掃碼 —— 好鏡頭手機用呢個更快 */}
                    <button
                        onClick={openCamera} disabled={isCameraOpen || photoDecoding}
                        title="開相機 live 掃(鏡頭清嘅手機用呢個快啲)"
                        style={{ background: isCameraOpen ? '#94a3b8' : '#0ea5e9', color: 'white', border: 'none', padding: '10px 14px', borderRadius: '8px', fontWeight: 'bold', cursor: (isCameraOpen || photoDecoding) ? 'wait' : 'pointer', fontSize: '15px', whiteSpace: 'nowrap' }}
                    >
                        📷 Live 掃
                    </button>
                </div>
                <div style={{ marginTop: '6px', fontSize: '11px', color: '#64748b', textAlign: 'center' }}>
                    💡 鏡頭模糊掃唔到?撳<strong style={{ color: '#16a34a' }}>📸 拍照掃碼</strong>——實時 preview,一撳即 decode(冇「使用照片」確認)
                </div>
            </div>

            {/* 📸 拍照掃碼 modal — 自製 camera view,一撳即 capture */}
            {isPhotoModeOpen && (
                <div style={{ position: 'fixed', inset: 0, background: 'black', zIndex: 9997, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: '15px' }}>
                    {/* Header hint */}
                    <div style={{ color: 'white', fontSize: '15px', fontWeight: 'bold', textAlign: 'center', padding: '8px 12px', background: 'rgba(22,163,74,0.2)', border: '1px solid #16a34a', borderRadius: '10px', maxWidth: '500px' }}>
                        📸 對準條碼,撳中間掣即影 + decode
                    </div>

                    {/* Video preview */}
                    <div style={{ flex: 1, width: '100%', maxWidth: '600px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '15px 0', minHeight: 0 }}>
                        <video
                            ref={videoRef} autoPlay playsInline muted
                            style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '12px', border: '3px solid #16a34a', background: '#0f172a' }}
                        />
                    </div>

                    {/* Bottom buttons row */}
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', width: '100%', maxWidth: '500px' }}>
                        {/* ✕ Close (left) */}
                        <button onClick={closePhotoMode} disabled={photoDecoding}
                            style={{ background: '#1e293b', color: 'white', border: '2px solid #475569', padding: '14px 20px', borderRadius: '12px', fontSize: '16px', fontWeight: '900', cursor: photoDecoding ? 'not-allowed' : 'pointer', minWidth: '80px' }}>
                            ✕
                        </button>
                        {/* 📸 Capture BIG button (center) */}
                        <button onClick={captureAndDecode} disabled={photoDecoding}
                            style={{ flex: 1, minWidth: '180px', background: photoDecoding ? '#94a3b8' : '#16a34a', color: 'white', border: 'none', padding: '18px', borderRadius: '14px', fontSize: '18px', fontWeight: '900', cursor: photoDecoding ? 'wait' : 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>
                            {photoDecoding ? '⏳ 解碼緊...' : '📸 影相 decode'}
                        </button>
                        {/* 🔦 Torch (right, if supported) */}
                        {photoTorchSupported && (
                            <button onClick={togglePhotoTorch} disabled={photoDecoding}
                                style={{ background: photoTorchOn ? '#fbbf24' : '#1e293b', color: 'white', border: `2px solid ${photoTorchOn ? '#fbbf24' : '#475569'}`, padding: '14px 20px', borderRadius: '12px', fontSize: '20px', fontWeight: '900', cursor: photoDecoding ? 'not-allowed' : 'pointer', minWidth: '80px' }}>
                                🔦
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* 📷 Camera modal — 全螢幕,俾模糊鏡頭都掃到 */}
            {isCameraOpen && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', zIndex: 9998, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', padding: '15px', overflow: 'auto' }}>
                    <div style={{ color: 'white', fontSize: '18px', fontWeight: '900', marginBottom: '10px', textAlign: 'center' }}>
                        📷 對準條碼掃描
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '15px', textAlign: 'center', maxWidth: '450px' }}>
                        💡 掃唔到?撳 <strong style={{ color: '#fbbf24' }}>🔦 手電筒</strong> 加光,或者慢慢移遠 / 移近條碼 15-25 cm
                    </div>
                    <div id="qr-scan-region" style={{ width: '100%', maxWidth: '500px', background: 'black', borderRadius: '12px', overflow: 'hidden', border: '3px solid #0ea5e9' }}></div>

                    {scanHint && (
                        <div style={{ marginTop: '12px', background: '#fef3c7', border: '1px solid #fde68a', color: '#92400e', padding: '10px 14px', borderRadius: '10px', fontSize: '14px', fontWeight: 'bold', maxWidth: '500px', textAlign: 'center' }}>
                            ⚠️ {scanHint}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '12px', marginTop: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
                        {torchSupported && (
                            <button onClick={toggleTorch}
                                style={{ background: torchOn ? '#fbbf24' : '#1e293b', color: 'white', border: `2px solid ${torchOn ? '#fbbf24' : '#475569'}`, padding: '14px 24px', borderRadius: '12px', fontSize: '16px', fontWeight: '900', cursor: 'pointer', minWidth: '150px' }}>
                                {torchOn ? '🔦 熄手電筒' : '🔦 開手電筒'}
                            </button>
                        )}
                        <button onClick={closeCamera}
                            style={{ background: '#dc2626', color: 'white', border: 'none', padding: '14px 24px', borderRadius: '12px', fontSize: '16px', fontWeight: '900', cursor: 'pointer', minWidth: '150px' }}>
                            ✕ 關閉相機
                        </button>
                    </div>
                </div>
            )}

            {alertMsg && (
                <div style={{ position: 'fixed', top: '15%', left: '50%', transform: 'translateX(-50%)', backgroundColor: alertMsg.type === 'error' ? '#ef4444' : alertMsg.type === 'warning' ? '#f59e0b' : '#10b981', color: 'white', padding: '15px 20px', fontSize: '16px', fontWeight: '900', borderRadius: '12px', zIndex: 9999, boxShadow: '0 10px 25px rgba(0,0,0,0.3)', textAlign: 'center', width: '80%', maxWidth: '300px' }}>
                    {alertMsg.msg}
                </div>
            )}

            {/* ================= 🌟 復原版 極致壓縮 沉浸式單品畫面 ================= */}
            {focusedItem ? (
                <div style={{ background: isFocusedCompleted ? '#dcfce7' : '#ffffff', borderRadius: '12px', padding: isMobile ? '12px' : '20px', border: `3px solid ${isFocusedCompleted ? '#22c55e' : '#3b82f6'}`, textAlign: 'center' }}>
                    
                    {/* 將返回按鈕與商品編號、條碼塞在同一行，極大節省垂直空間 */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                        <button onClick={() => setFocusedItemId(null)} style={{ background: '#0f172a', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer' }}>
                            🔙 返回
                        </button>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#64748b' }}>{focusedItem.Product_No}</div>
                            <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#3b82f6', fontFamily: 'monospace' }}>條碼: {focusedItem.Barcode}</div>
                        </div>
                    </div>
                    
                    {/* 商品名稱：限制最多顯示兩行，避免過長撐開畫面 */}
                    <div style={{ fontSize: isMobile ? '18px' : '22px', fontWeight: '900', color: '#0f172a', marginBottom: '12px', lineHeight: '1.3', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', textAlign: 'left' }}>
                        {focusedItem.Name}
                    </div>

                    {/* 緊湊版的水平數字顯示區 */}
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginBottom: '15px', background: isFocusedCompleted ? '#bbf7d0' : '#f1f5f9', padding: '10px', borderRadius: '10px' }}>
                        <div style={{ fontSize: '14px', color: '#64748b', fontWeight: 'bold' }}>目前已拿</div>
                        <div style={{ fontSize: '40px', fontWeight: '900', color: isFocusedCompleted ? '#166534' : '#2563eb', lineHeight: '1' }}>
                            {focusedItem.Scanned_Qty}
                        </div>
                        <div style={{ fontSize: '30px', color: '#94a3b8', fontWeight: '300' }}>/</div>
                        <div style={{ fontSize: '40px', fontWeight: '900', color: '#0f172a', lineHeight: '1' }}>
                            {focusedItem.Target_Qty}
                        </div>
                        <div style={{ fontSize: '14px', color: '#64748b', fontWeight: 'bold' }}>總共需要</div>
                    </div>

                    {/* 水平並排的手動修改區 */}
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'stretch', gap: '8px' }}>
                        <input 
                            type="number" 
                            min="0" 
                            max={focusedItem.Target_Qty}
                            value={focusedItem.Scanned_Qty}
                            onChange={(e) => updateItemQty(focusedItem.id, parseInt(e.target.value) || 0, false)}
                            style={{ width: '60px', textAlign: 'center', fontSize: '18px', fontWeight: 'bold', borderRadius: '8px', border: '2px solid #cbd5e1', outline: 'none' }}
                        />
                        <button 
                            onClick={() => updateItemQty(focusedItem.id, focusedItem.Scanned_Qty + 1, false)}
                            disabled={isFocusedCompleted}
                            style={{ flex: 1, background: isFocusedCompleted ? '#cbd5e1' : '#3b82f6', color: 'white', border: 'none', padding: '10px', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: isFocusedCompleted ? 'not-allowed' : 'pointer' }}
                        >
                            ➕ 加 1
                        </button>
                        <button 
                            onClick={() => updateItemQty(focusedItem.id, focusedItem.Target_Qty, false)}
                            disabled={isFocusedCompleted}
                            style={{ flex: 1, background: isFocusedCompleted ? '#cbd5e1' : '#ea580c', color: 'white', border: 'none', padding: '10px', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: isFocusedCompleted ? 'not-allowed' : 'pointer' }}
                        >
                            ⚡ 滿
                        </button>
                    </div>

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
                                                        🔍 處理
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