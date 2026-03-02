import { Html5Qrcode } from 'html5-qrcode'; 
import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, useNavigate, Route, Link, useLocation } from 'react-router-dom';
import InspectionHub from './pages/InspectionHub';
import InspectionZone from './pages/InspectionZone';
import './App.css';

// 🌟 升級版 Sidebar (支援手機側滑選單)
function Sidebar() {
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false); 

  const menuItems = [
    { path: '/', icon: '🏠', label: '系統首頁' }, 
    { path: '/scanner', icon: '📷', label: '掃碼出庫系統' },
    { path: '/inspection', icon: '🕵️‍♂️', label: '3PL 貨品檢測' },
    { path: '/yummy', icon: '🍔', label: 'Yummy 3PL' },
    { path: '/anymall', icon: '🛍️', label: 'Anymall 3PL' },
    { path: '/hellobear', icon: '🐻', label: 'Hello Bear 3PL' },
    { path: '/homey', icon: '🏠', label: 'Homey 3PL' },
    { path: '/label', icon: '🏷️', label: '標籤列印系統' },
    { path: '/search', icon: '🔍', label: '條碼搜尋系統' },
    { path: '/chat', icon: '💬', label: '查詢不到訂單' },
  ];

  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  return (
    <>
      <div className="mobile-header">
        <div className="mobile-logo">📦 Letech<span className="logo-dot">.</span></div>
        <button className="hamburger-btn" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? '✕' : '☰'}
        </button>
      </div>
      {isOpen && <div className="sidebar-overlay" onClick={() => setIsOpen(false)}></div>}
      <div className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-logo desktop-only">📦 Letech<span className="logo-dot">.</span></div>
        <div className="sidebar-menu">
          <div className="menu-header">主選單 MAIN MENU</div>
          {menuItems.map((item) => (
            <Link key={item.path} to={item.path} className={`menu-item ${location.pathname === item.path ? 'active' : ''}`}>
              <span className="menu-icon">{item.icon}</span> {item.label}
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}

// ----------------- ScannerPage (掃碼出庫系統 - UI 專業升級版) -----------------
function ScannerPage() {
  const [orderId, setOrderId] = useState('');
  const [orderData, setOrderData] = useState(null);
  const [inputVal, setInputVal] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false); 
  
  const inputRef = useRef(null);
  const lastCameraScan = useRef(""); 
  const isProcessingRef = useRef(false); 
  
  const orderIdRef = useRef('');
  const hasOrderRef = useRef(false);
  useEffect(() => { orderIdRef.current = orderId; }, [orderId]);
  useEffect(() => { hasOrderRef.current = !!orderData; }, [orderData]);

  useEffect(() => {
      if (orderData) {
          let t_q = 0, t_s = 0;
          (orderData.products || []).forEach(p => {
              if (p.products && p.products.length > 0) {
                  p.products.forEach(sp => { t_q += (sp.quantity || 0); t_s += (sp.scanQty || 0); });
              } else {
                  t_q += (p.quantity || 0); t_s += (p.scanQty || 0);
              }
          });
          const fullyScanned = t_q > 0 && t_s >= t_q;

          if (fullyScanned || orderData.status === true || orderData.status === "Completed") {
              setIsCompleted(true);
              setIsCameraOpen(false); 
              setSuccessMsg(`🎉 完美！訂單已全數出庫完成。即將返回...`);
              
              const timer = setTimeout(() => forceResetToHome(), 1500);
              return () => clearTimeout(timer);
          }
      }
  }, [orderData]);

  useEffect(() => {
    if (inputRef.current && !isCameraOpen && !isCompleted && !loading) {
      inputRef.current.focus();
    }
  }, [orderData, loading, isCameraOpen, isCompleted]);

  const handleFocusLoss = () => {
    if (!isCameraOpen && !isCompleted) {
      setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 100);
    }
  };

  const playSound = (type) => {
    if (navigator.vibrate) navigator.vibrate(type === 'success' ? 100 : [300, 100, 300]);
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const audioCtx = new AudioContext();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      if (type === 'success') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(1200, audioCtx.currentTime); 
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.1);
      } else {
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(300, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.3);
      }
    } catch (err) {}
  };

  const forceResetToHome = () => {
      setOrderData(null); setOrderId(''); setInputVal(''); 
      setSuccessMsg(''); setErrorMsg(''); setIsCameraOpen(false); setIsCompleted(false);
  };

  const submitOrder = async (targetOrderId) => {
    if (!targetOrderId.trim()) return;
    setLoading(true); setErrorMsg(''); setSuccessMsg(''); setIsCompleted(false);
    try {
      const res = await fetch(`https://letech-pro.onrender.com/api/scanner/order/${targetOrderId.trim()}`);
      if (!res.ok) throw new Error((await res.json()).detail);
      const data = await res.json();
      
      let t_q = 0, t_s = 0;
      (data.products || []).forEach(p => {
          if (p.products && p.products.length > 0) {
              p.products.forEach(sp => { t_q += (sp.quantity || 0); t_s += (sp.scanQty || 0); });
          } else {
              t_q += (p.quantity || 0); t_s += (p.scanQty || 0);
          }
      });

      if (data.status === true || data.status === "Completed" || (t_q > 0 && t_s >= t_q)) {
          throw new Error(`🚫 訂單 ${targetOrderId} 已出庫！請勿重複作業。`);
      }
      
      setOrderData(data);
      setOrderId(targetOrderId.trim());
      setInputVal('');
      playSound('success');
      setTimeout(() => setIsCameraOpen(true), 500);

    } catch (err) { setErrorMsg(err.message); playSound('error'); setInputVal(''); } 
    finally { setLoading(false); }
  };

  const submitBarcode = async (barcode) => {
    if (!barcode.trim()) return;
    setInputVal('');
    setLoading(true); setErrorMsg(''); setSuccessMsg('');
    
    try {
      const res = await fetch('https://letech-pro.onrender.com/api/scanner/barcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderIdRef.current, barcode: barcode.trim() })
      });
      if (!res.ok) throw new Error((await res.json()).detail);
      const data = await res.json();
      playSound('success');
      setOrderData(data.order_data);
      
      let t_q = 0, t_s = 0;
      (data.order_data?.products || []).forEach(p => {
          if (p.products && p.products.length > 0) {
              p.products.forEach(sp => { t_q += (sp.quantity || 0); t_s += (sp.scanQty || 0); });
          } else {
              t_q += (p.quantity || 0); t_s += (p.scanQty || 0);
          }
      });
      const fullyScanned = t_q > 0 && t_s >= t_q;

      if (!data.is_done && !fullyScanned) {
          setSuccessMsg(`✅ ${barcode} 掃描成功！請繼續掃下一件...`);
      }

    } catch (err) { 
        setErrorMsg(err.message); 
        playSound('error'); 
        setIsCameraOpen(false); 
    } 
    finally { setLoading(false); }
  };

  const handleOrderKeyDown = (e) => { if (e.key === 'Enter') submitOrder(inputVal); };
  const handleBarcodeKeyDown = (e) => { if (e.key === 'Enter') submitBarcode(inputVal); };
  
  const handleReset = async () => {
    if (window.confirm("確定要換單或重置目前進度嗎？")) {
      try { await fetch(`https://letech-pro.onrender.com/api/scanner/cancel/${orderIdRef.current}`, { method: 'POST' }); } catch (e) {}
      forceResetToHome();
    }
  };

  const handleForceComplete = async () => {
    if (window.confirm("🚨 警告：確定要「強制出庫」此訂單嗎？\n這將忽略未掃描的數量並直接過帳！")) {
      setLoading(true); setErrorMsg(''); setSuccessMsg('');
      try {
        const res = await fetch(`https://letech-pro.onrender.com/api/scanner/force_complete/${orderIdRef.current}`, { method: 'POST' });
        if (!res.ok) throw new Error((await res.json()).detail);
        
        playSound('success');
        setSuccessMsg(`🚨 訂單 ${orderIdRef.current} 已成功強制出庫！`);
        setIsCompleted(true); 
        setIsCameraOpen(false);
        setTimeout(() => forceResetToHome(), 1500);
      } catch (err) { setErrorMsg(err.message); playSound('error'); } 
      finally { setLoading(false); }
    }
  };

  useEffect(() => {
    let html5QrCode;
    if (isCameraOpen && !isCompleted) {
      html5QrCode = new Html5Qrcode("reader");
      const cameraConfig = { facingMode: "environment" }; 
      const scanConfig = { fps: 10, qrbox: { width: 250, height: 150 }, aspectRatio: 1.0 };
      
      html5QrCode.start(
        cameraConfig,
        scanConfig,
        (decodedText) => {
          if (isProcessingRef.current) return;
          if (lastCameraScan.current === decodedText) return;

          isProcessingRef.current = true;
          lastCameraScan.current = decodedText;
          setTimeout(() => { lastCameraScan.current = ""; }, 2000);
          
          if (!hasOrderRef.current) {
              setIsCameraOpen(false);
              if (html5QrCode && html5QrCode.isScanning) {
                 html5QrCode.stop().then(() => html5QrCode.clear()).catch(e => console.log(e));
              }
              submitOrder(decodedText).finally(() => { isProcessingRef.current = false; });
          } else {
              submitBarcode(decodedText).finally(() => { isProcessingRef.current = false; });
          }
        },
        (error) => { }
      ).catch(err => {
         setIsCameraOpen(false);
      });
    }
    return () => {
      if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().then(() => html5QrCode.clear()).catch(e => console.log(e));
      }
    };
  }, [isCameraOpen, isCompleted]); 

  if (!orderData) {
    return (
      <div className="page-content" onClick={handleFocusLoss}>
        <div className="page-header" style={{ textAlign: 'center', marginBottom: '30px' }}>
            <h2 style={{ fontSize: '32px', color: '#0f172a', fontWeight: '800' }}>📦 出庫作業台</h2>
            <p style={{ color: '#64748b', fontSize: '16px' }}>請使用實體掃描槍或相機掃描訂單</p>
        </div>
        
        {successMsg && <div style={{ background: '#dcfce7', color: '#166534', padding: '15px', borderRadius: '12px', textAlign: 'center', fontWeight: 'bold', marginBottom: '20px', border: '1px solid #bbf7d0', boxShadow: '0 4px 6px rgba(22, 101, 52, 0.1)' }}>{successMsg}</div>}
        {errorMsg && <div style={{ background: '#fef2f2', color: '#991b1b', padding: '15px', borderRadius: '12px', textAlign: 'center', fontWeight: 'bold', marginBottom: '20px', border: '1px solid #fecaca', boxShadow: '0 4px 6px rgba(153, 27, 27, 0.1)' }}>{errorMsg}</div>}

        <div style={{ maxWidth: '480px', margin: '0 auto', background: '#ffffff', padding: '40px 30px', borderRadius: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.08)', textAlign: 'center', border: '1px solid #f1f5f9' }}>
            {isCameraOpen ? (
                <div style={{ marginBottom: '25px' }}>
                    <div id="reader" style={{ width: '100%', borderRadius: '16px', overflow: 'hidden', border: '2px solid #e2e8f0' }}></div>
                    <button onClick={() => setIsCameraOpen(false)} style={{ marginTop: '15px', background: '#fef2f2', color: '#ef4444', padding: '12px 20px', borderRadius: '10px', border: '1px solid #fca5a5', fontWeight: 'bold', cursor: 'pointer', width: '100%', transition: 'all 0.2s' }}>❌ 關閉相機</button>
                </div>
            ) : (
                <button onClick={() => setIsCameraOpen(true)} style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', color: 'white', padding: '16px 20px', fontSize: '18px', borderRadius: '14px', border: 'none', fontWeight: 'bold', cursor: 'pointer', width: '100%', marginBottom: '25px', boxShadow: '0 6px 12px rgba(37, 99, 235, 0.2)', transition: 'transform 0.1s' }}>
                    📷 啟用手機相機掃描
                </button>
            )}

            <div style={{ display: 'flex', alignItems: 'center', margin: '20px 0' }}>
                <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }}></div>
                <span style={{ padding: '0 15px', color: '#94a3b8', fontSize: '14px', fontWeight: '500' }}>或使用實體掃描槍</span>
                <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }}></div>
            </div>
            
            <input 
                ref={inputRef} type="text" value={inputVal} onChange={(e) => setInputVal(e.target.value)} onKeyDown={handleOrderKeyDown}
                placeholder="在此掃描單號..." disabled={loading || isCameraOpen}
                style={{ width: '100%', padding: '16px', fontSize: '20px', textAlign: 'center', borderRadius: '14px', border: '2px solid #cbd5e1', outline: 'none', fontWeight: 'bold', backgroundColor: (loading || isCameraOpen) ? '#f8fafc' : '#ffffff', color: '#334155', transition: 'border-color 0.2s', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)' }}
            />
            {loading && <p style={{ color: '#2563eb', fontWeight: 'bold', marginTop: '15px', fontSize: '15px' }}>⏳ 連線伺服器中...</p>}
        </div>
      </div>
    );
  }

  let totalQty = 0; let totalScanned = 0;
  const products = orderData.products || [];
  products.forEach(p => {
      if (p.products && p.products.length > 0) {
          p.products.forEach(sp => { totalQty += (sp.quantity || 0); totalScanned += (sp.scanQty || 0); });
      } else {
          totalQty += (p.quantity || 0); totalScanned += (p.scanQty || 0);
      }
  });
  const progressPercent = totalQty === 0 ? 0 : Math.min((totalScanned / totalQty) * 100, 100);

  return (
    <div className="page-content" onClick={handleFocusLoss}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px', flexWrap: 'wrap', gap: '15px', background: '#ffffff', padding: '20px 25px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 2px 10px rgba(0,0,0,0.02)' }}>
            <div>
                <h2 style={{ fontSize: '24px', margin: '0 0 5px 0', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ background: '#eff6ff', color: '#2563eb', padding: '4px 10px', borderRadius: '8px', fontSize: '14px' }}>處理中</span>
                    {orderId}
                </h2>
                <div style={{ color: '#d97706', fontWeight: '700', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    📍 目的地：{orderData.order?.deliver_to_warehouse || '未指定'}
                </div>
            </div>
            
            <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={handleForceComplete} disabled={loading || isCompleted} style={{ background: '#fef2f2', color: '#ef4444', border: '1px solid #fca5a5', padding: '10px 20px', borderRadius: '10px', fontWeight: 'bold', cursor: (loading || isCompleted) ? 'not-allowed' : 'pointer', fontSize: '14px', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    ⚠️ 強制出庫
                </button>
                <button onClick={handleReset} disabled={loading || isCompleted} style={{ background: '#f8fafc', color: '#475569', border: '1px solid #cbd5e1', padding: '10px 20px', borderRadius: '10px', fontWeight: 'bold', cursor: (loading || isCompleted) ? 'not-allowed' : 'pointer', fontSize: '14px', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    🔄 換單重置
                </button>
            </div>
        </div>

        <div style={{ display: 'flex', gap: '25px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: '1.5', minWidth: '320px', background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 4px 15px rgba(0,0,0,0.03)' }}>
                <div style={{ padding: '20px 25px', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontWeight: '700', color: '#334155', fontSize: '15px' }}>
                        <span>📦 出庫進度</span>
                        <span style={{ color: progressPercent === 100 ? '#10b981' : '#2563eb' }}>{totalScanned} / {totalQty}</span>
                    </div>
                    <div style={{ width: '100%', background: '#f1f5f9', borderRadius: '999px', height: '10px', overflow: 'hidden', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)' }}>
                        <div style={{ width: `${progressPercent}%`, background: progressPercent === 100 ? '#10b981' : '#3b82f6', height: '100%', transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)' }}></div>
                    </div>
                </div>
                
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                      <thead>
                          <tr style={{ background: '#f8fafc', color: '#64748b', borderBottom: '1px solid #e2e8f0', textTransform: 'uppercase', fontSize: '12px', letterSpacing: '0.5px' }}>
                              <th style={{ padding: '16px 20px', minWidth: '200px', fontWeight: '700' }}>商品名稱</th>
                              <th style={{ padding: '16px 20px', fontWeight: '700' }}>條碼</th>
                              <th style={{ padding: '16px 20px', textAlign: 'center', fontWeight: '700' }}>應出</th>
                              <th style={{ padding: '16px 20px', textAlign: 'center', fontWeight: '700' }}>已掃</th>
                              <th style={{ padding: '16px 20px', textAlign: 'center', fontWeight: '700' }}>狀態</th>
                          </tr>
                      </thead>
                      <tbody>
                          {products.map((p, idx) => {
                              const hasChildren = p.products && p.products.length > 0;
                              const isDone = hasChildren ? false : (p.quantity - p.scanQty) <= 0;
                              
                              let allChildrenDone = false;
                              if (hasChildren) {
                                  const c_tq = p.products.reduce((sum, sp) => sum + (sp.quantity || 0), 0);
                                  const c_ts = p.products.reduce((sum, sp) => sum + (sp.scanQty || 0), 0);
                                  allChildrenDone = c_tq > 0 && c_ts >= c_tq;
                              }
                              const parentBg = hasChildren ? (allChildrenDone ? '#f0fdf4' : '#f8fafc') : (isDone ? '#f0fdf4' : '#ffffff');

                              return (
                                  <React.Fragment key={idx}>
                                      <tr style={{ borderBottom: '1px solid #f1f5f9', background: parentBg, transition: 'background 0.2s' }}>
                                          <td style={{ padding: '16px 20px', fontWeight: '600', color: '#0f172a', lineHeight: '1.4' }}>{p.skuNameZh}</td>
                                          <td style={{ padding: '16px 20px', color: '#475569', fontSize: '13px', fontFamily: '"Courier New", Courier, monospace', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{p.barcode}</td>
                                          
                                          {/* 🌟 如果是母單，隱藏數量，避免混淆 */}
                                          <td style={{ padding: '16px 20px', textAlign: 'center', fontWeight: '600', color: '#64748b' }}>
                                              {hasChildren ? '-' : p.quantity}
                                          </td>
                                          <td style={{ padding: '16px 20px', textAlign: 'center', fontWeight: '700', color: isDone ? '#15803d' : '#2563eb' }}>
                                              {hasChildren ? '-' : p.scanQty}
                                          </td>
                                          <td style={{ padding: '16px 20px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                              {hasChildren ? (
                                                  <span style={{ padding: '6px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '700', background: allChildrenDone ? '#dcfce7' : '#e2e8f0', color: allChildrenDone ? '#166534' : '#475569' }}>
                                                      {allChildrenDone ? '✅ 組合完成' : '📦 組合母單'}
                                                  </span>
                                              ) : (
                                                  <span style={{ padding: '6px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '700', background: isDone ? '#dcfce7' : '#fef3c7', color: isDone ? '#166534' : '#b45309' }}>
                                                      {isDone ? '✅ 已完成' : `缺 ${p.quantity - p.scanQty}`}
                                                  </span>
                                              )}
                                          </td>
                                      </tr>
                                      {(p.products || []).map((sp, sidx) => {
                                          const sDone = (sp.quantity - sp.scanQty) <= 0;
                                          return (
                                              <tr key={`${idx}-${sidx}`} style={{ borderBottom: '1px solid #f1f5f9', background: sDone ? '#f0fdf4' : '#fafafa' }}>
                                                  <td style={{ padding: '12px 20px 12px 40px', color: '#475569', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                      <span style={{ color: '#cbd5e1' }}>↳</span> {sp.skuNameZh}
                                                  </td>
                                                  <td style={{ padding: '12px 20px', color: '#64748b', fontSize: '12px', fontFamily: '"Courier New", Courier, monospace', whiteSpace: 'nowrap' }}>{sp.barcode}</td>
                                                  <td style={{ padding: '12px 20px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>{sp.quantity}</td>
                                                  <td style={{ padding: '12px 20px', textAlign: 'center', fontWeight: '600', color: sDone ? '#15803d' : '#2563eb', fontSize: '13px' }}>{sp.scanQty}</td>
                                                  <td style={{ padding: '12px 20px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                                      <span style={{ padding: '4px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: '700', background: sDone ? '#dcfce7' : '#fef3c7', color: sDone ? '#166534' : '#b45309' }}>
                                                          {sDone ? '✅ 完成' : `缺 ${sp.quantity - sp.scanQty}`}
                                                      </span>
                                                  </td>
                                              </tr>
                                          )
                                      })}
                                  </React.Fragment>
                              )
                          })}
                      </tbody>
                  </table>
                </div>
            </div>

            {/* 右側：現代化掃描區 */}
            <div style={{ flex: '1', minWidth: '300px', position: 'sticky', top: '20px' }}>
                {successMsg && <div style={{ background: '#dcfce7', color: '#166534', padding: '16px', borderRadius: '14px', textAlign: 'center', fontWeight: '700', marginBottom: '15px', border: '1px solid #bbf7d0', boxShadow: '0 4px 6px rgba(22, 101, 52, 0.1)' }}>{successMsg}</div>}
                {errorMsg && <div style={{ background: '#fef2f2', color: '#991b1b', padding: '16px', borderRadius: '14px', textAlign: 'center', fontWeight: '700', marginBottom: '15px', border: '1px solid #fecaca', boxShadow: '0 4px 6px rgba(153, 27, 27, 0.1)' }}>{errorMsg}</div>}

                <div style={{ background: '#ffffff', padding: '30px 25px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.04)', textAlign: 'center', border: '1px solid #e2e8f0' }}>
                    <div style={{ background: '#f8fafc', width: '60px', height: '60px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 15px auto', fontSize: '24px' }}>🛒</div>
                    <h3 style={{ margin: '0 0 25px 0', fontSize: '20px', color: '#0f172a', fontWeight: '800' }}>連續掃描貨品</h3>

                    {isCameraOpen ? (
                        <div style={{ marginBottom: '20px' }}>
                            <div id="reader" style={{ width: '100%', borderRadius: '12px', overflow: 'hidden', border: '2px solid #e2e8f0' }}></div>
                            <button onClick={() => setIsCameraOpen(false)} style={{ marginTop: '15px', background: '#fef2f2', color: '#ef4444', padding: '12px 20px', borderRadius: '10px', border: '1px solid #fca5a5', fontWeight: 'bold', cursor: 'pointer', width: '100%', transition: 'all 0.2s' }}>❌ 關閉相機</button>
                        </div>
                    ) : (
                        <button onClick={() => setIsCameraOpen(true)} disabled={isCompleted} style={{ background: isCompleted ? '#cbd5e1' : 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: 'white', padding: '16px 20px', fontSize: '16px', borderRadius: '14px', border: 'none', fontWeight: 'bold', cursor: isCompleted ? 'not-allowed' : 'pointer', width: '100%', marginBottom: '25px', boxShadow: isCompleted ? 'none' : '0 6px 12px rgba(16, 185, 129, 0.2)', transition: 'transform 0.1s' }}>
                            📷 開啟手機相機
                        </button>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', margin: '20px 0' }}>
                        <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }}></div>
                        <span style={{ padding: '0 10px', color: '#94a3b8', fontSize: '13px', fontWeight: '500' }}>或使用實體掃描槍</span>
                        <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }}></div>
                    </div>

                    <input 
                        ref={inputRef} type="text" value={inputVal} onChange={(e) => setInputVal(e.target.value)} onKeyDown={handleBarcodeKeyDown}
                        placeholder="掃描商品條碼..." disabled={loading || isCameraOpen || isCompleted}
                        style={{ width: '100%', padding: '16px', fontSize: '20px', textAlign: 'center', borderRadius: '12px', border: '2px solid #10b981', outline: 'none', fontWeight: 'bold', backgroundColor: (loading || isCameraOpen || isCompleted) ? '#f8fafc' : '#ffffff', color: '#334155', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)' }}
                    />
                    <p style={{ color: '#64748b', fontSize: '13px', marginTop: '15px', fontWeight: '500' }}>
                        {isCompleted ? '🎉 訂單已完成，即將返回...' : isCameraOpen ? '🎯 鏡頭持續掃描中...' : '🔒 游標已鎖定，可直接刷條碼'}
                    </p>
                </div>
            </div>
        </div>
    </div>
  );
}

// ----------------- SearchPage (條碼搜尋系統) -----------------
function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async (e) => {
    if (e.key === 'Enter') {
      if (!query.trim()) return;
      setLoading(true); setError(''); setHasSearched(true);
      try {
        const response = await fetch(`https://letech-pro.onrender.com/api/search/?q=${encodeURIComponent(query)}`);
        if (!response.ok) { const errData = await response.json(); setError(errData.detail || '發生未知錯誤'); setResults([]); return; }
        const data = await response.json(); setResults(data);
      } catch (err) { setError('連線失敗！'); setResults([]); } finally { setLoading(false); }
    }
  };

  return (
    <div className="page-content">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h2>🔍 條碼搜尋系統</h2><p>請輸入 SKU / Barcode / Name 關鍵字，並按下 Enter 搜尋</p></div>
      </div>
      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        
        {/* 左側：搜尋區塊 */}
        <div style={{ flex: '1', minWidth: '300px', maxWidth: '700px', background: 'white', padding: '25px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
          <div style={{ position: 'relative', width: '100%', marginBottom: '20px' }}>
             <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleSearch} placeholder="輸入關鍵字並按下 Enter 搜尋..." 
                style={{ width: '100%', padding: '16px', paddingRight: '40px', borderRadius: '10px', border: '2px solid #e2e8f0', fontSize: '16px', outline: 'none', boxSizing: 'border-box' }} 
             />
             {query && (
               <button 
                 onClick={() => { setQuery(''); setResults([]); setHasSearched(false); }} 
                 style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '20px', cursor: 'pointer', padding: '5px' }}>
                 ✕
               </button>
             )}
          </div>

          {loading && <p style={{ color: '#64748b', fontWeight: 'bold' }}>⏳ 檔案檢索中，請稍候...</p>}
          {error && <p style={{ color: '#ef4444', fontWeight: 'bold' }}>❌ {error}</p>}
          {!loading && !error && hasSearched && results.length === 0 && <p style={{ color: '#f59e0b', fontWeight: 'bold' }}>❌ 找不到相符的資料</p>}
          
          {!loading && !error && results.length > 0 && (
            <div>
              <p style={{ color: '#10b981', fontWeight: 'bold', marginBottom: '15px' }}>✅ 找到 {results.length} 筆資料</p>
              {results.map((item, index) => (
                <div key={index} style={{ display: 'flex', alignItems: 'center', background: '#fff', border: '1px solid #eef0f2', borderRadius: '12px', padding: '15px', marginBottom: '15px', boxShadow: '0 2px 5px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '90px', height: '90px', background: '#f8fafc', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '20px', flexShrink: 0 }}>
                    <a href={item.SearchUrl} target="_blank" rel="noreferrer" style={{ background: '#10b981', color: 'white', padding: '8px 12px', borderRadius: '8px', textDecoration: 'none', fontSize: '13px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>🔍 查看</a>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 'bold' }}>商品編號 (Product Code)</div>
                    <div style={{ fontSize: '15px', fontFamily: 'monospace', marginBottom: '8px', fontWeight: 'bold' }}>{item.ProductCode}</div>
                    <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 'bold' }}>商品條碼 (Barcode)</div>
                    <div style={{ fontSize: '15px', fontFamily: 'monospace', marginBottom: '8px', fontWeight: 'bold' }}>{item.Barcode}</div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#334155', borderTop: '1px solid #f1f5f9', paddingTop: '10px', marginTop: '5px' }}>{item.Name}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* 右側：插入萬用資料庫上傳面板 */}
        <DatabaseUploader 
            title="⚙️ 搜尋專用資料庫"
            infoUrl="https://letech-pro.onrender.com/api/search/info"
            uploadUrl="https://letech-pro.onrender.com/api/search/upload"
        />

      </div>
    </div>
  );
}

// ================= 共用表格樣式 =================
const tableCellStyle = { padding: '12px', minWidth: '250px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.6' };

function YummyPage() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resultData, setResultData] = useState(null);

  const handleProcess = async () => {
    if (!file) { setError('請先選擇 PDF 檔案！'); return; }
    setLoading(true); setError(''); setResultData(null);
    const formData = new FormData(); formData.append('file', file);
    try {
      const response = await fetch('https://letech-pro.onrender.com/api/yummy/upload', { method: 'POST', body: formData });
      if (!response.ok) { const errData = await response.json(); throw new Error(errData.detail || '上傳或解析失敗'); }
      const data = await response.json(); setResultData(data);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const handleDownloadPDF = () => {
    if (resultData && resultData.download_url) {
        window.open(`https://letech-pro.onrender.com${resultData.download_url}`, '_blank');
    }
  };

  const handlePrint = (htmlContent) => {
    if (!htmlContent) return;
    fetch('https://letech-pro.onrender.com/api/stats/log_print', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'Yummy_Print' })
    }).catch(e => console.log(e));

    const win = window.open('', '_blank', 'width=400,height=400');
    if (win) { win.document.write(htmlContent); win.document.close(); win.onload = function() { win.focus(); win.onafterprint = function() { win.close(); }; win.print(); }; }
  };

  return (
    <div className="page-content">
      <div className="page-header"><h2>🍔 Yummy 3PL 系統</h2><p>上傳 HKTVmall Yummy Delivery Note 進行解析與列印</p></div>
      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', marginBottom: '25px' }}>
          <div style={{ flex: '1', background: 'white', padding: '25px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
            <input type="file" accept=".pdf" onChange={(e) => setFile(e.target.files[0])} style={{ marginBottom: '15px' }} /><br />
            <button onClick={handleProcess} disabled={loading} style={{ background: loading ? '#94a3b8' : '#3b82f6', color: 'white', padding: '12px 24px', borderRadius: '8px', border: 'none', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer' }}>
              {loading ? '⏳ 解析中...' : '📄 開始解析 PDF'}
            </button>
            {error && <p style={{ color: 'red', marginTop: '10px', fontWeight: 'bold' }}>❌ {error}</p>}
          </div>
          <DatabaseUploader title="⚙️ 3PL 主資料庫" infoUrl="https://letech-pro.onrender.com/api/master/info" uploadUrl="https://letech-pro.onrender.com/api/master/upload" />
      </div>
      {resultData && (
        <>
          <div style={{ display: 'flex', gap: '20px', marginBottom: '25px' }}>
            <div style={{ flex: '1', background: 'white', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
               <h3 style={{ marginBottom: '15px', color: '#0f172a' }}>📊 處理摘要</h3><p style={{ fontSize: '15px', color: '#475569', marginBottom: '10px' }}>有效解析筆數: <strong>{resultData.summary.total_pages}</strong></p>
               <button onClick={handleDownloadPDF} style={{ background: '#f1f5f9', color: '#334155', padding: '10px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 'bold', cursor: 'pointer', width: '100%' }}>📥 下載清洗後的 PDF</button>
            </div>
            <div style={{ flex: '2', background: 'white', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
               <h3 style={{ marginBottom: '15px', color: '#0f172a' }}>⚠️ 重複訂單檢測</h3>
               {resultData.summary.has_duplicates ? (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px' }}><p style={{ color: '#b91c1c', fontWeight: 'bold', marginBottom: '10px' }}>發現 {resultData.duplicates.length} 筆重複資料！</p><table style={{ width: '100%', fontSize: '13px', textAlign: 'left', borderCollapse: 'collapse' }}><thead><tr style={{ borderBottom: '1px solid #fca5a5' }}><th style={{ padding: '5px' }}>商品編號</th><th style={{ padding: '5px' }}>重複次數</th><th style={{ padding: '5px' }}>出現頁數</th></tr></thead><tbody>{resultData.duplicates.map((d, idx) => (<tr key={idx}><td style={{ padding: '5px', fontWeight: 'bold' }}>{d.Product_No}</td><td style={{ padding: '5px' }}>{d.Count}</td><td style={{ padding: '5px' }}>{d.Pages}</td></tr>))}</tbody></table></div>
               ) : ( <p style={{ color: '#15803d', fontWeight: 'bold', background: '#f0fdf4', padding: '10px', borderRadius: '8px' }}>✅ 未發現重複訂單</p> )}
            </div>
          </div>
          <div style={{ background: 'white', padding: '25px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
            <h3 style={{ marginBottom: '20px', color: '#0f172a' }}>📋 標籤生成清單</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', textAlign: 'left' }}>
                <thead><tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569' }}><th style={{ padding: '12px' }}>序號</th><th style={{ padding: '12px' }}>商品編號</th><th style={{ padding: '12px' }}>商品名稱</th><th style={{ padding: '12px' }}>商品條碼</th><th style={{ padding: '12px' }}>日期</th><th style={{ padding: '12px', textAlign: 'center' }}>數量</th><th style={{ padding: '12px', textAlign: 'center' }}>操作</th></tr></thead>
                <tbody>
                  {resultData.items.map((item, idx) => {
                    const isDup = resultData.duplicates.some(d => d.Product_No === item.Product_No);
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', backgroundColor: isDup ? '#fffbeb' : 'transparent' }}>
                        <td style={{ padding: '12px', color: '#94a3b8' }}>{idx + 1}</td>
                        <td style={{ padding: '12px', fontWeight: 'bold' }}>{item.Product_No}</td>
                        <td style={tableCellStyle}>{item.Name}</td>
                        <td style={{ padding: '12px', fontFamily: 'monospace', background: '#f1f5f9', borderRadius: '4px', padding: '4px 8px', margin: '8px' }}>{item.Barcode}</td>
                        <td style={{ padding: '12px', color: '#64748b' }}>{item.Date}</td>
                        <td style={{ padding: '12px', fontWeight: 'bold', fontSize: '16px', textAlign: 'center' }}>{item.Qty}</td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {item.status === 'empty' ? (
                            <span style={{ display: 'inline-block', padding: '6px 12px', background: '#fef2f2', color: '#dc2626', borderRadius: '6px', fontWeight: 'bold', fontSize: '13px', border: '1px solid #fecaca' }}>無資料</span>
                          ) : (
                            <button onClick={() => handlePrint(item.print_html)} style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', padding: '6px 16px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>🖨️ 打印標籤</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AnymallPage() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resultData, setResultData] = useState(null);

  const handleProcess = async () => {
    if (!file) { setError('請先選擇 PDF 檔案！'); return; }
    setLoading(true); setError(''); setResultData(null);
    const formData = new FormData(); formData.append('file', file);
    try {
      const response = await fetch('https://letech-pro.onrender.com/api/anymall/upload', { method: 'POST', body: formData });
      if (!response.ok) { const errData = await response.json(); throw new Error(errData.detail || '上傳或解析失敗'); }
      const data = await response.json(); setResultData(data);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const handleDownloadPDF = () => {
    if (resultData && resultData.download_url) { window.open(`https://letech-pro.onrender.com${resultData.download_url}`, '_blank'); }
  };

  const handlePrint = (htmlContent) => {
    if (!htmlContent) return;
    fetch('https://letech-pro.onrender.com/api/stats/log_print', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'Anymall_Print' }) 
    }).catch(e => console.log(e));

    const win = window.open('', '_blank', 'width=400,height=400');
    if (win) { win.document.write(htmlContent); win.document.close(); win.onload = function() { win.focus(); win.onafterprint = function() { win.close(); }; win.print(); }; }
  };

  return (
    <div className="page-content">
      <div className="page-header"><h2>🛍️ Anymall 3PL 系統</h2><p>上傳 Anymall Delivery Note (PDF) 進行極速解析</p></div>
      <div style={{ background: 'white', padding: '25px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', marginBottom: '25px' }}>
        <input type="file" accept=".pdf" onChange={(e) => setFile(e.target.files[0])} style={{ marginBottom: '15px' }} /><br />
        <button onClick={handleProcess} disabled={loading} style={{ background: loading ? '#94a3b8' : '#10b981', color: 'white', padding: '12px 24px', borderRadius: '8px', border: 'none', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer' }}>{loading ? '⏳ 解析中...' : '📄 開始解析 PDF'}</button>
        {error && <p style={{ color: 'red', marginTop: '10px', fontWeight: 'bold' }}>❌ {error}</p>}
      </div>
      {resultData && (
        <>
          <div style={{ display: 'flex', gap: '20px', marginBottom: '25px' }}>
            <div style={{ flex: '1', background: 'white', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
               <h3 style={{ marginBottom: '15px', color: '#0f172a' }}>📊 處理摘要</h3><p style={{ fontSize: '15px', color: '#475569', marginBottom: '10px' }}>有效解析筆數: <strong>{resultData.summary.total_pages}</strong></p>
               <button onClick={handleDownloadPDF} style={{ background: '#f1f5f9', color: '#334155', padding: '10px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 'bold', cursor: 'pointer', width: '100%' }}>📥 下載清洗後的 PDF</button>
            </div>
            <div style={{ flex: '2', background: 'white', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
               <h3 style={{ marginBottom: '15px', color: '#0f172a' }}>⚠️ 重複訂單檢測</h3>
               {resultData.summary.has_duplicates ? (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px' }}><p style={{ color: '#b91c1c', fontWeight: 'bold', marginBottom: '10px' }}>發現 {resultData.duplicates.length} 筆重複資料！</p><table style={{ width: '100%', fontSize: '13px', textAlign: 'left', borderCollapse: 'collapse' }}><thead><tr style={{ borderBottom: '1px solid #fca5a5' }}><th style={{ padding: '5px' }}>商品編號</th><th style={{ padding: '5px' }}>重複次數</th><th style={{ padding: '5px' }}>出現頁數</th></tr></thead><tbody>{resultData.duplicates.map((d, idx) => (<tr key={idx}><td style={{ padding: '5px', fontWeight: 'bold' }}>{d.Product_No}</td><td style={{ padding: '5px' }}>{d.Count}</td><td style={{ padding: '5px' }}>{d.Pages}</td></tr>))}</tbody></table></div>
               ) : ( <p style={{ color: '#15803d', fontWeight: 'bold', background: '#f0fdf4', padding: '10px', borderRadius: '8px' }}>✅ 未發現重複訂單</p> )}
            </div>
          </div>
          <div style={{ background: 'white', padding: '25px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
            <h3 style={{ marginBottom: '20px', color: '#0f172a' }}>📋 標籤生成清單</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', textAlign: 'left' }}>
                <thead><tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569' }}><th style={{ padding: '12px' }}>序號</th><th style={{ padding: '12px' }}>商品編號</th><th style={{ padding: '12px' }}>商品名稱</th><th style={{ padding: '12px' }}>商品條碼</th><th style={{ padding: '12px', textAlign: 'center' }}>數量</th><th style={{ padding: '12px', textAlign: 'center' }}>操作狀態</th></tr></thead>
                <tbody>
                  {resultData.items.map((item, idx) => {
                    const isDup = resultData.duplicates.some(d => d.Product_No === item.Product_No);
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', backgroundColor: isDup ? '#fffbeb' : 'transparent' }}>
                        <td style={{ padding: '12px', color: '#94a3b8' }}>{idx + 1}</td>
                        <td style={{ padding: '12px', fontWeight: 'bold' }}>{item.Product_No}</td>
                        <td style={tableCellStyle}>{item.Name}</td>
                        <td style={{ padding: '12px', fontFamily: 'monospace', background: '#f1f5f9', borderRadius: '4px', padding: '4px 8px', margin: '8px' }}>{item.Barcode}</td>
                        <td style={{ padding: '12px', fontWeight: 'bold', fontSize: '16px', textAlign: 'center' }}>{item.Qty}</td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {item.status === 'no_print' ? (
                            <span style={{ display: 'inline-block', padding: '6px 12px', background: '#f8fafc', color: '#94a3b8', borderRadius: '6px', fontWeight: 'bold', fontSize: '13px',whiteSpace: 'nowrap', border: '1px solid #e2e8f0' }}>無需打印</span>
                          ) : (
                            <button onClick={() => handlePrint(item.print_html)} style={{ background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0', padding: '6px 16px', borderRadius: '6px', whiteSpace: 'nowrap', fontWeight: 'bold',fontSize: '13px', cursor: 'pointer'}}>🖨️ 打印標籤</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function HelloBearPage() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resultData, setResultData] = useState(null);

  const handleProcess = async () => {
    if (!file) { setError('請先選擇 PDF 檔案！'); return; }
    setLoading(true); setError(''); setResultData(null);
    const formData = new FormData(); formData.append('file', file);
    try {
      const response = await fetch('https://letech-pro.onrender.com/api/hellobear/upload', { method: 'POST', body: formData });
      if (!response.ok) { const errData = await response.json(); throw new Error(errData.detail || '上傳或解析失敗'); }
      const data = await response.json(); setResultData(data);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const handleDownloadPDF = () => {
    if (resultData && resultData.download_url) { window.open(`https://letech-pro.onrender.com${resultData.download_url}`, '_blank'); }
  };

  const handlePrint = (htmlContent) => {
    if (!htmlContent) return;
    fetch('https://letech-pro.onrender.com/api/stats/log_print', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'HelloBear_Print' }) 
    }).catch(e => console.log(e));
    
    const win = window.open('', '_blank', 'width=400,height=400');
    if (win) { win.document.write(htmlContent); win.document.close(); win.onload = function() { win.focus(); win.onafterprint = function() { win.close(); }; win.print(); }; }
  };

  return (
    <div className="page-content">
      <div className="page-header"><h2>🐻 Hello Bear 3PL 系統</h2><p>上傳 Hello Bear Delivery Note (PDF) 進行極速解析</p></div>
      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', marginBottom: '25px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1', minWidth: '300px', background: 'white', padding: '25px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
          <input type="file" accept=".pdf" onChange={(e) => setFile(e.target.files[0])} style={{ width: '100%', marginBottom: '15px' }} /><br />
          <button onClick={handleProcess} disabled={loading} style={{ width: '20%', background: loading ? '#94a3b8' : '#8b5cf6', color: 'white', padding: '12px 24px', borderRadius: '8px', border: 'none', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? '⏳ 解析中...' : '📄 開始解析 PDF'}
          </button>
          {error && <p style={{ color: 'red', marginTop: '10px', fontWeight: 'bold' }}>❌ {error}</p>}
        </div>

        <DatabaseUploader title="⚙️ 3PL & 標籤主資料庫" infoUrl="https://letech-pro.onrender.com/api/master/info" uploadUrl="https://letech-pro.onrender.com/api/master/upload" />
      </div>
      {resultData && (
        <>
          <div style={{ display: 'flex', gap: '20px', marginBottom: '25px' }}>
            <div style={{ flex: '1', background: 'white', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
               <h3 style={{ marginBottom: '15px', color: '#0f172a' }}>📊 處理摘要</h3><p style={{ fontSize: '15px', color: '#475569', marginBottom: '10px' }}>有效解析筆數: <strong>{resultData.summary.total_pages}</strong></p>
               <button onClick={handleDownloadPDF} style={{ background: '#f1f5f9', color: '#334155', padding: '10px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 'bold', cursor: 'pointer', width: '100%' }}>📥 下載清洗後的 PDF</button>
            </div>
            <div style={{ flex: '2', background: 'white', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
               <h3 style={{ marginBottom: '15px', color: '#0f172a' }}>⚠️ 重複訂單檢測</h3>
               {resultData.summary.has_duplicates ? (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px' }}><p style={{ color: '#b91c1c', fontWeight: 'bold', marginBottom: '10px' }}>發現 {resultData.duplicates.length} 筆重複資料！</p><table style={{ width: '100%', fontSize: '13px', textAlign: 'left', borderCollapse: 'collapse' }}><thead><tr style={{ borderBottom: '1px solid #fca5a5' }}><th style={{ padding: '5px' }}>商品編號</th><th style={{ padding: '5px' }}>重複次數</th><th style={{ padding: '5px' }}>出現頁數</th></tr></thead><tbody>{resultData.duplicates.map((d, idx) => (<tr key={idx}><td style={{ padding: '5px', fontWeight: 'bold' }}>{d.Product_No}</td><td style={{ padding: '5px' }}>{d.Count}</td><td style={{ padding: '5px' }}>{d.Pages}</td></tr>))}</tbody></table></div>
               ) : ( <p style={{ color: '#15803d', fontWeight: 'bold', background: '#f0fdf4', padding: '10px', borderRadius: '8px' }}>✅ 未發現重複訂單</p> )}
            </div>
          </div>
          <div style={{ background: 'white', padding: '25px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
            <h3 style={{ marginBottom: '20px', color: '#0f172a' }}>📋 標籤生成清單</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', textAlign: 'left' }}>
                <thead><tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569' }}><th style={{ padding: '12px' }}>序號</th><th style={{ padding: '12px' }}>商品編號</th><th style={{ padding: '12px' }}>商品名稱</th><th style={{ padding: '12px' }}>商品條碼</th><th style={{ padding: '12px', textAlign: 'center' }}>數量</th><th style={{ padding: '12px', textAlign: 'center' }}>操作狀態</th></tr></thead>
                <tbody>
                  {resultData.items.map((item, idx) => {
                    const isDup = resultData.duplicates.some(d => d.Product_No === item.Product_No);
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', backgroundColor: isDup ? '#fffbeb' : 'transparent' }}>
                        <td style={{ padding: '12px', color: '#94a3b8' }}>{idx + 1}</td>
                        <td style={{ padding: '12px', fontWeight: 'bold' }}>{item.Product_No}</td>
                        <td style={tableCellStyle}>{item.Name}</td>
                        <td style={{ padding: '12px', fontFamily: 'monospace', background: '#f1f5f9', borderRadius: '4px', padding: '4px 8px', margin: '8px' }}>{item.Barcode}</td>
                        <td style={{ padding: '12px', fontWeight: 'bold', fontSize: '16px', textAlign: 'center' }}>{item.Qty}</td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {item.status === 'no_print' ? (
                            <span style={{ display: 'inline-block', padding: '6px 12px', background: '#f8fafc', color: '#94a3b8', borderRadius: '6px', fontWeight: 'bold', fontSize: '13px', border: '1px solid #e2e8f0' }}>無需打印</span>
                          ) : (
                            <button onClick={() => handlePrint(item.print_html)} style={{ background: '#f3e8ff', color: '#7c3aed', border: '1px solid #ddd6fe', padding: '6px 16px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>🖨️ 打印標籤</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ----------------- HomeyPage (支援智慧判定多種標籤) -----------------
function HomeyPage() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resultData, setResultData] = useState(null);

  const handleProcess = async () => {
    if (!file) { setError('請先選擇 PDF 檔案！'); return; }
    setLoading(true); setError(''); setResultData(null);
    const formData = new FormData(); formData.append('file', file);
    try {
      const response = await fetch('https://letech-pro.onrender.com/api/homey/upload', { method: 'POST', body: formData });
      if (!response.ok) { const errData = await response.json(); throw new Error(errData.detail || '上傳或解析失敗'); }
      const data = await response.json(); setResultData(data);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const handleDownloadPDF = () => {
    if (resultData && resultData.download_url) { window.open(`https://letech-pro.onrender.com${resultData.download_url}`, '_blank'); }
  };

  const handlePrint = (htmlContent) => {
    if (!htmlContent) return;
    fetch('https://letech-pro.onrender.com/api/stats/log_print', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'Homey_Print' }) 
    }).catch(e => console.log(e));

    const finalHtml = htmlContent.replace('/* FONT_CSS_PLACEHOLDER */', resultData.font_css || '');
    const win = window.open('', '_blank', 'width=400,height=400');
    
    if (win) { 
        win.document.write(finalHtml); 
        win.document.close(); 
        setTimeout(() => { win.focus(); win.print(); }, 0); 
        win.onafterprint = function() { win.close(); }; 
    }
  };

  return (
    <div className="page-content">
      <div className="page-header"><h2>🏠 Homey 3PL 系統</h2><p>上傳 Homey Delivery Note (PDF) 進行極速解析 (支援蟲蟲、食品、Repack 標籤)</p></div>
      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', marginBottom: '25px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1', minWidth: '300px', background: 'white', padding: '25px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
          <input type="file" accept=".pdf" onChange={(e) => setFile(e.target.files[0])} style={{ width: '100%', marginBottom: '15px' }} /><br />
          <button onClick={handleProcess} disabled={loading} style={{ width: '20%', background: loading ? '#94a3b8' : '#14b8a6', color: 'white', padding: '12px 24px', borderRadius: '8px', border: 'none', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? '⏳ 解析中...' : '📄 開始解析 PDF'}
          </button>
          {error && <p style={{ color: 'red', marginTop: '10px', fontWeight: 'bold' }}>❌ {error}</p>}
        </div>

        <DatabaseUploader title="⚙️ 3PL & 標籤主資料庫" infoUrl="https://letech-pro.onrender.com/api/master/info" uploadUrl="https://letech-pro.onrender.com/api/master/upload" />
      </div>
      {resultData && (
        <>
          <div style={{ display: 'flex', gap: '20px', marginBottom: '25px' }}>
            <div style={{ flex: '1', background: 'white', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
               <h3 style={{ marginBottom: '15px', color: '#0f172a' }}>📊 處理摘要</h3><p style={{ fontSize: '15px', color: '#475569', marginBottom: '10px' }}>有效解析筆數: <strong>{resultData.summary.total_pages}</strong></p>
               <button onClick={handleDownloadPDF} style={{ background: '#f1f5f9', color: '#334155', padding: '10px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 'bold', cursor: 'pointer', width: '100%' }}>📥 下載清洗後的 PDF</button>
            </div>
            <div style={{ flex: '2', background: 'white', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
               <h3 style={{ marginBottom: '15px', color: '#0f172a' }}>⚠️ 重複訂單檢測</h3>
               {resultData.summary.has_duplicates ? (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px' }}><p style={{ color: '#b91c1c', fontWeight: 'bold', marginBottom: '10px' }}>發現 {resultData.duplicates.length} 筆重複資料！</p><table style={{ width: '100%', fontSize: '13px', textAlign: 'left', borderCollapse: 'collapse' }}><thead><tr style={{ borderBottom: '1px solid #fca5a5' }}><th style={{ padding: '5px' }}>商品編號</th><th style={{ padding: '5px' }}>重複次數</th><th style={{ padding: '5px' }}>出現頁數</th></tr></thead><tbody>{resultData.duplicates.map((d, idx) => (<tr key={idx}><td style={{ padding: '5px', fontWeight: 'bold' }}>{d.Product_No}</td><td style={{ padding: '5px' }}>{d.Count}</td><td style={{ padding: '5px' }}>{d.Pages}</td></tr>))}</tbody></table></div>
               ) : ( <p style={{ color: '#15803d', fontWeight: 'bold', background: '#f0fdf4', padding: '10px', borderRadius: '8px' }}>✅ 未發現重複訂單</p> )}
            </div>
          </div>
          <div style={{ background: 'white', padding: '25px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
            <h3 style={{ marginBottom: '20px', color: '#0f172a' }}>📋 標籤生成清單</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', textAlign: 'left' }}>
                <thead><tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569' }}><th style={{ padding: '12px' }}>序號</th><th style={{ padding: '12px' }}>商品編號</th><th style={{ padding: '12px', minWidth: '250px' }}>商品名稱</th><th style={{ padding: '12px' }}>商品條碼</th><th style={{ padding: '12px', textAlign: 'center' }}>數量</th><th style={{ padding: '12px', textAlign: 'center' }}>標籤類型</th><th style={{ padding: '12px', textAlign: 'center' }}>操作狀態</th></tr></thead>
                <tbody>
                  {resultData.items.map((item, idx) => {
                    const isDup = resultData.duplicates.some(d => d.Product_No === item.Product_No);
                    const isHighlight = ["repack", "sku", "蟲", "food"].some(k => item.label_type.toLowerCase().includes(k));
                    
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', backgroundColor: isDup ? '#fffbeb' : 'transparent' }}>
                        <td style={{ padding: '12px', color: '#94a3b8' }}>{idx + 1}</td>
                        <td style={{ padding: '12px', fontWeight: 'bold' }}>{item.Product_No}</td>
                        <td style={{ padding: '12px', minWidth: '250px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.6', ...(isHighlight ? { backgroundColor: '#FFFFAA', color: '#B30000', fontWeight: 'bold' } : {}) }}>{item.Name}</td>
                        <td style={{ padding: '12px', fontFamily: 'monospace', background: '#f1f5f9', borderRadius: '4px', padding: '4px 8px', margin: '8px' }}>{item.Barcode}</td>
                        <td style={{ padding: '12px', fontWeight: 'bold', fontSize: '16px', textAlign: 'center' }}>{item.Qty}</td>
                        <td style={{ padding: '12px', textAlign: 'center', fontWeight: 'bold', ...(isHighlight ? { backgroundColor: '#FFFFAA', whiteSpace: 'nowrap', color: '#B30000' } : {}) }}>{item.label_type}</td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {item.status === 'no_print' ? (
                            <span style={{ display: 'inline-block', padding: '6px 12px', background: '#f8fafc', color: '#94a3b8', borderRadius: '6px', fontWeight: 'bold', fontSize: '13px', border: '1px solid #e2e8f0' }}>{item.label_type}</span>
                          ) : (
                            <button onClick={() => handlePrint(item.print_html)} style={{ background: '#ccfbf1', color: '#0f766e', border: '1px solid #99f6e4', padding: '6px 16px', whiteSpace: 'nowrap', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>🖨️ 打印標籤</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ----------------- FoodLabelPage (標籤列印系統) -----------------
function FoodLabelPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [quantities, setQuantities] = useState({});

  const handleSearch = async (e) => {
    if (e.key === 'Enter') {
      if (!query.trim()) return;
      setLoading(true); setError(''); setHasSearched(true);
      try {
        const response = await fetch(`https://letech-pro.onrender.com/api/food_label/search?q=${encodeURIComponent(query)}`);
        if (!response.ok) { const errData = await response.json(); setError(errData.detail || '發生未知錯誤'); setResults([]); return; }
        const data = await response.json(); 
        setResults(data);
        const initQtys = {};
        data.forEach(r => { initQtys[r.Product_No] = 1; });
        setQuantities(initQtys);
      } catch (err) { setError('連線失敗！請確認後端已啟動。'); setResults([]); } finally { setLoading(false); }
    }
  };

  const handlePrint = async (item) => {
    const qty = quantities[item.Product_No] || 1;
    try {
      const response = await fetch('https://letech-pro.onrender.com/api/food_label/generate_html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: { Product_No: item.Product_No, Barcode: item.Barcode, Name: item.Name }, matched_data: item.matched_data, qty: parseInt(qty), status: item.status })
      });
      if (!response.ok) { throw new Error('無法生成標籤'); }
      const data = await response.json();
      
      const win = window.open('', '_blank', 'width=400,height=400');
      if (win) { win.document.write(data.html); win.document.close(); win.onload = function() { win.focus(); win.onafterprint = function() { win.close(); }; win.print(); }; }
    } catch (err) { alert("列印失敗：" + err.message); }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'food': return <span style={{ background: '#dcfce7', color: '#0f766e', padding: '6px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '13px', border: '1px solid #a7f3d0' }}>🍕 食品標籤</span>;
      case 'insect': return <span style={{ background: '#fef08a', color: '#b45309', padding: '6px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '13px', border: '1px solid #fde047' }}>🐛 蟲蟲標籤</span>;
      case 'caution': return <span style={{ background: '#fee2e2', color: '#b91c1c', padding: '6px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '13px', border: '1px solid #fecaca' }}>⚠️ 警告標籤</span>;
      default: return <span style={{ background: '#f1f5f9', color: '#64748b', padding: '6px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '13px', border: '1px solid #cbd5e1' }}>❌ 無資料</span>;
    }
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>🏷️ 標籤列印系統 (Food Label)</h2>
        <p>輸入 Product No / Barcode / 名稱，搜尋並列印專屬標籤</p>
      </div>
      
      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', marginBottom: '25px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1', minWidth: '300px', background: 'white', padding: '25px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
           <h3 style={{ fontSize: '16px', marginBottom: '15px', color: '#0f172a' }}>🔍 搜尋商品</h3>
           <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleSearch} placeholder="輸入關鍵字並按下 Enter 搜尋..." style={{ width: '100%', padding: '16px', borderRadius: '10px', border: '2px solid #e2e8f0', fontSize: '16px', outline: 'none' }} />
           {loading && <p style={{ color: '#3b82f6', fontWeight: 'bold', marginTop: '15px' }}>⏳ 資料檢索中，請稍候...</p>}
           {error && <p style={{ color: '#ef4444', fontWeight: 'bold', marginTop: '15px' }}>❌ {error}</p>}
           {!loading && !error && hasSearched && results.length === 0 && <p style={{ color: '#f59e0b', fontWeight: 'bold', marginTop: '15px' }}>❌ 找不到相符的商品資料</p>}
        </div>

        <DatabaseUploader title="⚙️ 3PL & 標籤主資料庫" infoUrl="https://letech-pro.onrender.com/api/master/info" uploadUrl="https://letech-pro.onrender.com/api/master/upload" />
      </div>
      
      {error && <p style={{ color: '#ef4444', fontWeight: 'bold' }}>❌ {error}</p>}
      
      {!loading && !error && results.length > 0 && (
         <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(500px, 1fr))', gap: '20px' }}>
            {results.map((item, index) => (
                <div key={index} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 10px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '15px' }}>
                            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#1e293b', lineHeight: '1.4', paddingRight: '15px' }}>{item.Name}</div>
                            <div style={{ flexShrink: 0 }}>{getStatusBadge(item.status)}</div>
                        </div>
                        
                        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
                            <div style={{ background: '#f8fafc', padding: '6px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }}>
                                <span style={{ color: '#64748b', fontWeight: 'bold', marginRight: '5px' }}>商品編號</span>
                                <span style={{ color: '#0369a1', fontFamily: 'monospace', fontWeight: 'bold', fontSize: '14px' }}>{item.Product_No}</span>
                            </div>
                            <div style={{ background: '#f8fafc', padding: '6px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }}>
                                <span style={{ color: '#64748b', fontWeight: 'bold', marginRight: '5px' }}>條碼</span>
                                <span style={{ color: '#0369a1', fontFamily: 'monospace', fontWeight: 'bold', fontSize: '14px' }}>{item.Barcode}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div style={{ display: 'flex', gap: '15px', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '15px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontWeight: 'bold', color: '#475569', fontSize: '14px' }}>數量:</span>
                            <input 
                                type="number" min="1" max="1000" 
                                value={quantities[item.Product_No] || 1} 
                                onChange={(e) => setQuantities({...quantities, [item.Product_No]: e.target.value})}
                                style={{ width: '80px', padding: '10px', borderRadius: '8px', border: '2px solid #cbd5e1', textAlign: 'center', fontWeight: 'bold', fontSize: '16px', outline: 'none' }} 
                            />
                        </div>
                        {item.status !== 'empty' ? (
                            <button onClick={() => handlePrint(item)} style={{ flex: 1, background: '#3b82f6', color: 'white', border: 'none', padding: '12px 16px', borderRadius: '8px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '5px' }}>
                                🖨️ 打印 {item.status === 'food' ? '食品標籤' : item.status === 'insect' ? '蟲蟲標籤' : '警告標籤'}
                            </button>
                        ) : (
                            <button disabled style={{ flex: 1, background: '#e2e8f0', color: '#94a3b8', border: 'none', padding: '12px 16px', borderRadius: '8px', fontWeight: 'bold', fontSize: '15px', cursor: 'not-allowed' }}>
                                ❌ 無資料 (無法列印)
                            </button>
                        )}
                    </div>
                </div>
            ))}
         </div>
      )}
    </div>
  );
}

// ----------------- ChatPage (查詢不到訂單 - 完美捲動版) -----------------
function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [userName, setUserName] = useState('');
  const [inputText, setInputText] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [isSending, setIsSending] = useState(false);
  
  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const forceScrollRef = useRef(false); 

  const fetchMessages = async () => {
    try {
      const res = await fetch('https://letech-pro.onrender.com/api/chat/messages');
      const data = await res.json();
      if (data.status === 'success') {
        setMessages(data.messages);
      }
    } catch (err) { console.error("獲取訊息失敗", err); }
  };

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;

    if (forceScrollRef.current || isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      forceScrollRef.current = false; 
    }
  }, [messages]); 

  const compressImage = (file) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const MAX_WIDTH = 800;
          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
              const newFile = new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() });
              resolve(newFile);
            }, 'image/jpeg', 0.8);
        };
      };
    });
  };

  const handleSend = async () => {
    if (!userName.trim()) { alert("⚠️ 請先在左上方輸入您的「名字」！"); return; }
    if (!inputText.trim() && !selectedImage) return;

    setIsSending(true);
    let fileToSend = selectedImage;
    if (selectedImage) { fileToSend = await compressImage(selectedImage); }

    const formData = new FormData();
    formData.append('user_name', userName);
    formData.append('message', inputText);
    if (fileToSend) formData.append('file', fileToSend);

    try {
      const res = await fetch('https://letech-pro.onrender.com/api/chat/message', { method: 'POST', body: formData });
      if (res.ok) {
        setInputText('');
        setSelectedImage(null);
        const fileInput = document.getElementById('chat-image-upload');
        if (fileInput) fileInput.value = '';
        forceScrollRef.current = true; 
        fetchMessages(); 
      } else {
        const errData = await res.json();
        alert(`發送失敗: ${errData.detail}`);
      }
    } catch (err) { alert("連線失敗"); } 
    finally { setIsSending(false); }
  };

  const handleDelete = async (msgId) => {
    if (!window.confirm("確定要撤回這則訊息嗎？")) return;
    try {
      const res = await fetch(`https://letech-pro.onrender.com/api/chat/message/${msgId}`, { method: 'DELETE' });
      if (res.ok) { fetchMessages(); } else { alert("撤回失敗，請稍後再試。"); }
    } catch (err) { alert("連線失敗！"); }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="page-content" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 40px)' }}>
      <div className="page-header" style={{ marginBottom: '15px' }}>
        <h2 style={{ fontSize: '30px' }}>💬 查詢不到訂單記錄</h2>
        <p>這裡是專屬的溝通頻道，遇到找不到訂單的狀況請在此回報。</p>
        <div style={{ background: '#f0fdf4', color: '#166534', padding: '12px 15px', borderRadius: '8px', border: '1px solid #bbf7d0', fontSize: '14px', marginTop: '10px' }}>
          💡 <strong>填寫範例</strong>：<br/>
          <strong>查詢不到訂單：H260225512645-H0956006</strong><br/>
          <span style={{ opacity: 0.8 }}>(提示：您在下方只需輸入「訂單號碼」即可，發送時系統會自動幫您加上「查詢不到訂單：」的前綴)</span>
        </div>
      </div>

      <div style={{ marginBottom: '15px' }}>
        <input 
          type="text" placeholder="👤 請輸入名字 (必填)" value={userName} onChange={(e) => setUserName(e.target.value)} 
          style={{ padding: '10px 15px', borderRadius: '8px', border: '2px solid #e2e8f0', outline: 'none', width: '250px', fontSize: '15px', fontWeight: 'bold' }}
        />
      </div>

      <div ref={scrollContainerRef} style={{ flex: 1, background: '#f8fafc', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px' }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#94a3b8', marginTop: 'auto', marginBottom: 'auto' }}>目前沒有訊息</div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.user_name === userName;
            const msgDate = new Date(msg.created_at);
            const now = new Date();
            const diffInSeconds = (now - msgDate) / 1000;
            const isWithinOneMinute = diffInSeconds <= 60;
            const canDelete = isMe && isWithinOneMinute;

            return (
              <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '4px', marginLeft: '5px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <strong style={{ color: '#3b82f6', fontSize: '14px' }}>{msg.user_name}</strong>
                  <span>• {msg.display_time}</span>
                  {canDelete && (
                    <span onClick={() => handleDelete(msg.id)} style={{ cursor: 'pointer', color: '#ef4444', fontWeight: 'bold', fontSize: '12px', padding: '2px 6px', background: '#fee2e2', borderRadius: '4px' }} title="1分鐘內可撤回訊息">
                      🗑️ 撤回
                    </span>
                  )}
                </div>
                <div style={{ background: 'white', color: '#0f172a', padding: '12px 16px', borderRadius: '4px 16px 16px 16px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', maxWidth: '85%', wordWrap: 'break-word', border: '1px solid #e2e8f0' }}>
                  {msg.message && <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{msg.message}</div>}
                  {msg.image_url && (
                    <img src={msg.image_url} alt="附件圖片" style={{ maxWidth: '250px', width: '100%', borderRadius: '8px', marginTop: msg.message ? '10px' : '0', cursor: 'pointer', border: '1px solid #e2e8f0' }} onClick={() => window.open(msg.image_url, '_blank')} title="點擊放大圖片" />
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 🌟 修正手機版按鈕被擠出去的問題 */}
      <div style={{ marginTop: '15px', background: 'white', padding: '10px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #e2e8f0', width: '100%', boxSizing: 'border-box' }}>
        
        {/* 加入 flexShrink: 0 防止圖標被壓縮 */}
        <label style={{ cursor: 'pointer', background: '#f1f5f9', padding: '10px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} title="上傳圖片">
          🖼️
          <input id="chat-image-upload" type="file" accept="image/jpeg, image/png, image/jpg" style={{ display: 'none' }} onChange={(e) => setSelectedImage(e.target.files[0])} />
        </label>
        
        {/* 🌟 關鍵：加入 minWidth: 0，讓輸入框遇到小螢幕會乖乖縮小 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {selectedImage && <div style={{ fontSize: '12px', color: '#10b981', fontWeight: 'bold', marginBottom: '5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>📎 {selectedImage.name}</div>}
          <input 
            type="text" placeholder="請輸入單號..." value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={handleKeyDown}
            style={{ width: '100%', padding: '10px', border: 'none', outline: 'none', fontSize: '15px', background: 'transparent', boxSizing: 'border-box' }}
          />
        </div>
        
        {/* 加入 flexShrink: 0 和 whiteSpace: 'nowrap' 確保按鈕永遠可見且不換行 */}
        <button onClick={handleSend} disabled={isSending} style={{ background: isSending ? '#94a3b8' : '#3b82f6', color: 'white', border: 'none', padding: '12px 18px', borderRadius: '10px', fontWeight: 'bold', cursor: isSending ? 'not-allowed' : 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
          {isSending ? '傳送中...' : '發送 🚀'}
        </button>
      </div>
    </div>
  );
}

// ----------------- HomePage (系統首頁 - 滿血完全體) -----------------
function HomePage() {
  const navigate = useNavigate();

  const features = [
    { id: 'scanner', title: '📦 掃碼出庫作業', desc: '支援相機與實體掃描槍，光速讀取條碼並同步至 Letech 伺服器，自動核對出庫明細，防止漏發與錯發。', path: '/scanner', icon: '🛒', bgGradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', shadow: 'rgba(16, 185, 129, 0.25)', status: '🟢 系統正常' },
    { id: 'inspection', title: '🕵️‍♂️ 3PL 貨品檢測', desc: '上傳各平台 PDF 生成專屬檢測任務，支援手機即時掃碼核對，精準控管包裝數量，杜絕出貨錯誤。', path: '/inspection', icon: '🕵️‍♂️', bgGradient: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)', shadow: 'rgba(14, 165, 233, 0.25)', status: '🟢 系統正常' },
    { id: 'search', title: '🔍 條碼搜尋系統', desc: '極速檢索全站商品資料庫。支援 SKU、條碼、名稱關鍵字模糊比對，一秒定位商品詳細資訊。', path: '/search', icon: '🔍', bgGradient: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', shadow: 'rgba(99, 102, 241, 0.25)', status: '🟢 系統正常' },
    { id: 'label', title: '🏷️ 智能標籤列印', desc: '輸入關鍵字自動從資料庫抓取營養標示、蟲蟲警語，一鍵排版並支援自訂數量快速列印食品標籤。', path: '/label', icon: '🖨️', bgGradient: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', shadow: 'rgba(59, 130, 246, 0.25)', status: '🟢 系統正常' },
    { id: 'yummy', title: '🍔 Yummy 3PL', desc: '專屬 HKTVmall Yummy Delivery Note 解析引擎，自動清洗無效資料並偵測重複訂單，快速產出列印清單。', path: '/yummy', icon: '🍔', bgGradient: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)', shadow: 'rgba(249, 115, 22, 0.25)', status: '🟢 系統正常' },
    { id: 'anymall', title: '🛍️ Anymall 3PL', desc: 'Anymall PDF 智能解析模組，自動抓取商品編號與數量，智能判定是否需要列印標籤。', path: '/anymall', icon: '🛍️', bgGradient: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)', shadow: 'rgba(236, 72, 153, 0.25)', status: '🟢 系統正常' },
    { id: 'hellobear', title: '🐻 Hello Bear 3PL', desc: '針對 Hello Bear 的訂單結構優化，專門判定 T06 特殊條碼，支援高效率批量資料轉換。', path: '/hellobear', icon: '🐻', bgGradient: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', shadow: 'rgba(139, 92, 246, 0.25)', status: '🟢 系統正常' },
    { id: 'homey', title: '🏠 Homey 3PL', desc: 'Homey 專用處理中心，具備多重標籤判定邏輯，自動切換蟲蟲、食品、Repack 等特殊標籤排版。', path: '/homey', icon: '🏠', bgGradient: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)', shadow: 'rgba(20, 184, 166, 0.25)', status: '🟢 系統正常' },
    { id: 'chat', title: '💬 異常訂單回報', desc: '專屬的即時通訊頻道，遇到查無訂單、包裝異常等狀況，支援圖片上傳與文字回報，1分鐘內可撤回。', path: '/chat', icon: '🚨', bgGradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', shadow: 'rgba(245, 158, 11, 0.25)', status: '🟢 系統正常' }
  ];

  return (
    <div className="page-content">
      <style>{`
        .feature-card { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); transform: translateY(0); }
        .feature-card:hover { transform: translateY(-8px); }
        .feature-card:hover .card-icon-wrapper { transform: scale(1.1) rotate(5deg); }
        .card-icon-wrapper { transition: all 0.3s ease; }
      `}</style>

      <div style={{ background: '#ffffff', borderRadius: '24px', padding: '40px', marginBottom: '30px', boxShadow: '0 4px 20px rgba(0,0,0,0.03)', border: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px' }}>
          <div>
              <h1 style={{ fontSize: '36px', color: '#0f172a', margin: '0 0 10px 0', fontWeight: '800', letterSpacing: '-0.5px' }}>歡迎使用 Letech 智能管理系統</h1>
              <p style={{ color: '#64748b', fontSize: '18px', margin: 0 }}>選擇下方功能模組以開始今日的工作流程。</p>
          </div>
          <div style={{ background: '#f8fafc', padding: '15px 25px', borderRadius: '16px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '15px' }}>
              <div style={{ width: '12px', height: '12px', background: '#10b981', borderRadius: '50%', boxShadow: '0 0 10px #10b981', animation: 'pulse 2s infinite' }}></div>
              <div>
                  <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px' }}>System Status</div>
                  <div style={{ fontSize: '16px', color: '#0f172a', fontWeight: '800' }}>All Services Online</div>
              </div>
          </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '25px' }}>
          {features.map((item) => (
              <div key={item.id} className="feature-card" onClick={() => navigate(item.path)} style={{ background: '#ffffff', borderRadius: '24px', padding: '30px', cursor: 'pointer', border: '1px solid #e2e8f0', boxShadow: `0 10px 30px ${item.shadow}`, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '6px', background: item.bgGradient }}></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                      <div className="card-icon-wrapper" style={{ width: '64px', height: '64px', borderRadius: '16px', background: item.bgGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', boxShadow: `0 8px 16px ${item.shadow}` }}>{item.icon}</div>
                      <span style={{ background: '#f1f5f9', color: '#475569', padding: '6px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 'bold' }}>{item.status}</span>
                  </div>
                  <h3 style={{ fontSize: '22px', color: '#0f172a', margin: '0 0 12px 0', fontWeight: '800' }}>{item.title}</h3>
                  <p style={{ color: '#64748b', fontSize: '15px', lineHeight: '1.6', margin: '0 0 25px 0', flex: 1 }}>{item.desc}</p>
                  <div style={{ display: 'flex', alignItems: 'center', color: '#3b82f6', fontWeight: 'bold', fontSize: '15px' }}>進入系統 <span style={{ marginLeft: '8px', fontSize: '18px' }}>→</span></div>
              </div>
          ))}
      </div>
    </div>
  );
}

// ================= 共用元件：萬用資料庫上傳面板 =================
function DatabaseUploader({ title, infoUrl, uploadUrl }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [dbInfo, setDbInfo] = useState({ name: '尚未載入', total: 0 });

  const fetchDbInfo = async () => {
    try {
      const res = await fetch(infoUrl);
      const data = await res.json();
      if (data.total_records > 0) {
        setDbInfo({ name: data.current_db_name, total: data.total_records });
      } else {
        setDbInfo({ name: '尚未載入', total: 0 });
      }
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchDbInfo(); }, [infoUrl]);

  const handleUpload = async () => {
    if (!file) { setUploadMsg('⚠️ 請先選擇檔案！'); return; }
    setUploading(true); setUploadMsg('');
    const formData = new FormData(); formData.append('file', file);
    try {
      const response = await fetch(uploadUrl, { method: 'POST', body: formData });
      if (!response.ok) throw new Error('上傳失敗');
      const data = await response.json();
      setUploadMsg(`✅ 成功：${data.message}`); 
      setFile(null);
      fetchDbInfo(); 
    } catch (err) { setUploadMsg('❌ 上傳失敗！'); } finally { setUploading(false); }
  };

  return (
    <div style={{ width: '320px', background: 'white', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0', flexShrink: 0 }}>
      <h3 style={{ fontSize: '16px', marginBottom: '10px', color: '#0f172a' }}>{title}</h3>
      {dbInfo.total > 0 ? (
         <div style={{ marginBottom: '15px', padding: '10px', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
           <p style={{ margin: 0, fontSize: '13px', color: '#166534', fontWeight: 'bold', wordBreak: 'break-all' }}>✅ 目前檔案: {dbInfo.name}</p>
           <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#15803d' }}>系統已記住 {dbInfo.total.toLocaleString()} 筆資料</p>
         </div>
      ) : ( <p style={{ fontSize: '13px', color: '#ef4444', fontWeight: 'bold', marginBottom: '15px' }}>⚠️ 尚未載入資料庫，請先上傳</p> )}
      <input type="file" accept=".csv, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, text/csv" onChange={(e) => setFile(e.target.files[0])} style={{ width: '100%', marginBottom: '15px', fontSize: '13px' }} />
      <button onClick={handleUpload} disabled={uploading} style={{ width: '100%', padding: '10px', borderRadius: '8px', background: uploading ? '#94a3b8' : '#3b82f6', color: 'white', border: 'none', fontWeight: 'bold', cursor: uploading ? 'not-allowed' : 'pointer' }}>{uploading ? '⏳ 資料上傳中...' : '確認更新資料庫'}</button>
      {uploadMsg && <div style={{ marginTop: '15px', padding: '10px', borderRadius: '8px', background: uploadMsg.includes('✅') ? '#f0fdf4' : '#fef2f2', color: uploadMsg.includes('✅') ? '#15803d' : '#b91c1c', fontSize: '13px', fontWeight: 'bold' }}>{uploadMsg}</div>}
    </div>
  );
}

function App() {
  return (
    <Router>
      <div className="app-container">
        <Sidebar />
        <div className="main-content">
          <Routes>
            <Route path="/" element={<HomePage />} /> 
            <Route path="/search" element={<SearchPage />} />
            <Route path="/yummy" element={<YummyPage />} />
            <Route path="/anymall" element={<AnymallPage />} />
            <Route path="/hellobear" element={<HelloBearPage />} />
            <Route path="/scanner" element={<ScannerPage />} />
            <Route path="/homey" element={<HomeyPage />} />
            <Route path="/label" element={<FoodLabelPage />} />
            <Route path="/chat" element={<ChatPage />} />
            
            <Route path="/inspection" element={<InspectionHub />} />
            <Route path="/inspection/anymall" element={<InspectionZone zoneName="Anymall" />} />
            <Route path="/inspection/hellobear" element={<InspectionZone zoneName="Hello Bear" />} />
            <Route path="/inspection/yummy" element={<InspectionZone zoneName="Yummy" />} />
            <Route path="/inspection/homey" element={<InspectionZone zoneName="Homey" />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;