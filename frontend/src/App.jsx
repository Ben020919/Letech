import { Html5Qrcode } from 'html5-qrcode'; 
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { BrowserRouter as Router, Routes, useNavigate, Route, Link, useLocation } from 'react-router-dom';
import InspectionHub from './pages/InspectionHub';
import InspectionZone from './pages/InspectionZone';
import InspectionHistory from './pages/InspectionHistory';
import './App.css';

// 🌟 自動切換測試與正式環境的 API 網址
//   - 上線(Vercel build):用 Render
//   - 本地 npm run dev:預設 127.0.0.1:8000;但如果想淨係改 UI 唔起後端,
//     可以喺 frontend/.env.local 設 VITE_API_BASE=https://letech-pro.onrender.com
//     咁 local dev 就會用 production 真數據(只睇 UI 效果好方便)
const API_BASE_URL =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.DEV ? "http://127.0.0.1:8000" : "https://letech-pro.onrender.com");

// 🔒 共用 hook — 偵測係咪手機(< 640px)。用嚟收埋管理員/admin 用嘅 controls,
// 防止用手機嘅員工誤撳資料庫上傳、刪除任務之類嘅嘢。
function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < breakpoint);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);
  return isMobile;
}

// 🌟 升級版 Sidebar (支援手機側滑選單)
function Sidebar() {
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  const menuItems = [
    { path: '/', icon: '🏠', label: '系統首頁' },
    { path: '/search', icon: '🔍', label: '智能查詢中心' }, // 👈 整合後的新選單
    { path: '/inspection', icon: '🕵️‍♂️', label: '3PL 貨品檢測' },
    { path: '/yummy', icon: '🍔', label: 'Yummy 3PL' },
    { path: '/anymall', icon: '🛍️', label: 'Anymall 3PL' },
    { path: '/hellobear', icon: '🐻', label: 'Hello Bear 3PL' },
    { path: '/homey', icon: '🏠', label: 'Homey 3PL' },
    { path: '/label-search', icon: '🖨️', label: '標籤搜尋打印' },
    { path: '/label-repack', icon: '✏️', label: '自助 Repack' },
    { path: '/bin-location', icon: '📍', label: 'Bin Location 倉位' },
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

// ================= 分離式設計：條碼搜尋 + DEAR 庫存查詢 =================
function UnifiedSearchInventoryPage() {
  const isMobile = useIsMobile();
  // --- 搜尋系統 State ---
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  // --- 庫存系統 State ---
  const [invQuery, setInvQuery] = useState(''); // 下方獨立的輸入框
  const [invSku, setInvSku] = useState('');     // 當前顯示庫存結果的 SKU
  const [invResults, setInvResults] = useState(null);
  const [productInfo, setProductInfo] = useState(null); 
  const [componentsInventory, setComponentsInventory] = useState(null);
  const [invLoading, setInvLoading] = useState(false);
  const [invError, setInvError] = useState('');
  
  const inventorySectionRef = useRef(null);

  // 處理 DEAR 庫存資料的輔助函數
  const processInventoryData = (invArray) => {
    const targetLocation = "HKTV SD4";
    const filtered = invArray ? invArray.filter(item => {
      if (!item.Location || item.Location.trim().toUpperCase() !== targetLocation) return false;
      if ((item.OnHand || 0) === 0 && (item.Allocated || 0) === 0 && (item.OnOrder || 0) === 0 && (item.Available || 0) === 0) return false;
      return true;
    }) : [];

    let tSOH = 0, tAlloc = 0, tAvail = 0;
    const grouped = {};

    filtered.forEach(item => {
      tSOH += (item.OnHand || 0);
      tAlloc += (item.Allocated || 0);
      tAvail += (item.Available || 0);

      let batchDisplay = item.Batch || '-';
      let formattedDate = '';
      if (item.ExpiryDate && item.ExpiryDate !== "") {
          const dateObj = new Date(item.ExpiryDate);
          if (!isNaN(dateObj.getTime())) {
              formattedDate = `(${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${dateObj.getFullYear()})`;
          }
      }

      const groupKey = `${batchDisplay}_${formattedDate}`;
      if (!grouped[groupKey]) {
        grouped[groupKey] = { Batch: batchDisplay, ExpiryStr: formattedDate, SOH: 0, Avail: 0, OnOrder: 0, Allocated: 0 };
      }
      grouped[groupKey].SOH += (item.OnHand || 0);
      grouped[groupKey].Avail += (item.Available || 0);
      grouped[groupKey].OnOrder += (item.OnOrder || 0);
      grouped[groupKey].Allocated += (item.Allocated || 0);
    });

    const rows = Object.values(grouped).filter(r => r.SOH !== 0 || r.Avail !== 0 || r.OnOrder !== 0 || r.Allocated !== 0);
    return { filtered, tSOH, tAlloc, tAvail, rows };
  };

  // 1. 執行本地資料庫搜尋
  const handleSearchSubmit = async (e) => {
    e?.preventDefault();
    if (!searchQuery.trim()) return;
    
    setSearchLoading(true); setSearchError(''); setHasSearched(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/search/?q=${encodeURIComponent(searchQuery.trim())}`);
      if (!response.ok) { 
        const errData = await response.json(); 
        setSearchError(errData.detail || '搜尋發生未知錯誤'); 
        setSearchResults([]); 
        return; 
      }
      const data = await response.json(); 
      setSearchResults(data);
    } catch (err) { 
      setSearchError('資料庫連線失敗！'); 
      setSearchResults([]); 
    } finally { 
      setSearchLoading(false); 
    }
  };

  // 2. 執行 DEAR 庫存查詢
  const fetchInventory = async (skuTarget) => {
    setInvLoading(true); setInvError('');
    setInvResults(null); setProductInfo(null); setComponentsInventory(null);
    setInvSku(skuTarget);

    try {
      const response = await fetch(`${API_BASE_URL}/api/inventory/?sku=${encodeURIComponent(skuTarget)}`);
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || result.detail || result.message || '查詢失敗');
      }

      setInvResults(result.data);
      if (result.product_info) setProductInfo(result.product_info);
      if (result.components_inventory) setComponentsInventory(result.components_inventory);

    } catch (err) {
      setInvError(err.message);
    } finally {
      setInvLoading(false);
    }
  };

  const handleInvSubmit = (e) => {
    e.preventDefault();
    if (!invQuery.trim()) return;
    fetchInventory(invQuery.trim());
  };

  // 3. 從搜尋結果點擊「查庫存」按鈕
  const handleCheckStockFromSearch = (sku) => {
    setInvQuery(sku); 
    fetchInventory(sku);
    setTimeout(() => {
        inventorySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const mainInv = invResults ? processInventoryData(invResults) : { filtered: [], tSOH: 0, tAlloc: 0, tAvail: 0, rows: [] };

  return (
    <div className="page-content" style={{ paddingBottom: '60px', maxWidth: '1000px', margin: '0 auto' }}>
      <div className="page-header" style={{ textAlign: 'center', marginBottom: '28px' }}>
        <h2 style={{ fontSize: '26px', color: 'var(--c-text)', fontWeight: '800', margin: 0, letterSpacing: '-0.6px' }}>🔍 智能查詢中心</h2>
        <p style={{ color: 'var(--c-text-muted)', fontSize: '14.5px', marginTop: '8px' }}>先搜尋商品,再確認庫存,雙管齊下更高效率。</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '35px' }}>
          
        {/* ================= 上層：資料庫搜尋專區 + 上傳面板 ================= */}
        <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          
          {/* 左側：搜尋區塊 */}
          <div style={{ flex: '1', minWidth: '300px', background: '#ffffff', padding: '24px', borderRadius: '18px', border: '1px solid #eef2f6', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                  <div style={{ width: '42px', height: '42px', background: 'var(--c-primary-soft)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>📚</div>
                  <div>
                    <h3 style={{ margin: 0, color: 'var(--c-text)', fontSize: '18px', fontWeight: '700' }}>本地資料庫搜尋</h3>
                    <div style={{ fontSize: '13px', color: 'var(--c-text-muted)' }}>SKU / Barcode / 中英文名</div>
                  </div>
              </div>

              <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '18px' }}>
                  <div style={{ position: 'relative', flex: '1', minWidth: '220px' }}>
                      <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="輸入 SKU / Barcode / 中英文名稱..."
                          style={{ width: '100%', padding: '13px 16px', fontSize: '15px', borderRadius: '12px', border: '1.5px solid var(--c-border)', outline: 'none', boxSizing: 'border-box' }}
                      />
                      {searchQuery && (
                          <button type="button" onClick={() => { setSearchQuery(''); setSearchResults([]); setHasSearched(false); }} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '18px', padding: '5px', cursor: 'pointer' }}>✕</button>
                      )}
                  </div>
                  <button type="submit" disabled={searchLoading} style={{ background: searchLoading ? '#94a3b8' : 'var(--c-primary)', color: 'white', padding: '13px 24px', fontSize: '15px', borderRadius: '12px', border: 'none', fontWeight: '700', cursor: searchLoading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {searchLoading ? '⏳ 搜尋中...' : '🔍 搜尋商品'}
                  </button>
              </form>

              {/* 搜尋結果顯示區 */}
              {searchError && <p style={{ color: '#ef4444', fontWeight: 'bold', padding: '10px', background: '#fef2f2', borderRadius: '10px' }}>❌ {searchError}</p>}
              {!searchLoading && !searchError && hasSearched && searchResults.length === 0 && <p style={{ color: '#d97706', fontWeight: 'bold', background: '#fef3c7', padding: '12px 15px', borderRadius: '12px', margin: 0 }}>⚠️ 找不到相符的商品資料</p>}

              {!searchLoading && searchResults.length > 0 && (
                  <div style={{ maxHeight: '350px', overflowY: 'auto', paddingRight: '5px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {searchResults.map((item, index) => (
                      <div key={index} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', background: '#ffffff', border: '1px solid var(--c-border-soft)', borderRadius: '14px', padding: '15px', gap: '15px', boxShadow: '0 1px 2px rgba(15,23,42,0.03)' }}>
                          <div style={{ flex: '1', minWidth: '200px' }}>
                              <div style={{ fontSize: '15.5px', fontWeight: '700', color: 'var(--c-text)', marginBottom: '9px', lineHeight: '1.45' }}>{item.Name}</div>
                              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '13px', alignItems: 'center' }}>
                                  <div style={{ background: 'var(--c-primary-soft)', padding: '4px 9px', borderRadius: '7px', border: '1px solid var(--c-primary-border)' }}><span style={{ color: '#64748b' }}>SKU</span> <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: 'var(--c-primary)', marginLeft: '2px' }}>{item.ProductCode}</span></div>
                                  <div style={{ background: '#ecfdf5', padding: '4px 9px', borderRadius: '7px', border: '1px solid #d1fae5' }}><span style={{ color: '#64748b' }}>Barcode</span> <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#10b981', marginLeft: '2px' }}>{item.Barcode}</span></div>
                                  {/* 🌟 位置 Bin Location — 分貨架/板位顏色 */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                      {item.Bins && item.Bins.length > 0 ? (
                                          item.Bins.map((b, bi) => {
                                              const t = LOC_TYPE_MAP[b.loc_type] || LOC_TYPE_MAP['貨架'];
                                              // Bins 已 FIFO 排序(後端):最舊日期排第一。2 個或以上 + 第一個有日期 → 標「先執呢個」
                                              const isPickFirst = bi === 0 && item.Bins.length > 1 && !!b.stock_date;
                                              return (
                                                  <span key={bi} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: isPickFirst ? '#dcfce7' : t.bg, border: `1px solid ${isPickFirst ? '#86efac' : t.border}`, color: isPickFirst ? '#166534' : t.color, padding: '3px 9px', borderRadius: '6px', fontWeight: 'bold' }}>
                                                      {isPickFirst && <span style={{ fontSize: '11px', background: '#16a34a', color: 'white', padding: '1px 6px', borderRadius: '8px' }}>👉 先執</span>}
                                                      {t.emoji} {t.key} <span style={{ fontFamily: 'monospace' }}>{b.bin}</span>
                                                      {b.stock_date && <span style={{ fontFamily: 'monospace', fontWeight: 'normal', marginLeft: '2px', opacity: 0.85 }}>📅{b.stock_date}</span>}
                                                  </span>
                                              );
                                          })
                                      ) : (
                                          <span style={{ color: '#94a3b8' }}>📍 <span style={{ color: '#cbd5e1', fontStyle: 'italic' }}>未設定位置</span></span>
                                      )}
                                  </div>
                              </div>
                          </div>
                          <div style={{ display: 'flex', gap: '10px', flexShrink: 0, width: '100%', justifyContent: 'flex-end', '@media (minWidth: 500px)': { width: 'auto' } }}>
                              {item.SearchUrl && item.SearchUrl !== '#' && (
                                  <a href={item.SearchUrl} target="_blank" rel="noreferrer" style={{ background: '#ffffff', color: '#475569', border: '1px solid #cbd5e1', padding: '10px 15px', borderRadius: '10px', textDecoration: 'none', fontSize: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🔗 商城</a>
                              )}
                              <button onClick={() => handleCheckStockFromSearch(item.ProductCode)} style={{ background: '#10b981', color: 'white', border: 'none', padding: '10px 15px', borderRadius: '10px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', boxShadow: '0 4px 10px rgba(16, 185, 129, 0.2)' }}>
                                  📦 查庫存
                              </button>
                          </div>
                      </div>
                      ))}
                  </div>
              )}
          </div>

          {/* 右側：插入資料庫上傳面板 — 🔒 手機隱藏防誤撳 */}
          {!isMobile && (
            <DatabaseUploader
                title="⚙️ 搜尋專用資料庫"
                infoUrl={`${API_BASE_URL}/api/search/info`}
                uploadUrl={`${API_BASE_URL}/api/search/upload`}
            />
          )}
        </div>

        {/* 下層：DEAR 庫存專區 */}
        <div ref={inventorySectionRef} style={{ background: '#ffffff', padding: '24px', borderRadius: '18px', border: '1px solid #eef2f6', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                <div style={{ width: '42px', height: '42px', background: '#ecfdf5', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>📦</div>
                <div>
                  <h3 style={{ margin: 0, color: 'var(--c-text)', fontSize: '18px', fontWeight: '700' }}>DEAR 即時庫存查詢</h3>
                  <div style={{ fontSize: '13px', color: 'var(--c-text-muted)' }}>輸入精確 SKU 查 HKTV SD4 庫存</div>
                </div>
            </div>

            <form onSubmit={handleInvSubmit} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
                <div style={{ position: 'relative', flex: '1', minWidth: '220px' }}>
                    <input
                        type="text"
                        value={invQuery}
                        onChange={(e) => setInvQuery(e.target.value)}
                        placeholder="請輸入精確的 SKU (如: LT10009829)"
                        style={{ width: '100%', padding: '13px 16px', fontSize: '15px', borderRadius: '12px', border: '1.5px solid var(--c-border)', outline: 'none', boxSizing: 'border-box' }}
                    />
                    {invQuery && (
                        <button type="button" onClick={() => { setInvQuery(''); }} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '18px', padding: '5px', cursor: 'pointer' }}>✕</button>
                    )}
                </div>
                <button type="submit" disabled={invLoading} style={{ background: invLoading ? '#94a3b8' : '#10b981', color: 'white', padding: '13px 24px', fontSize: '15px', borderRadius: '12px', border: 'none', fontWeight: '700', cursor: invLoading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {invLoading ? '⏳ 連線中...' : '📦 查詢庫存'}
                </button>
            </form>

            {!invSku && !invLoading && (
                <div style={{ textAlign: 'center', color: '#94a3b8', padding: '20px', background: '#f8fafc', borderRadius: '14px', border: '1px dashed #cbd5e1' }}>
                    請輸入 SKU 或從上方搜尋結果點擊「查庫存」帶入資料。
                </div>
            )}
            
            {invError && (
                <div style={{ background: '#fef2f2', color: '#991b1b', padding: '15px', borderRadius: '14px', fontWeight: 'bold', border: '1px solid #fecaca' }}>
                    ❌ 查詢失敗：{invError} 
                    <div style={{ fontSize: '13px', marginTop: '6px', color: '#b91c1c', fontWeight: 'normal' }}>(注意：DEAR 查詢僅支援精確的 SKU，不支援中文名稱)</div>
                </div>
            )}

            {!invLoading && !invError && invResults && (
              <div style={{ marginTop: '20px' }}>
                {productInfo && (
                    <div style={{ background: '#f8fafc', padding: '15px 20px', borderRadius: '14px', border: '1px solid #e2e8f0', marginBottom: '20px', display: 'flex', flexWrap: 'wrap', gap: '15px', alignItems: 'center' }}>
                        <div style={{ flex: '1', minWidth: '200px' }}>
                            <div style={{ fontSize: '18px', fontWeight: '900', color: '#0f172a', marginBottom: '6px', lineHeight: '1.3' }}>{productInfo.Name}</div>
                            {productInfo.Components && productInfo.Components.length > 0 && (
                                <span style={{ fontSize: '12px', background: '#dcfce7', color: '#166534', padding: '4px 8px', borderRadius: '6px', border: '1px solid #bbf7d0', display: 'inline-block' }}>📦 組合/多件裝商品</span>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <div style={{ background: 'white', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 'bold' }}>SKU</div>
                                <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#3b82f6', fontFamily: 'monospace' }}>{productInfo.SKU}</div>
                            </div>
                            <div style={{ background: 'white', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 'bold' }}>Barcode</div>
                                <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#10b981', fontFamily: 'monospace' }}>{productInfo.UPC}</div>
                            </div>
                        </div>
                    </div>
                )}

                <h4 style={{ color: '#0f172a', fontWeight: 'bold', fontSize: '16px', marginBottom: '12px' }}>
                  {mainInv.filtered.length > 0 ? `📍 主商品 HKTV SD4 庫存` : `⚠️ 主商品在 HKTV SD4 無實體庫存`}
                </h4>

                {mainInv.filtered.length > 0 && (
                  <div style={{ borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: '25px', boxShadow: '0 2px 10px rgba(0,0,0,0.02)' }}>
                    <div style={{ padding: '15px', background: '#f1f5f9', display: 'flex', flexWrap: 'wrap', gap: '15px', alignItems: 'center', borderBottom: '1px solid #e2e8f0' }}>
                        <div style={{ flex: '1', textAlign: 'center' }}><div style={{ fontSize: '11px', color: '#64748b', fontWeight: 'bold' }}>總 SOH</div><div style={{ fontSize: '22px', fontWeight: '900', color: '#334155' }}>{mainInv.tSOH}</div></div>
                        <div style={{ flex: '1', textAlign: 'center', borderLeft: '1px solid #cbd5e1', borderRight: '1px solid #cbd5e1' }}><div style={{ fontSize: '11px', color: '#64748b', fontWeight: 'bold' }}>Allocated</div><div style={{ fontSize: '22px', fontWeight: '900', color: '#64748b' }}>{mainInv.tAlloc}</div></div>
                        <div style={{ flex: '1', textAlign: 'center' }}><div style={{ fontSize: '11px', color: '#64748b', fontWeight: 'bold' }}>Available</div><div style={{ fontSize: '22px', fontWeight: '900', color: mainInv.tAvail > 0 ? '#16a34a' : '#dc2626' }}>{mainInv.tAvail}</div></div>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', minWidth: '350px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                        <thead>
                          <tr style={{ background: '#ffffff', color: '#475569', borderBottom: '2px solid #e2e8f0' }}>
                            <th style={{ padding: '12px 15px' }}>批號 / 效期</th>
                            <th style={{ padding: '12px 15px', textAlign: 'right' }}>SOH</th>
                            <th style={{ padding: '12px 15px', textAlign: 'right' }}>AVAIL</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mainInv.rows.map((item, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                              <td style={{ padding: '12px 15px', fontFamily: 'monospace', fontWeight: '600', color: '#1e293b' }}>
                                {item.Batch} {item.ExpiryStr && <><br/><span style={{ color: '#64748b', fontSize: '12px' }}>{item.ExpiryStr}</span></>}
                              </td>
                              <td style={{ padding: '12px 15px', fontWeight: '600', textAlign: 'right', color: '#334155' }}>{item.SOH}</td>
                              <td style={{ padding: '12px 15px', fontWeight: 'bold', color: item.Avail > 0 ? '#16a34a' : '#dc2626', textAlign: 'right' }}>{item.Avail}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {componentsInventory && Object.keys(componentsInventory).length > 0 && (
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '30px', marginBottom: '15px' }}>
                            <div style={{ height: '2px', flex: '1', background: '#dcfce7' }}></div>
                            <h4 style={{ color: '#065f46', fontWeight: 'bold', fontSize: '15px', margin: 0 }}>🔗 單件商品 HKTV SD4 庫存 (組合子件)</h4>
                            <div style={{ height: '2px', flex: '1', background: '#dcfce7' }}></div>
                        </div>

                        {Object.entries(componentsInventory).map(([compSku, compData]) => {
                            const detail = compData.detail;
                            const compInv = processInventoryData(compData.inventory);

                            return (
                                <div key={compSku} style={{ borderRadius: '16px', border: '1px solid #10b981', overflow: 'hidden', marginBottom: '15px', boxShadow: '0 2px 8px rgba(16, 185, 129, 0.05)' }}>
                                    <div style={{ padding: '15px', background: '#ecfdf5', display: 'flex', flexWrap: 'wrap', gap: '15px', alignItems: 'center' }}>
                                        <div style={{ flex: '1', minWidth: '150px' }}>
                                            <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#065f46', lineHeight: '1.3' }}>{detail.Name}</div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                                                <span style={{ fontSize: '13px', color: '#047857', fontFamily: 'monospace', fontWeight: 'bold' }}>{compSku}</span>
                                                <span style={{ background: '#10b981', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>每組 {detail.Quantity} 件</span>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '20px', textAlign: 'center', background: 'white', padding: '8px 15px', borderRadius: '10px' }}>
                                            <div><div style={{ fontSize: '11px', color: '#64748b' }}>SOH</div><div style={{ fontSize: '18px', fontWeight: '900', color: '#065f46' }}>{compInv.tSOH}</div></div>
                                            <div><div style={{ fontSize: '11px', color: '#64748b' }}>可用</div><div style={{ fontSize: '18px', fontWeight: '900', color: compInv.tAvail > 0 ? '#16a34a' : '#dc2626' }}>{compInv.tAvail}</div></div>
                                        </div>
                                    </div>
                                    {compInv.filtered.length > 0 && (
                                        <div style={{ overflowX: 'auto', borderTop: '1px solid #a7f3d0' }}>
                                        <table style={{ width: '100%', minWidth: '350px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                                            <thead style={{ background: '#f8fafc' }}>
                                            <tr>
                                                <th style={{ padding: '10px 15px', color: '#475569' }}>批號/效期</th>
                                                <th style={{ padding: '10px 15px', textAlign: 'right', color: '#475569' }}>SOH</th>
                                                <th style={{ padding: '10px 15px', textAlign: 'right', color: '#475569' }}>AVAIL</th>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {compInv.rows.map((item, idx) => (
                                                <tr key={idx} style={{ borderTop: '1px solid #e2e8f0', background: 'white' }}>
                                                <td style={{ padding: '10px 15px', fontFamily: 'monospace', color: '#1e293b' }}>{item.Batch} {item.ExpiryStr}</td>
                                                <td style={{ padding: '10px 15px', textAlign: 'right', color: '#334155' }}>{item.SOH}</td>
                                                <td style={{ padding: '10px 15px', textAlign: 'right', fontWeight: 'bold', color: item.Avail > 0 ? '#16a34a' : '#dc2626' }}>{item.Avail}</td>
                                                </tr>
                                            ))}
                                            </tbody>
                                        </table>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

// ================= 共用：4 個 3PL 系統 (Yummy / Anymall / Hello Bear / Homey) =================
const THREE_PL_CONFIGS = {
  yummy: {
    title: '🍔 Yummy 3PL 系統',
    subtitle: '上傳 HKTVmall Yummy Delivery Note 進行解析與列印',
    endpoint: '/api/yummy/upload',
    accent: '#3b82f6',
    uploader: { title: '⚙️ 3PL 主資料庫' },
    useFontCss: false,
    showDate: true,
    showLabelType: false,
    highlight: 'none',
    emptyStatus: 'empty',
    emptyText: () => '無資料',
    emptyBadgeStyle: { display: 'inline-block', padding: '6px 12px', background: '#fef2f2', color: '#dc2626', borderRadius: '6px', fontWeight: 'bold', fontSize: '13px', border: '1px solid #fecaca' },
    printBtnStyle: { background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', padding: '6px 16px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' },
    actionHeader: '操作',
  },
  anymall: {
    title: '🛍️ Anymall 3PL 系統',
    subtitle: '上傳 Anymall Delivery Note (PDF) 進行極速解析',
    endpoint: '/api/anymall/upload',
    accent: '#10b981',
    uploader: null,
    useFontCss: false,
    showDate: false,
    showLabelType: false,
    highlight: 'none',
    emptyStatus: 'no_print',
    emptyText: () => '無需打印',
    emptyBadgeStyle: { display: 'inline-block', padding: '6px 12px', background: '#f8fafc', color: '#94a3b8', borderRadius: '6px', fontWeight: 'bold', fontSize: '13px', whiteSpace: 'nowrap', border: '1px solid #e2e8f0' },
    printBtnStyle: { background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0', padding: '6px 16px', borderRadius: '6px', whiteSpace: 'nowrap', fontWeight: 'bold', fontSize: '13px', cursor: 'pointer' },
    actionHeader: '操作狀態',
  },
  hellobear: {
    title: '🐻 Hello Bear 3PL 系統',
    subtitle: '上傳 Hello Bear Delivery Note (PDF) 進行極速解析',
    endpoint: '/api/hellobear/upload',
    accent: '#8b5cf6',
    uploader: { title: '⚙️ 3PL & 標籤主資料庫' },
    useFontCss: true,  // 🌟 Repack label 商品名要 embed 思源宋體先 render 到中文
    showDate: false,
    showLabelType: false,
    highlight: 'hellobear',
    emptyStatus: 'no_print',
    emptyText: () => '無需打印',
    emptyBadgeStyle: { display: 'inline-block', padding: '6px 12px', background: '#f8fafc', color: '#94a3b8', borderRadius: '6px', fontWeight: 'bold', fontSize: '13px', border: '1px solid #e2e8f0' },
    printBtnStyle: { background: '#ccfbf1', color: '#0f766e', border: '1px solid #99f6e4', padding: '6px 16px', whiteSpace: 'nowrap', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' },
    actionHeader: '操作狀態',
  },
  homey: {
    title: '🏠 Homey 3PL 系統',
    subtitle: '上傳 Homey Delivery Note (PDF) 進行極速解析 (支援蟲蟲、食品、Repack 標籤)',
    endpoint: '/api/homey/upload',
    accent: '#14b8a6',
    uploader: { title: '⚙️ 3PL & 標籤主資料庫' },
    useFontCss: true,
    showDate: false,
    showLabelType: true,
    highlight: 'homey',
    emptyStatus: 'no_print',
    emptyText: (item) => item.label_type,
    emptyBadgeStyle: { display: 'inline-block', padding: '6px 12px', background: '#f8fafc', color: '#94a3b8', borderRadius: '6px', fontWeight: 'bold', fontSize: '13px', border: '1px solid #e2e8f0' },
    printBtnStyle: { background: '#ccfbf1', color: '#0f766e', border: '1px solid #99f6e4', padding: '6px 16px', whiteSpace: 'nowrap', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' },
    actionHeader: '操作狀態',
  },
};

// 🌟 每個 zone 各自一份 cache (key = endpoint),令切走再返時保留之前嘅解析結果
const ZONE_RESULT_CACHE = {};

function ThreePLPage({ config }) {
  const isMobile = useIsMobile();
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resultData, setResultData] = useState(() => ZONE_RESULT_CACHE[config.endpoint] || null);

  // 每次 resultData 變動,寫返入該 zone 嘅 cache
  // ⚠️ 故意 strip 走 font_css(嵌入式 base64 字體可以 ~19MB+,累積會搞到 browser OOM)
  useEffect(() => {
    if (resultData) {
      const { font_css: _ignore, ...slim } = resultData;
      ZONE_RESULT_CACHE[config.endpoint] = slim;
    } else {
      ZONE_RESULT_CACHE[config.endpoint] = null;
    }
  }, [config.endpoint, resultData]);

  const handleProcess = async () => {
    if (!file) { setError('請先選擇 PDF 檔案！'); return; }
    setLoading(true); setError(''); setResultData(null);
    const formData = new FormData(); formData.append('file', file);
    try {
      const response = await fetch(`${API_BASE_URL}${config.endpoint}`, { method: 'POST', body: formData });
      if (!response.ok) { const errData = await response.json(); throw new Error(errData.detail || '上傳或解析失敗'); }
      const data = await response.json(); setResultData(data);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const handleDownloadPDF = () => {
    if (resultData && resultData.download_url) { window.open(`${API_BASE_URL}${resultData.download_url}`, '_blank'); }
  };

  const handlePrint = async (htmlContent) => {
    if (!htmlContent) return;
    // 🌟 font_css 由全域 cache 取(/api/master/font-css fetch 一次共用),
    // 唔再依賴 resultData.font_css(已唔再喺 upload response 度返)
    const cssNeeded = htmlContent.includes('/* FONT_CSS_PLACEHOLDER */');
    const fontCss = cssNeeded ? await fetchFontCss() : '';
    const finalHtml = cssNeeded
      ? htmlContent.replace('/* FONT_CSS_PLACEHOLDER */', fontCss || '')
      : htmlContent;

    // 🎨 用隱藏 iframe 嚟打印(類似別人公司做法),print dialog 顯示嘅 URL 會係本頁,
    // 而唔係 about:blank tab。
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);

    let printed = false; // 🛡️ 防止 onload + setTimeout 兩次觸發 print()
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 500);
    };

    const doPrint = async () => {
      if (printed) return;
      printed = true;
      try {
        // 🌟 等 iframe 入面嘅 font 真正 download 完,先 trigger print。
        // 唔等嘅話 14MB syst.ttf 喺 Render 上要 ~10s 下載,print dialog
        // 會等到 timeout 然後被 cleanup 砍走,用戶見唔到任何 dialog。
        const winDoc = iframe.contentWindow?.document;
        if (winDoc?.fonts?.ready) {
          try { await winDoc.fonts.ready; } catch (e) {}
        }
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (e) { console.error(e); }
      // 打印對話框關閉(印完或取消)後清走 iframe
      if (iframe.contentWindow) {
        iframe.contentWindow.onafterprint = cleanup;
      }
      // safety:30 秒安全網(夠時間 download font + 用戶睇 dialog)
      setTimeout(cleanup, 30000);
    };

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(finalHtml);
    doc.close();

    if (cssNeeded) {
      // 有 embedded font,doPrint 自己會 await fonts.ready,立即觸發即可
      doPrint();
    } else {
      // 等 iframe load 完即時 print,有 printed flag 保護唔會 double-fire
      iframe.onload = doPrint;
      setTimeout(doPrint, 300); // safety fallback,如果 onload 因故唔觸發
    }
  };

  return (
    <div className="page-content">
      <div className="page-header"><h2>{config.title}</h2><p>{config.subtitle}</p></div>
      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', marginBottom: '25px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1', minWidth: '300px', background: 'white', padding: '24px', borderRadius: '18px', border: '1px solid #eef2f6', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--c-text-muted)', marginBottom: '12px', letterSpacing: '0.3px' }}>📄 上傳 Delivery Note</div>
          <input type="file" accept=".pdf" onChange={(e) => setFile(e.target.files[0])} style={{ width: '100%', marginBottom: '16px', fontSize: '14px' }} /><br />
          <button onClick={handleProcess} disabled={loading} style={{ background: loading ? '#94a3b8' : config.accent, color: 'white', padding: '12px 24px', borderRadius: '10px', border: 'none', fontWeight: '700', cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? '⏳ 解析中...' : '📄 開始解析 PDF'}
          </button>
          {error && <p style={{ color: '#dc2626', marginTop: '12px', fontWeight: 'bold', background: '#fef2f2', padding: '10px 12px', borderRadius: '8px' }}>❌ {error}</p>}
        </div>
        {/* 🔒 手機隱藏防止員工誤撳上傳資料庫 */}
        {!isMobile && config.uploader && (
          <DatabaseUploader title={config.uploader.title} infoUrl={`${API_BASE_URL}/api/master/info`} uploadUrl={`${API_BASE_URL}/api/master/upload`} />
        )}
      </div>
      {resultData && (
        <>
          <div style={{ display: 'flex', gap: '20px', marginBottom: '25px' }}>
            <div style={{ flex: '1', background: 'white', padding: '22px', borderRadius: '18px', border: '1px solid #eef2f6', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}>
               <h3 style={{ marginBottom: '14px', color: 'var(--c-text)', fontSize: '17px', fontWeight: '700' }}>📊 處理摘要</h3>
               <p style={{ fontSize: '14.5px', color: 'var(--c-text-soft)', marginBottom: '14px' }}>有效解析筆數:<strong style={{ color: 'var(--c-text)', fontSize: '18px', marginLeft: '4px' }}>{resultData.summary.total_pages}</strong></p>
               <button onClick={handleDownloadPDF} style={{ background: '#f1f5f9', color: '#334155', padding: '11px 16px', borderRadius: '10px', border: '1px solid var(--c-border)', fontWeight: '700', cursor: 'pointer', width: '100%' }}>📥 下載清洗後的 PDF</button>
            </div>
            <div style={{ flex: '2', background: 'white', padding: '22px', borderRadius: '18px', border: '1px solid #eef2f6', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}>
               <h3 style={{ marginBottom: '14px', color: 'var(--c-text)', fontSize: '17px', fontWeight: '700' }}>⚠️ 重複訂單檢測</h3>
               {resultData.summary.has_duplicates ? (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px' }}><p style={{ color: '#b91c1c', fontWeight: 'bold', marginBottom: '10px' }}>發現 {resultData.duplicates.length} 筆重複資料！</p><table style={{ width: '100%', fontSize: '13px', textAlign: 'left', borderCollapse: 'collapse' }}><thead><tr style={{ borderBottom: '1px solid #fca5a5' }}><th style={{ padding: '5px' }}>商品編號</th><th style={{ padding: '5px' }}>重複次數</th><th style={{ padding: '5px' }}>出現頁數</th></tr></thead><tbody>{resultData.duplicates.map((d, idx) => (<tr key={idx}><td style={{ padding: '5px', fontWeight: 'bold' }}>{d.Product_No}</td><td style={{ padding: '5px' }}>{d.Count}</td><td style={{ padding: '5px' }}>{d.Pages}</td></tr>))}</tbody></table></div>
               ) : ( <p style={{ color: '#15803d', fontWeight: 'bold', background: '#f0fdf4', padding: '10px', borderRadius: '8px' }}>✅ 未發現重複訂單</p> )}
            </div>
          </div>
          <div style={{ background: 'white', padding: '24px', borderRadius: '18px', border: '1px solid #eef2f6', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}>
            <h3 style={{ marginBottom: '18px', color: 'var(--c-text)', fontSize: '17px', fontWeight: '700' }}>📋 標籤生成清單</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--c-border)', color: 'var(--c-text-soft)' }}>
                    <th style={{ padding: '12px' }}>序號</th>
                    <th style={{ padding: '12px' }}>商品編號</th>
                    <th style={{ padding: '12px', minWidth: '250px' }}>商品名稱</th>
                    <th style={{ padding: '12px' }}>商品條碼</th>
                    {config.showDate && <th style={{ padding: '12px' }}>日期</th>}
                    <th style={{ padding: '12px', textAlign: 'center' }}>數量</th>
                    {config.showLabelType && <th style={{ padding: '12px', textAlign: 'center' }}>標籤類型</th>}
                    <th style={{ padding: '12px', textAlign: 'center' }}>{config.actionHeader}</th>
                  </tr>
                </thead>
                <tbody>
                  {resultData.items.map((item, idx) => {
                    const isDup = resultData.duplicates.some(d => d.Product_No === item.Product_No);

                    const hbHighlight = config.highlight === 'hellobear' &&
                      (/[a-zA-Z]/.test(item.Barcode || "") || item.Product_No === item.Barcode);
                    const homeyHighlight = config.highlight === 'homey' &&
                      ["repack", "sku", "蟲", "food"].some(k => (item.label_type || "").toLowerCase().includes(k));

                    const rowBg = isDup ? '#fffbeb' : (hbHighlight ? '#fef08a' : 'transparent');
                    const hbText = hbHighlight ? '#ea580c' : 'inherit';
                    const homeyCell = homeyHighlight ? { backgroundColor: '#FFFFAA', color: '#B30000', fontWeight: 'bold' } : {};
                    const isEmpty = item.status === config.emptyStatus;

                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', backgroundColor: rowBg, transition: 'background 0.2s' }}>
                        <td style={{ padding: '12px', color: '#94a3b8' }}>{idx + 1}</td>
                        <td style={{ padding: '12px', fontWeight: 'bold', color: hbText }}>{item.Product_No}</td>
                        <td style={{ padding: '12px', minWidth: '250px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.6', color: hbText, fontWeight: hbHighlight ? 'bold' : 'normal', ...homeyCell }}>{item.Name}</td>
                        {config.highlight === 'hellobear' ? (
                          <td style={{ padding: '12px', fontFamily: 'monospace' }}>
                            <span style={{ background: hbHighlight ? '#fde047' : '#f1f5f9', padding: '4px 8px', borderRadius: '4px', color: hbText, fontWeight: hbHighlight ? 'bold' : 'normal' }}>{item.Barcode}</span>
                          </td>
                        ) : (
                          <td style={{ padding: '4px 8px', fontFamily: 'monospace', background: '#f1f5f9', borderRadius: '4px', margin: '8px' }}>{item.Barcode}</td>
                        )}
                        {config.showDate && <td style={{ padding: '12px', color: '#64748b' }}>{item.Date}</td>}
                        <td style={{ padding: '12px', fontWeight: 'bold', fontSize: '16px', textAlign: 'center', color: hbText }}>{item.Qty}</td>
                        {config.showLabelType && (
                          <td style={{ padding: '12px', textAlign: 'center', fontWeight: 'bold', ...(homeyHighlight ? { backgroundColor: '#FFFFAA', whiteSpace: 'nowrap', color: '#B30000' } : {}) }}>{item.label_type}</td>
                        )}
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {isEmpty ? (
                            <span style={config.emptyBadgeStyle}>{config.emptyText(item)}</span>
                          ) : (
                            <button onClick={() => handlePrint(item.print_html)} style={config.printBtnStyle}>🖨️ 打印標籤</button>
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
function HomePage() {
  const [orderData, setOrderData] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false); // 🌟 新增：遠端觸發狀態
  // 🌟 自動刷新開關(記住喺 localStorage,下次仲會生效)
  const [autoRefreshOn, setAutoRefreshOn] = useState(() => {
    const saved = localStorage.getItem('hktv_auto_refresh');
    return saved === null ? true : saved === 'true';   // default: on
  });

  // 從 Render 後端抓取最新資料
  const fetchOrderData = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/hktvmall/`);
      if (res.ok) {
        const data = await res.json();
        setOrderData(data);
      }
    } catch (err) {
      console.error("無法取得訂單資料", err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOrderData();   // 第一次 mount 一定 fetch 一次
    // 只喺 autoRefreshOn=true 先開 interval
    // useEffect cleanup return 保證離開 HomePage 或 toggle 關咗 auto refresh 就 stop
    if (!autoRefreshOn) return;
    const interval = setInterval(fetchOrderData, 10000); // 10 秒 auto refresh
    return () => clearInterval(interval);
  }, [autoRefreshOn]);

  // Toggle handler:同步 state + localStorage
  const toggleAutoRefresh = () => {
    setAutoRefreshOn(prev => {
      const next = !prev;
      localStorage.setItem('hktv_auto_refresh', String(next));
      return next;
    });
  };

  // 🌟 新增：發送遠端指令給 Render 伺服器
  const handleRemoteTrigger = async () => {
    setIsTriggering(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/hktvmall/trigger`, {
        method: 'POST'
      });
      if (res.ok) {
        alert("📡 遠端指令已成功發送！\n\n只要您本地的電腦程式 (app.py) 有開著，它將在 10 秒內接收指令並開始抓取。請稍候約 1~2 分鐘，本畫面會自動更新！");
      } else {
        alert("❌ 發送指令失敗，請檢查伺服器。");
      }
    } catch (err) {
      alert("❌ 連線失敗：" + err.message);
    } finally {
      setIsTriggering(false);
    }
  };

  // 渲染訂單區塊 (今日 / 明日) 的模組化函數
  const renderOrderSection = (titlePrefix, dayKey, dayData) => {
    if (!dayData || Object.keys(dayData).length === 0) return null;

    const totalTarget = parseInt(dayData.TOTAL_TARGET || "0", 10);
    const picked = parseInt(dayData.PICKED || "0", 10);
    const pickedPct = totalTarget > 0 ? Math.min((picked / totalTarget) * 100, 100) : 0;

    return (
      <div style={{ background: '#ffffff', padding: '30px', borderRadius: '24px', border: '1px solid #e2e8f0', boxShadow: '0 10px 30px rgba(0,0,0,0.03)', marginBottom: '30px' }}>
        <h3 style={{ color: '#0f172a', borderBottom: '2px solid #f1f5f9', paddingBottom: '15px', marginBottom: '25px', fontSize: '22px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span>{titlePrefix}</span>
          <span style={{ fontSize: '16px', color: '#64748b', fontWeight: 'normal' }}>📅 {dayData.date || '--'}</span>
        </h3>
        
        {/* 四個核心數據方塊 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' }}>
          <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '16px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
            <div style={{ color: '#64748b', fontSize: '15px', fontWeight: 'bold', marginBottom: '8px' }}>📝 已建立</div>
            <div style={{ fontSize: '32px', color: '#0f172a', fontWeight: '900' }}>{dayData.CONFIRMED || '--'}</div>
          </div>
          <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '16px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
            <div style={{ color: '#64748b', fontSize: '15px', fontWeight: 'bold', marginBottom: '8px' }}>⏳ 已確認</div>
            <div style={{ fontSize: '32px', color: '#0f172a', fontWeight: '900' }}>{dayData.ACKNOWLEDGED || '--'}</div>
          </div>
          <div style={{ background: '#eff6ff', padding: '20px', borderRadius: '16px', textAlign: 'center', border: '2px solid #bfdbfe', boxShadow: '0 4px 10px rgba(59, 130, 246, 0.1)' }}>
            <div style={{ color: '#2563eb', fontSize: '15px', fontWeight: 'bold', marginBottom: '8px' }}>📦 已出貨 / 總目標</div>
            <div style={{ fontSize: '32px', color: '#1e3a8a', fontWeight: '900' }}>{picked} / {totalTarget}</div>
          </div>
        </div>

        {/* 綠色出貨進度條 */}
        <div style={{ marginBottom: '30px', background: '#f8fafc', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: 'bold', color: '#334155', marginBottom: '12px' }}>
            <span>📦 出貨進度</span>
            <span style={{ color: pickedPct === 100 ? '#10b981' : '#334155' }}>{Math.round(pickedPct)}%</span>
          </div>
          <div style={{ width: '100%', background: '#cbd5e1', borderRadius: '999px', height: '16px', overflow: 'hidden' }}>
            <div style={{ width: `${pickedPct}%`, background: '#10b981', height: '100%', transition: 'width 0.8s ease-in-out' }}></div>
          </div>
        </div>

      </div>
    );
  };

  return (
    <div className="page-content" style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: '50px' }}>
      
      {/* 標題與更新按鈕 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', flexWrap: 'wrap', gap: '15px' }}>
        <h1 style={{ fontSize: '27px', color: 'var(--c-text)', margin: 0, fontWeight: '800', letterSpacing: '-0.6px' }}>🛍️ HKTVmall 智慧訂單監控儀表板</h1>

        {/* 🌟 修改：新增了遠端觸發按鈕 */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* 🌟 Auto refresh toggle — 只影響本頁,離開自動 stop */}
          <button onClick={toggleAutoRefresh}
            title={autoRefreshOn ? '按下停止 10 秒自動刷新' : '按下開啟 10 秒自動刷新'}
            style={{ background: autoRefreshOn ? '#dcfce7' : '#f1f5f9', color: autoRefreshOn ? '#166534' : '#64748b', border: `1px solid ${autoRefreshOn ? '#86efac' : '#cbd5e1'}`, padding: '11px 16px', borderRadius: '11px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '10px', color: autoRefreshOn ? '#16a34a' : '#94a3b8' }}>●</span>
            {autoRefreshOn ? '自動刷新: 開 (10秒)' : '自動刷新: 關'}
          </button>
          <button onClick={handleRemoteTrigger} disabled={isTriggering} style={{ background: isTriggering ? '#94a3b8' : '#ea580c', color: '#ffffff', border: 'none', padding: '11px 18px', borderRadius: '11px', fontSize: '14.5px', fontWeight: '700', cursor: isTriggering ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 2px 6px rgba(234,88,12,0.22)' }}>
            {isTriggering ? '🚀 發送指令中...' : '🚀 遠端手動更新'}
          </button>
        </div>
      </div>

      {/* 判斷資料是否還沒載入 */}
      {(!orderData || !orderData.today || Object.keys(orderData.today).length === 0) ? (
        <div style={{ textAlign: 'center', padding: '80px 20px', background: '#f8fafc', borderRadius: '24px', border: '2px dashed #cbd5e1', color: '#64748b' }}>
          <div style={{ fontSize: '48px', marginBottom: '15px' }}>🤖</div>
          <h2 style={{ margin: '0 0 10px 0', color: '#0f172a' }}>等待機器人傳送資料中...</h2>
          <p style={{ fontSize: '16px', margin: 0 }}>請確認您本地電腦上的 `app.py` 爬蟲已經啟動，並成功將資料推送至伺服器。</p>
        </div>
      ) : (
        <>
          {renderOrderSection("今日訂單", "today", orderData.today)}
          {renderOrderSection("明日訂單", "tomorrow", orderData.tomorrow)}
          
          {/* 頁尾最後更新時間 */}
          <div style={{ textAlign: 'right', color: '#64748b', fontSize: '15px', marginTop: '30px', background: '#f8fafc', padding: '15px 25px', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'inline-block', float: 'right' }}>
            <p style={{ margin: '0 0 8px 0', fontWeight: 'bold', color: '#0f172a' }}>🕒 最後更新時間：{orderData.last_updated || '--'}</p>
            <p style={{ margin: 0 }}>{orderData.status_msg || ''}</p>
          </div>
          <div style={{ clear: 'both' }}></div>
        </>
      )}
    </div>
  );
}

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

// ================= 共用打印 helper(iframe + 唔再彈 about:blank) =================
// 🌟 全域 font_css cache — 由 /api/master/font-css 攞一次,所有 label print 共用
// 避免 upload response 帶 39MB 字體 base64 令 Render OOM
let _fontCssCache = null;
let _fontCssPromise = null;
async function fetchFontCss() {
  if (_fontCssCache !== null) return _fontCssCache;
  if (_fontCssPromise) return _fontCssPromise;
  _fontCssPromise = fetch(`${API_BASE_URL}/api/master/font-css`)
    .then(r => r.ok ? r.json() : { font_css: '' })
    .then(d => { _fontCssCache = d.font_css || ''; return _fontCssCache; })
    .catch(() => { _fontCssCache = ''; return ''; });
  return _fontCssPromise;
}

async function printHtmlInIframe(html, fontCss) {
  if (!html) return;
  // 如果 caller 冇傳 fontCss(新版 API),自動 fetch 共用 cache
  const css = fontCss || (html.includes('/* FONT_CSS_PLACEHOLDER */') ? await fetchFontCss() : '');
  const finalHtml = html.replace('/* FONT_CSS_PLACEHOLDER */', css || '');
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', visibility: 'hidden' });
  document.body.appendChild(iframe);
  let printed = false;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    setTimeout(() => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 500);
  };
  const doPrint = () => {
    if (printed) return;
    printed = true;
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) { console.error(e); }
    if (iframe.contentWindow) iframe.contentWindow.onafterprint = cleanup;
    setTimeout(cleanup, 5000);
  };
  const doc = iframe.contentWindow.document;
  doc.open(); doc.write(finalHtml); doc.close();
  iframe.onload = doPrint;
  setTimeout(doPrint, 300);
}

// ================= 🖨️ 標籤搜尋打印中心 =================
function LabelSearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [qtyMap, setQtyMap] = useState({});
  const [printingKey, setPrintingKey] = useState(null);
  // 🛡️ Race-condition 防護:每次搜尋遞增,只接受最新嗰次嘅 response
  const searchIdRef = useRef(0);
  // 🔫 連續 scan 支援:打印後自動清空 query + focus 返搜尋框
  const searchInputRef = useRef(null);

  const keyOf = (it) => it.Barcode || it.Product_No || it.Name;

  const handleSearch = async () => {
    if (!query.trim()) return;
    // 🚀 即時清空舊結果 + qty + error,避免「舊資料疊新資料」感覺
    setResults([]);
    setQtyMap({});
    setLoading(true);
    setError('');
    setHasSearched(true);
    const myId = ++searchIdRef.current;
    try {
      const res = await fetch(`${API_BASE_URL}/api/label_tool/search?q=${encodeURIComponent(query.trim())}`);
      if (!res.ok) throw new Error('搜尋失敗');
      const data = await res.json();
      // 若中途已有更新嘅搜尋(myId 過時),直接 ignore 呢次 response
      if (myId !== searchIdRef.current) return;
      // 🚀 只 keep master DB 入面真係有 label 資料嘅(冇 label 嘅完全唔顯示)
      const filtered = (data.results || []).filter(r => r.has_label_data);
      setResults(filtered);
      const initQty = {};
      // 用 idx 一齊做 key,避免 barcode 重複時撞 key
      filtered.forEach((r, idx) => { initQty[keyOf(r) + '__' + idx] = 1; });
      setQtyMap(initQty);
    } catch (err) {
      if (myId !== searchIdRef.current) return;
      setError(err.message); setResults([]);
    }
    finally {
      if (myId === searchIdRef.current) setLoading(false);
    }
  };

  const handleKey = (e) => { if (e.key === 'Enter') handleSearch(); };

  const handlePrint = async (item, rowKey) => {
    // rowKey 從 map 入面傳入(已含 idx,確保唯一)
    const qty = parseInt(qtyMap[rowKey] || 1, 10);
    if (!qty || qty < 1) { alert('請輸入有效數量'); return; }
    setPrintingKey(rowKey);
    try {
      const res = await fetch(`${API_BASE_URL}/api/label_tool/print`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: item.Barcode || '', product_no: item.Product_No || '', qty })
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || '打印失敗'); }
      const data = await res.json();
      await printHtmlInIframe(data.html, data.font_css);
      // 🔫 打印成功 → 清空搜尋框 + focus 返去,直接繼續 scan 下一件
      setQuery('');
      const refocus = () => searchInputRef.current?.focus();
      refocus();
      // 打印 dialog 關閉後 browser 先還返 focus 畀 page,補多兩下確保搶得返
      setTimeout(refocus, 300);
      setTimeout(refocus, 1000);
    } catch (err) { alert('❌ ' + err.message); }
    finally { setPrintingKey(null); }
  };

  const TYPE_BADGES = {
    food: { label: '🍱 Food Label', color: '#2563eb', bg: '#eff6ff' },
    health_food: { label: '💊 保健食品', color: '#7c3aed', bg: '#f5f3ff' },
    pet: { label: '🐾 Pet', color: '#c2410c', bg: '#ffedd5' },
    jelly: { label: '⚠️ Jelly 警告', color: '#b45309', bg: '#fef3c7' },
    insects: { label: '🐛 蟲蟲 Label', color: '#16a34a', bg: '#dcfce7' },
    caution: { label: '⚠️ Caution', color: '#dc2626', bg: '#fee2e2' },
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>🖨️ 標籤搜尋打印中心</h2>
        <p>搜尋產品(支援中文關鍵字)→ 一鍵自動打印標籤,Food + Jelly 會自動交替合併(同 Yummy 3PL 一樣)</p>
      </div>

      <div style={{ background: 'white', padding: '25px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <input type="text" ref={searchInputRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleKey}
            autoFocus
            placeholder="輸入中文名稱、條碼或商品編號...(例如:愛玉、果凍、4710626256410)"
            style={{ flex: '1', minWidth: '250px', padding: '14px 18px', fontSize: '16px', borderRadius: '12px', border: '2px solid #cbd5e1', outline: 'none' }} />
          <button onClick={handleSearch} disabled={loading}
            style={{ background: loading ? '#94a3b8' : '#3b82f6', color: 'white', padding: '14px 28px', borderRadius: '12px', border: 'none', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '16px' }}>
            {loading ? '⏳ 搜尋中...' : '🔍 搜尋'}
          </button>
        </div>
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#64748b' }}>
          💡 搜尋資料來自「智能查詢中心」嘅資料庫,打印時用「3PL 主資料庫」嘅 label 資料
        </div>
        {error && <p style={{ color: '#dc2626', marginTop: '12px', fontWeight: 'bold' }}>❌ {error}</p>}
        {!loading && hasSearched && results.length === 0 && !error && (
          <p style={{ color: '#d97706', marginTop: '12px', fontWeight: 'bold' }}>⚠️ 搵唔到符合嘅產品</p>
        )}
      </div>

      {results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {results.map((item, idx) => {
            const k = keyOf(item) + '__' + idx;
            const isPrinting = printingKey === k;
            const types = item.label_types || [];
            const hasFood = types.includes('food');
            const hasJelly = types.includes('jelly');
            return (
              <div key={k} style={{ background: 'white', padding: '20px', borderRadius: '14px', boxShadow: '0 2px 6px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '15px' }}>
                  <div style={{ flex: '1', minWidth: '300px' }}>
                    <div style={{ fontSize: '17px', fontWeight: '800', color: '#0f172a', marginBottom: '6px' }}>{item.Name || '(無名稱)'}</div>
                    <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', fontSize: '13px', color: '#64748b' }}>
                      <span><strong>條碼:</strong> <span style={{ fontFamily: 'monospace', color: '#10b981' }}>{item.Barcode || '-'}</span></span>
                      {item.Product_No && <span><strong>編號:</strong> <span style={{ fontFamily: 'monospace', color: '#3b82f6' }}>{item.Product_No}</span></span>}
                    </div>
                    {/* 顯示有邊啲 label(info 用,唔係掣) */}
                    <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {hasFood && hasJelly && (
                        <span style={{ background: '#ccfbf1', color: '#0f766e', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', border: '1px solid #0f766e33' }}>
                          🔁 自動 Food + Jelly 交替
                        </span>
                      )}
                      {types.filter(t => !(hasFood && hasJelly && (t === 'food' || t === 'jelly'))).map(t => {
                        const cfg = TYPE_BADGES[t] || { label: t, color: '#64748b', bg: '#f1f5f9' };
                        return (
                          <span key={t} style={{ background: cfg.bg, color: cfg.color, padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', border: `1px solid ${cfg.color}33` }}>
                            {cfg.label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: '14px', color: '#475569', fontWeight: 'bold' }}>數量:</label>
                    <input type="number" min="1" max="500" value={qtyMap[k] || 1}
                      onChange={(e) => setQtyMap({ ...qtyMap, [k]: e.target.value })}
                      style={{ width: '90px', padding: '10px', borderRadius: '8px', border: '2px solid #cbd5e1', textAlign: 'center', fontWeight: 'bold', fontSize: '15px', outline: 'none' }} />
                    <button onClick={() => handlePrint(item, k)} disabled={isPrinting}
                      style={{ background: isPrinting ? '#94a3b8' : '#10b981', color: 'white', border: 'none', padding: '12px 22px', borderRadius: '10px', fontWeight: 'bold', cursor: isPrinting ? 'not-allowed' : 'pointer', fontSize: '15px' }}>
                      {isPrinting ? '⏳ 生成中...' : '🖨️ 打印標籤'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ================= ✏️ 自助 Repack Label =================
// 📍 地點 Label 選項 — 要加新地點,喺呢度 append 就得
const REPACK_LOCATIONS = ['青衣8/F', '青衣9/F', '觀塘', '屯門', '將軍澳', '上水'];

// 100×150mm 地點 label HTML(純前端生成,唔使 backend)
function buildLocationLabelHtml(text, orientation, qty) {
  const esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rotClass = orientation === 'landscape' ? ' rot' : '';
  const single = `<div class="page"><div class="txt${rotClass}">${esc}</div></div>`;
  return `<html><head><style>
    @page { size: 100mm 150mm; margin: 0; }
    html, body { margin: 0; padding: 0; background: white; }
    .page { width: 100mm; height: 150mm; display: flex; align-items: center; justify-content: center; page-break-after: always; overflow: hidden; }
    .txt { font-family: -apple-system, 'PingFang TC', 'Microsoft JhengHei', 'Heiti TC', sans-serif; font-weight: 900; text-align: center; line-height: 1.15; font-size: 38mm; width: 94mm; word-break: break-all; }
    .txt.rot { transform: rotate(90deg); width: 144mm; }
  </style></head><body>${single.repeat(qty)}
  <script>
    document.querySelectorAll('.txt').forEach(function(el) {
      var page = el.parentElement;
      var isRot = el.classList.contains('rot');
      var maxW = (isRot ? page.clientHeight : page.clientWidth) * 0.94;
      var maxH = (isRot ? page.clientWidth : page.clientHeight) * 0.92;
      var size = 38;
      while (size > 6) {
        el.style.fontSize = size + 'mm';
        var prev = el.style.transform;
        el.style.transform = 'none';
        var r = el.getBoundingClientRect();
        el.style.transform = prev;
        if (r.width <= maxW && r.height <= maxH) break;
        size -= 1;
      }
    });
  <\/script></body></html>`;
}

function LabelRepackPage() {
  const [mode, setMode] = useState('repack'); // 'repack' | 'barcode_only' | 'location'
  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(false);
  // 📍 地點 label state
  const [locText, setLocText] = useState('');
  const [customLoc, setCustomLoc] = useState('');
  const [orientation, setOrientation] = useState('portrait'); // 'portrait' | 'landscape'

  const handlePrint = async () => {
    const nQty = parseInt(qty || 1, 10);
    if (!nQty || nQty < 1) { alert('請輸入有效數量'); return; }

    // 📍 地點 label — 純前端生成即印
    if (mode === 'location') {
      if (!locText.trim()) { alert('請揀一個地點(或自訂輸入)'); return; }
      setLoading(true);
      try {
        const html = buildLocationLabelHtml(locText.trim(), orientation, nQty);
        await printHtmlInIframe(html, '');
      } catch (err) { alert('❌ ' + err.message); }
      finally { setLoading(false); }
      return;
    }

    if (!barcode.trim()) { alert('請輸入 barcode'); return; }
    if (mode === 'repack' && !name.trim()) { alert('請輸入商品名稱(或切換到「純 Barcode」模式)'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/label_tool/repack`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barcode: barcode.trim(),
          name: name.trim(),
          qty: nQty,
          only_barcode: mode === 'barcode_only',
        })
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || '打印失敗'); }
      const data = await res.json();
      printHtmlInIframe(data.html, data.font_css);
    } catch (err) { alert('❌ ' + err.message); }
    finally { setLoading(false); }
  };

  const tabStyle = (active) => ({
    flex: 1,
    padding: '14px',
    border: 'none',
    background: active ? '#7c3aed' : '#f1f5f9',
    color: active ? 'white' : '#475569',
    fontWeight: 'bold',
    fontSize: '15px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  });

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>✏️ 自助 Repack Label</h2>
        <p>自由輸入 Barcode 即時打印,可選「條碼 + 商品名」或「只條碼」兩種格式</p>
      </div>

      <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 4px 10px rgba(0,0,0,0.05)', maxWidth: '700px', overflow: 'hidden' }}>
        {/* 模式切換 Tab */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0' }}>
          <button onClick={() => setMode('repack')} style={tabStyle(mode === 'repack')}>
            📦 條碼 + 商品名
          </button>
          <button onClick={() => setMode('barcode_only')} style={tabStyle(mode === 'barcode_only')}>
            🔢 純 Barcode
          </button>
          <button onClick={() => setMode('location')} style={tabStyle(mode === 'location')}>
            📍 地點 Label
          </button>
        </div>

        <div style={{ padding: '30px' }}>
          {mode !== 'location' && (
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#0f172a' }}>📊 Barcode(數字 / 字母)</label>
            <input type="text" value={barcode} onChange={(e) => setBarcode(e.target.value)}
              placeholder="例如 49568102370 67A"
              style={{ width: '100%', padding: '14px', borderRadius: '10px', border: '2px solid #cbd5e1', fontSize: '16px', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          )}

          {mode === 'repack' && (
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#0f172a' }}>🏷️ 商品名稱(中/英都得)</label>
              <textarea value={name} onChange={(e) => setName(e.target.value)} rows={3}
                placeholder="例如:日本 Bitatto Okuchi 清新蜂膠便攜除菌漱口水 - 檸檬味 (11ml x 5條) x2"
                style={{ width: '100%', padding: '14px', borderRadius: '10px', border: '2px solid #cbd5e1', fontSize: '15px', lineHeight: '1.5', outline: 'none', boxSizing: 'border-box', resize: 'vertical' }} />
            </div>
          )}

          {mode === 'location' && (
            <>
              {/* 地點揀擇 */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#0f172a' }}>📍 揀地點</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px' }}>
                  {REPACK_LOCATIONS.map((loc) => (
                    <button key={loc} onClick={() => { setLocText(loc); setCustomLoc(''); }}
                      style={{
                        padding: '14px 8px', borderRadius: '10px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer',
                        border: locText === loc ? '2px solid #7c3aed' : '2px solid #e2e8f0',
                        background: locText === loc ? '#7c3aed' : '#f8fafc',
                        color: locText === loc ? 'white' : '#334155',
                      }}>{loc}</button>
                  ))}
                </div>
                <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', color: '#64748b', whiteSpace: 'nowrap' }}>✏️ 自訂:</span>
                  <input type="text" value={customLoc}
                    onChange={(e) => { setCustomLoc(e.target.value); setLocText(e.target.value); }}
                    placeholder="輸入其他地點(例如:元朗)"
                    style={{ flexGrow: 1, minWidth: 0, padding: '10px 14px', borderRadius: '10px', border: `2px solid ${customLoc ? '#7c3aed' : '#e2e8f0'}`, fontSize: '15px', outline: 'none' }} />
                </div>
              </div>

              {/* 方向揀擇 */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#0f172a' }}>🔄 打印方向</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => setOrientation('portrait')}
                    style={{
                      flexGrow: 1, flexBasis: 0, minWidth: 0, padding: '12px', borderRadius: '10px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer',
                      border: orientation === 'portrait' ? '2px solid #7c3aed' : '2px solid #e2e8f0',
                      background: orientation === 'portrait' ? '#f5f3ff' : '#f8fafc',
                      color: orientation === 'portrait' ? '#7c3aed' : '#64748b',
                    }}>⬆️ 直向(字正住讀)</button>
                  <button onClick={() => setOrientation('landscape')}
                    style={{
                      flexGrow: 1, flexBasis: 0, minWidth: 0, padding: '12px', borderRadius: '10px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer',
                      border: orientation === 'landscape' ? '2px solid #7c3aed' : '2px solid #e2e8f0',
                      background: orientation === 'landscape' ? '#f5f3ff' : '#f8fafc',
                      color: orientation === 'landscape' ? '#7c3aed' : '#64748b',
                    }}>➡️ 橫向(轉 90° 讀)</button>
                </div>
              </div>

              {/* Sample 預覽 */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#0f172a' }}>👀 Sample 預覽(100mm × 150mm)</label>
                <div style={{ display: 'flex', justifyContent: 'center', padding: '16px', background: '#f1f5f9', borderRadius: '12px' }}>
                  <div style={{
                    width: '160px', height: '240px', background: 'white',
                    border: '2px dashed #94a3b8', borderRadius: '4px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                  }}>
                    {locText.trim() ? (() => {
                      // 估算 preview font:CJK 當 1 格,英數當 0.6 格
                      const units = [...locText.trim()].reduce((s, ch) => s + (/[㐀-鿿＀-￯]/.test(ch) ? 1 : 0.6), 0) || 1;
                      const mainAxisPx = orientation === 'landscape' ? 226 : 150;
                      const fs = Math.max(14, Math.min(64, mainAxisPx * 0.94 / units));
                      return (
                        <div style={{
                          fontWeight: 900, textAlign: 'center', lineHeight: 1.15,
                          fontSize: `${fs}px`, whiteSpace: 'nowrap',
                          transform: orientation === 'landscape' ? 'rotate(90deg)' : 'none',
                          fontFamily: "-apple-system, 'PingFang TC', 'Microsoft JhengHei', sans-serif",
                        }}>{locText.trim()}</div>
                      );
                    })() : (
                      <span style={{ color: '#cbd5e1', fontSize: '13px' }}>揀咗地點就見到 sample</span>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          <div style={{ marginBottom: '25px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#0f172a' }}>🔢 打印數量</label>
            <input type="number" min="1" max="500" value={qty} onChange={(e) => setQty(e.target.value)}
              style={{ width: '120px', padding: '14px', borderRadius: '10px', border: '2px solid #cbd5e1', fontSize: '16px', textAlign: 'center', fontWeight: 'bold', outline: 'none' }} />
          </div>

          <button onClick={handlePrint} disabled={loading}
            style={{ background: loading ? '#94a3b8' : '#7c3aed', color: 'white', padding: '15px 40px', borderRadius: '12px', border: 'none', fontWeight: 'bold', fontSize: '16px', cursor: loading ? 'not-allowed' : 'pointer', width: '100%' }}>
            {loading ? '⏳ 生成中...' : '🖨️ 即時打印'}
          </button>

          <div style={{ marginTop: '20px', padding: '15px', background: '#f8fafc', borderRadius: '10px', fontSize: '13px', color: '#64748b' }}>
            {mode === 'repack' ? (
              <>ℹ️ <strong>Repack label</strong>:70mm × 50mm,自動生成 Code128 條碼圖 + 條碼數字 + 商品名。</>
            ) : mode === 'barcode_only' ? (
              <>ℹ️ <strong>純 Barcode label</strong>:70mm × 50mm,大尺寸條碼圖 + 條碼數字(18pt),冇商品名,適合純標識用。</>
            ) : (
              <>ℹ️ <strong>地點 label</strong>:100mm × 150mm,超大字自動填滿。直向 = 窄邊向上正住讀;橫向 = 字轉 90°,label 打側讀。</>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ================= 📍 Bin Location(倉位)管理 — 批次入倉(location-first) =================
// 🌟 兩種位置類型嘅顯示設定
const LOC_TYPES = [
  { key: '貨架', emoji: '🗄', bg: '#ecfeff', border: '#a5f3fc', color: '#0e7490' },
  { key: '板位', emoji: '🟫', bg: '#fef3c7', border: '#fde68a', color: '#92400e' },
];
const LOC_TYPE_MAP = Object.fromEntries(LOC_TYPES.map(t => [t.key, t]));

function BinLocationPage() {
  const isMobile = useIsMobile();

  // 🌟 Page mode: 'batch_add' (批次入倉) | 'move' (轉位置)
  const [mode, setMode] = useState('batch_add');

  // 位置 + 類型 + 日期(整批共用)
  const [binVal, setBinVal] = useState('');
  const [locType, setLocType] = useState('貨架');
  const [stockDate, setStockDate] = useState('');     // 預設空,用戶要主動揀
  const [locationLocked, setLocationLocked] = useState(false);   // 用戶 confirm 咗位置先 unlock scan

  // === 轉位置 (move) mode state ===
  const [moveSearch, setMoveSearch] = useState('');
  const [moveResults, setMoveResults] = useState([]);   // [{sku, barcode, name, bins:[...]}]
  const [moveSearching, setMoveSearching] = useState(false);
  const [moveWarn, setMoveWarn] = useState('');
  const [moveSource, setMoveSource] = useState(null);   // 揀咗要轉嘅 bin {id, sku, bin, loc_type, stock_date, productName}
  const [moveNewBin, setMoveNewBin] = useState('');
  const [moveNewType, setMoveNewType] = useState('貨架');
  const [moveNewDate, setMoveNewDate] = useState('');
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveLastResult, setMoveLastResult] = useState(null);

  // Scan / search input
  const [scanInput, setScanInput] = useState('');
  const [suggestions, setSuggestions] = useState([]); // 多 match 時嘅 dropdown
  const [scanBusy, setScanBusy] = useState(false);
  const [scanWarn, setScanWarn] = useState('');   // 揾唔到 / 重複等警告

  // Pending list:即將 submit 嗰一批
  const [pending, setPending] = useState([]);  // [{sku, barcode, name}]

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState(null);  // { added_count, skipped, bin, ... }

  // 呢個位置已經有嘅貨(load 自 /api/bin/by_location)
  const [existingItems, setExistingItems] = useState([]);
  const [loadingExisting, setLoadingExisting] = useState(false);

  // 🔒 刪除密碼 modal — 支援單 OR 批量
  // delModal = { ids: [...], labels: [...], isBatch }  (單 = 1 個 id)
  const [delModal, setDelModal] = useState(null);
  const [delPw, setDelPw] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState('');

  // 批量選中嘅 ids(existing items)
  const [selectedIds, setSelectedIds] = useState(new Set());

  const scanRef = useRef(null);
  const requestIdRef = useRef(0);

  // 用戶 confirm 位置(按 Enter 或者撳「✓ 確定」)→ unlock scan field + load 現有貨
  const confirmLocation = () => {
    if (!binVal.trim()) return;
    setLocationLocked(true);
    setTimeout(() => scanRef.current?.focus(), 50);
    fetchExisting();
  };

  // Fetch 呢個位置已經有嘅貨
  const fetchExisting = async () => {
    if (!binVal.trim()) return;
    setLoadingExisting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/bin/by_location?bin=${encodeURIComponent(binVal.trim())}&loc_type=${encodeURIComponent(locType)}`);
      if (!res.ok) throw new Error('攞失敗');
      const data = await res.json();
      setExistingItems(data.items || []);
    } catch (_) {
      setExistingItems([]);
    } finally {
      setLoadingExisting(false);
    }
  };

  // 🔒 撳 ✕ 刪除單件 → 開密碼 modal
  const openDeleteModal = (id, label) => {
    setDelPw(''); setDelErr('');
    setDelModal({ ids: [id], labels: [label], isBatch: false });
  };

  // 🔒 批量刪除已選中
  const openBatchDeleteModal = () => {
    if (selectedIds.size === 0) return;
    const labels = existingItems
      .filter(b => selectedIds.has(b.id))
      .map(b => `${b.name || b.sku || '(無名)'} ${b.stock_date ? '('+b.stock_date+')' : ''}`);
    setDelPw(''); setDelErr('');
    setDelModal({ ids: Array.from(selectedIds), labels, isBatch: true });
  };

  // 揀單 / 取消揀單
  const toggleSelected = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 全選 / 全消
  const toggleSelectAll = () => {
    if (selectedIds.size === existingItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(existingItems.map(b => b.id)));
    }
  };

  // === 轉位置 functions ===
  const doMoveSearch = async () => {
    const q = moveSearch.trim();
    if (!q) return;
    setMoveSearching(true);
    setMoveWarn('');
    setMoveResults([]);
    setMoveSource(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/bin/search?q=${encodeURIComponent(q)}&limit=20`);
      if (!res.ok) throw new Error('搜尋失敗');
      const data = await res.json();
      // 只 keep 有 bins 嘅 items(冇位置就冇得轉)
      const withBins = (data.results || []).filter(r => r.bins && r.bins.length > 0);
      if (withBins.length === 0) {
        setMoveWarn(`⚠️ 揾唔到「${q}」有位置嘅貨`);
      }
      setMoveResults(withBins);
    } catch (err) {
      setMoveWarn('❌ ' + err.message);
    } finally {
      setMoveSearching(false);
    }
  };

  const selectMoveSource = (item, bin) => {
    setMoveSource({
      id: bin.id,
      sku: item.sku,
      productName: item.name,
      bin: bin.bin,
      loc_type: bin.loc_type || '貨架',
      stock_date: bin.stock_date || '',
    });
    // 預填新類型 = 舊類型
    setMoveNewType(bin.loc_type || '貨架');
    setMoveNewBin('');
    setMoveNewDate(bin.stock_date || '');
    setMoveLastResult(null);
  };

  const confirmMove = async () => {
    if (!moveSource) return;
    if (!moveNewBin.trim()) { alert('請輸入新位置'); return; }
    if (moveNewBin.trim() === moveSource.bin && moveNewType === moveSource.loc_type && (moveNewDate || '') === (moveSource.stock_date || '')) {
      alert('新位置同舊位置一樣,唔需要轉');
      return;
    }
    setMoveBusy(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/bin/move`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: moveSource.id,
          new_bin: moveNewBin.trim(),
          new_loc_type: moveNewType,
          new_stock_date: moveNewDate,
        }),
      });
      if (!res.ok) {
        const er = await res.json().catch(() => ({}));
        throw new Error(er.detail || '轉位置失敗');
      }
      const data = await res.json();
      setMoveLastResult({ ok: true, message: data.message, from: `${moveSource.loc_type} ${moveSource.bin}`, to: `${moveNewType} ${moveNewBin.trim()}` });
      // 即時 refresh search results 等 user 見到更新
      setMoveSource(null);
      setMoveNewBin('');
      if (moveSearch.trim()) await doMoveSearch();
    } catch (err) {
      setMoveLastResult({ ok: false, message: err.message });
    } finally {
      setMoveBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!delModal || !delModal.ids || delModal.ids.length === 0) return;
    if (!delPw.trim()) { setDelErr('請輸入密碼'); return; }
    setDelBusy(true); setDelErr('');
    try {
      // 永遠用 batch_remove(無論 1 個定 N 個都 work,code 統一)
      const res = await fetch(`${API_BASE_URL}/api/bin/batch_remove`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: delModal.ids, password: delPw }),
      });
      if (!res.ok) { const er = await res.json().catch(() => ({})); throw new Error(er.detail || '刪除失敗'); }
      setDelModal(null); setDelPw('');
      setSelectedIds(new Set());   // 清空選擇
      await fetchExisting();
    } catch (err) {
      setDelErr(err.message);
    } finally {
      setDelBusy(false);
    }
  };

  // 加入一個 item 到 pending list
  const addToPending = (item) => {
    // 檢查 pending list 內部 dup(SKU 已經喺度)
    if (pending.some(p => p.sku === item.sku)) {
      setScanWarn(`⚠️ ${item.name} 已經喺 list 入面`);
      setScanInput('');
      scanRef.current?.focus();
      return;
    }
    setPending(prev => [...prev, item]);
    setScanInput('');
    setSuggestions([]);
    setScanWarn('');
    scanRef.current?.focus();
  };

  // 用 search API 揾 product
  const lookupAndAdd = async () => {
    const q = scanInput.trim();
    if (!q) return;
    if (!binVal.trim()) {
      setScanWarn('⚠️ 請先入位置');
      return;
    }
    setScanBusy(true);
    setScanWarn('');
    const myId = ++requestIdRef.current;
    try {
      const res = await fetch(`${API_BASE_URL}/api/bin/search?q=${encodeURIComponent(q)}&limit=20`);
      if (!res.ok) {
        const er = await res.json().catch(() => ({}));
        throw new Error(er.detail || '搜尋失敗');
      }
      const data = await res.json();
      if (myId !== requestIdRef.current) return;
      const results = data.results || [];
      if (results.length === 0) {
        setScanWarn(`⚠️ 揾唔到「${q}」嘅貨,請確認 barcode/SKU 啱唔啱`);
        setSuggestions([]);
      } else if (results.length === 1) {
        // 1 個 match → 即刻加入
        const r = results[0];
        addToPending({ sku: r.sku, barcode: r.barcode, name: r.name });
      } else {
        // 多 match → 彈 dropdown
        setSuggestions(results);
      }
    } catch (err) {
      if (myId === requestIdRef.current) setScanWarn('❌ ' + err.message);
    } finally {
      if (myId === requestIdRef.current) setScanBusy(false);
    }
  };

  const removePending = (sku) => {
    setPending(prev => prev.filter(p => p.sku !== sku));
  };

  const clearPending = () => {
    if (!pending.length) return;
    if (!confirm(`確認清走全部 ${pending.length} 件待加入嘅貨?`)) return;
    setPending([]);
  };

  const submitBatch = async () => {
    if (!binVal.trim()) { alert('請先入位置'); return; }
    if (!pending.length) { alert('未加任何貨'); return; }
    setSubmitting(true);
    setLastResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/bin/batch_add`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bin: binVal.trim(),
          loc_type: locType,
          stock_date: stockDate,
          items: pending,
        }),
      });
      if (!res.ok) {
        const er = await res.json().catch(() => ({}));
        throw new Error(er.detail || 'Submit 失敗');
      }
      const data = await res.json();
      setLastResult(data);
      setPending([]);  // 清空 list
      // 保留 location/type/date,等用戶繼續加同一個位置
      await fetchExisting();   // refresh 已有貨 list,user 即刻見到啱啱加嗰啲
      setTimeout(() => scanRef.current?.focus(), 100);
    } catch (err) {
      alert('❌ ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const resetLocation = () => {
    if (pending.length && !confirm(`你仲有 ${pending.length} 件貨未 submit,確認換位置?`)) return;
    setBinVal('');
    setLocationLocked(false);
    setPending([]);
    setLastResult(null);
    setScanWarn('');
    setSuggestions([]);
    setExistingItems([]);
  };

  const locCfg = LOC_TYPE_MAP[locType] || LOC_TYPE_MAP['貨架'];

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>📍 Bin Location 倉位管理</h2>
        <p>{mode === 'batch_add' ? '先入位置,再 scan/輸入多件貨,一次過確認入晒。Scan barcode 自動加入 list,有重複會 skip。' : '搵要轉嘅貨 → 揀原本位置 → 入新位置 → 確認'}</p>
      </div>

      {/* ========== Mode toggle ========== */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', background: '#f1f5f9', padding: '5px', borderRadius: '14px', maxWidth: '420px' }}>
        {[
          { key: 'batch_add', label: '📦 批次入倉', color: '#0ea5e9' },
          { key: 'move', label: '🔁 轉位置', color: '#7c3aed' },
        ].map((m) => (
          <button key={m.key} onClick={() => setMode(m.key)}
            style={{ flex: 1, background: mode === m.key ? m.color : 'transparent', color: mode === m.key ? 'white' : '#475569', border: 'none', padding: '11px 16px', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '14px', transition: 'all 0.15s' }}>
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'batch_add' && (<>
      {/* ========== 1. 位置設定 ========== */}
      <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 4px 14px rgba(0,0,0,0.06)', padding: '20px 22px', border: '1px solid #f1f5f9', marginBottom: '14px', maxWidth: '900px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold', letterSpacing: '0.5px' }}>📍 第一步:設定位置 {locationLocked && '✓'}</span>
          {locationLocked && (
            <button onClick={resetLocation} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>🔄 換位置</button>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '10px', alignItems: isMobile ? 'stretch' : 'center' }}>
          {/* 類型 toggle */}
          <div style={{ display: 'flex', gap: '3px', background: '#f8fafc', padding: '4px', borderRadius: '10px', border: '1px solid #e2e8f0', opacity: locationLocked ? 0.6 : 1, pointerEvents: locationLocked ? 'none' : 'auto' }}>
            {LOC_TYPES.map((t) => {
              const active = locType === t.key;
              return (
                <button key={t.key} onClick={() => setLocType(t.key)}
                  style={{ flex: isMobile ? 1 : 'none', background: active ? t.color : 'transparent', color: active ? 'white' : '#64748b', border: 'none', padding: '11px 16px', borderRadius: '7px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px', transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
                  {t.emoji} {t.key}
                </button>
              );
            })}
          </div>
          <input type="text" value={binVal} autoFocus disabled={locationLocked}
            onChange={(e) => setBinVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && binVal.trim()) { e.preventDefault(); confirmLocation(); } }}
            placeholder={locType === '貨架' ? '位置 A-03-12' : '板位 P-05'}
            style={{ flex: isMobile ? 'none' : '1', minWidth: '160px', padding: '13px 16px', borderRadius: '10px', border: `2px solid ${binVal.trim() ? locCfg.color : '#cbd5e1'}`, fontSize: '17px', fontFamily: 'monospace', fontWeight: 'bold', outline: 'none', boxSizing: 'border-box', color: locCfg.color, background: locationLocked ? '#f8fafc' : 'white' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: locationLocked ? 0.6 : 1, pointerEvents: locationLocked ? 'none' : 'auto' }}>
            {isMobile && <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 'bold', whiteSpace: 'nowrap' }}>📅</span>}
            <input type="date" value={stockDate}
              onChange={(e) => setStockDate(e.target.value)}
              title="批次日期(可留空)"
              style={{ flex: isMobile ? 1 : 'none', padding: '12px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', background: 'white', fontSize: '14px', fontFamily: 'monospace', outline: 'none', minHeight: '46px', boxSizing: 'border-box', color: stockDate ? '#0f172a' : '#94a3b8' }} />
            {stockDate && !locationLocked && (
              <button onClick={() => setStockDate('')} title="清走日期"
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '16px', padding: '4px 6px' }}>✕</button>
            )}
          </div>
          {!locationLocked && (
            <button onClick={confirmLocation} disabled={!binVal.trim()}
              style={{ background: binVal.trim() ? locCfg.color : '#cbd5e1', color: 'white', border: 'none', padding: '13px 22px', borderRadius: '10px', fontWeight: 'bold', cursor: binVal.trim() ? 'pointer' : 'not-allowed', fontSize: '15px', whiteSpace: 'nowrap' }}>
              ✓ 確定
            </button>
          )}
        </div>
      </div>

      {/* ========== 2. Scan / 輸入貨 ========== */}
      {locationLocked && (
        <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 4px 14px rgba(0,0,0,0.06)', padding: '20px 22px', border: '1px solid #f1f5f9', marginBottom: '14px', maxWidth: '900px' }}>
          <div style={{ marginBottom: '12px', fontSize: '12px', color: '#64748b', fontWeight: 'bold', letterSpacing: '0.5px' }}>🔍 第二步:Scan / 輸入貨(Enter 確認)</div>
          <div style={{ display: 'flex', gap: '8px', position: 'relative' }}>
            <input type="text" ref={scanRef} value={scanInput}
              onChange={(e) => { setScanInput(e.target.value); setScanWarn(''); setSuggestions([]); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !scanBusy) { e.preventDefault(); lookupAndAdd(); } }}
              placeholder="Scan barcode 或輸入 SKU / 商品名關鍵字"
              disabled={scanBusy}
              style={{ flex: 1, padding: '14px 18px', fontSize: '16px', borderRadius: '12px', border: '2px solid #cbd5e1', outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace' }} />
            <button onClick={lookupAndAdd} disabled={scanBusy || !scanInput.trim()}
              style={{ background: scanBusy ? '#94a3b8' : '#0ea5e9', color: 'white', border: 'none', padding: '14px 22px', borderRadius: '12px', fontWeight: 'bold', cursor: scanBusy ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
              {scanBusy ? '⏳' : '加入'}
            </button>
          </div>

          {/* Dropdown 多 match 時 */}
          {suggestions.length > 0 && (
            <div style={{ marginTop: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '8px', maxHeight: '300px', overflowY: 'auto' }}>
              <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold', padding: '6px 10px' }}>👇 揀一個加入:</div>
              {suggestions.map((s) => (
                <button key={s.sku || s.barcode} onClick={() => addToPending({ sku: s.sku, barcode: s.barcode, name: s.name })}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'white', border: '1px solid #eef2f6', borderRadius: '8px', padding: '10px 12px', marginBottom: '4px', cursor: 'pointer', fontSize: '14px' }}>
                  <div style={{ fontWeight: 'bold', color: '#0f172a', marginBottom: '4px' }}>{s.name}</div>
                  <div style={{ display: 'flex', gap: '8px', fontSize: '12px' }}>
                    <span style={{ background: '#eff6ff', color: '#1e40af', padding: '2px 8px', borderRadius: '5px', fontFamily: 'monospace' }}>{s.sku || '—'}</span>
                    <span style={{ background: '#ecfdf5', color: '#065f46', padding: '2px 8px', borderRadius: '5px', fontFamily: 'monospace' }}>{s.barcode || '—'}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {scanWarn && (
            <div style={{ marginTop: '10px', background: '#fef3c7', border: '1px solid #fde68a', color: '#92400e', padding: '10px 14px', borderRadius: '10px', fontSize: '14px', fontWeight: 'bold' }}>
              {scanWarn}
            </div>
          )}
        </div>
      )}

      {/* ========== 2.5 呢個位置已經有嘅貨(可刪 / 批量刪) ========== */}
      {locationLocked && (
        <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 4px 14px rgba(0,0,0,0.06)', padding: '20px 22px', border: '1px solid #f1f5f9', marginBottom: '14px', maxWidth: '900px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold', letterSpacing: '0.5px' }}>
              📂 {locCfg.emoji} {binVal} 已經有 ({existingItems.length} 件){loadingExisting && ' ⏳'}
              {selectedIds.size > 0 && <span style={{ marginLeft: '8px', color: '#dc2626' }}>• 已選 {selectedIds.size}</span>}
            </span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {selectedIds.size > 0 && (
                <button onClick={openBatchDeleteModal}
                  style={{ background: '#dc2626', color: 'white', border: 'none', padding: '7px 14px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}>
                  🗑 刪除選中 {selectedIds.size} 件
                </button>
              )}
              <button onClick={fetchExisting} disabled={loadingExisting}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>🔄 refresh</button>
            </div>
          </div>
          {existingItems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#cbd5e1', fontSize: '14px', fontStyle: 'italic' }}>{loadingExisting ? '載入中...' : '呢個位置仲未有貨'}</div>
          ) : (
            <>
              {/* 全選 row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 14px', marginBottom: '6px', background: '#f1f5f9', borderRadius: '8px', fontSize: '12px', color: '#475569', fontWeight: 'bold' }}>
                <input type="checkbox"
                  checked={selectedIds.size > 0 && selectedIds.size === existingItems.length}
                  ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < existingItems.length; }}
                  onChange={toggleSelectAll}
                  style={{ width: '18px', height: '18px', cursor: 'pointer', flexShrink: 0 }} />
                <span>{selectedIds.size === existingItems.length ? '全部已選' : (selectedIds.size > 0 ? `已選 ${selectedIds.size} / ${existingItems.length}` : '全選')}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {existingItems.map((b, i) => {
                const isSelected = selectedIds.has(b.id);
                return (
                  <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: isSelected ? '#fef2f2' : '#f8fafc', border: `1px solid ${isSelected ? '#fecaca' : '#eef2f6'}`, borderRadius: '10px', padding: '10px 14px' }}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelected(b.id)}
                      style={{ width: '18px', height: '18px', cursor: 'pointer', flexShrink: 0 }} />
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '22px', height: '22px', borderRadius: '50%', background: '#cbd5e1', color: 'white', fontSize: '11px', fontWeight: '800', flexShrink: 0 }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 'bold', color: '#0f172a', fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name || '(無名)'}</div>
                      <div style={{ display: 'flex', gap: '6px', marginTop: '3px', fontSize: '11px', flexWrap: 'wrap' }}>
                        <span style={{ background: '#eff6ff', color: '#1e40af', padding: '1px 6px', borderRadius: '4px', fontFamily: 'monospace' }}>{b.sku || '—'}</span>
                        {b.barcode && <span style={{ background: '#ecfdf5', color: '#065f46', padding: '1px 6px', borderRadius: '4px', fontFamily: 'monospace' }}>{b.barcode}</span>}
                        {b.stock_date && <span style={{ background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: '4px', fontFamily: 'monospace' }}>📅 {b.stock_date}</span>}
                      </div>
                    </div>
                    <button onClick={() => openDeleteModal(b.id, `${b.name || b.sku} ${b.stock_date ? '('+b.stock_date+')' : ''}`)} title="刪除呢一件(要 Full Time 密碼)"
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', background: 'white', border: '1px solid #fecaca', color: '#ef4444', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', borderRadius: '7px', flexShrink: 0 }}>✕</button>
                  </div>
                );
              })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ========== 3. Pending list ========== */}
      {locationLocked && (
        <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 4px 14px rgba(0,0,0,0.06)', padding: '20px 22px', border: '1px solid #f1f5f9', marginBottom: '14px', maxWidth: '900px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold', letterSpacing: '0.5px' }}>📦 待加入 ({pending.length} 件)</span>
            {pending.length > 0 && (
              <button onClick={clearPending} style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>清空</button>
            )}
          </div>
          {pending.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#cbd5e1', fontSize: '14px', fontStyle: 'italic' }}>仲未掃任何貨</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {pending.map((p, i) => (
                <div key={p.sku} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#f8fafc', border: '1px solid #eef2f6', borderRadius: '10px', padding: '10px 14px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', borderRadius: '50%', background: locCfg.color, color: 'white', fontSize: '12px', fontWeight: '800', flexShrink: 0 }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 'bold', color: '#0f172a', fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '3px', fontSize: '11px' }}>
                      <span style={{ background: '#eff6ff', color: '#1e40af', padding: '1px 6px', borderRadius: '4px', fontFamily: 'monospace' }}>{p.sku || '—'}</span>
                      <span style={{ background: '#ecfdf5', color: '#065f46', padding: '1px 6px', borderRadius: '4px', fontFamily: 'monospace' }}>{p.barcode || '—'}</span>
                    </div>
                  </div>
                  <button onClick={() => removePending(p.sku)} title="移走"
                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', background: 'white', border: '1px solid #fecaca', color: '#ef4444', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', borderRadius: '7px', flexShrink: 0 }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========== 4. Submit ========== */}
      {locationLocked && pending.length > 0 && (
        <div style={{ maxWidth: '900px', marginBottom: '14px' }}>
          <button onClick={submitBatch} disabled={submitting}
            style={{ width: '100%', background: submitting ? '#94a3b8' : locCfg.color, color: 'white', border: 'none', padding: '16px', borderRadius: '14px', fontWeight: '800', fontSize: '17px', cursor: submitting ? 'wait' : 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
            {submitting ? '⏳ Submitting...' : `✅ 確認加 ${pending.length} 件入 ${locCfg.emoji} ${binVal}`}
          </button>
        </div>
      )}

      {/* ========== Last submit summary ========== */}
      {lastResult && (
        <div style={{ background: '#ecfdf5', border: '1px solid #d1fae5', borderRadius: '14px', padding: '14px 18px', maxWidth: '900px', marginBottom: '14px' }}>
          <div style={{ fontWeight: 'bold', color: '#065f46', marginBottom: '6px' }}>✅ {lastResult.message}</div>
          {lastResult.skipped && lastResult.skipped.length > 0 && (
            <div style={{ marginTop: '8px', fontSize: '13px', color: '#92400e' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>⚠️ 跳過 ({lastResult.skipped.length}):</div>
              {lastResult.skipped.map((s, i) => (
                <div key={i} style={{ paddingLeft: '12px', fontFamily: 'monospace' }}>• {s.sku} {s.name && `(${s.name})`} — {s.reason}</div>
              ))}
            </div>
          )}
        </div>
      )}
      </>)}

      {/* ============================================================ */}
      {/* ========== 🔁 轉位置 mode ========== */}
      {/* ============================================================ */}
      {mode === 'move' && (<>
        {/* Step 1: Search */}
        <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 4px 14px rgba(0,0,0,0.06)', padding: '20px 22px', border: '1px solid #f1f5f9', marginBottom: '14px', maxWidth: '900px' }}>
          <div style={{ marginBottom: '12px', fontSize: '12px', color: '#64748b', fontWeight: 'bold', letterSpacing: '0.5px' }}>🔍 第一步:搵要轉嘅貨</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input type="text" value={moveSearch}
              onChange={(e) => { setMoveSearch(e.target.value); setMoveWarn(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !moveSearching) { e.preventDefault(); doMoveSearch(); } }}
              placeholder="Scan barcode 或輸入 SKU / 商品名關鍵字"
              disabled={moveSearching}
              autoFocus
              style={{ flex: 1, padding: '14px 18px', fontSize: '16px', borderRadius: '12px', border: '2px solid #cbd5e1', outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace' }} />
            <button onClick={doMoveSearch} disabled={moveSearching || !moveSearch.trim()}
              style={{ background: moveSearching ? '#94a3b8' : '#7c3aed', color: 'white', border: 'none', padding: '14px 22px', borderRadius: '12px', fontWeight: 'bold', cursor: moveSearching ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
              {moveSearching ? '⏳' : '🔍 搜尋'}
            </button>
          </div>
          {moveWarn && (
            <div style={{ marginTop: '10px', background: '#fef3c7', border: '1px solid #fde68a', color: '#92400e', padding: '10px 14px', borderRadius: '10px', fontSize: '14px', fontWeight: 'bold' }}>
              {moveWarn}
            </div>
          )}
        </div>

        {/* Step 2: 揀要轉嘅原位置 */}
        {moveResults.length > 0 && (
          <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 4px 14px rgba(0,0,0,0.06)', padding: '20px 22px', border: '1px solid #f1f5f9', marginBottom: '14px', maxWidth: '900px' }}>
            <div style={{ marginBottom: '12px', fontSize: '12px', color: '#64748b', fontWeight: 'bold', letterSpacing: '0.5px' }}>📂 第二步:揀要轉嘅原位置</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {moveResults.map((item) => (
                <div key={item.sku || item.barcode} style={{ border: '1px solid #eef2f6', borderRadius: '12px', padding: '14px' }}>
                  <div style={{ fontWeight: '800', color: '#0f172a', marginBottom: '6px' }}>{item.name}</div>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', fontSize: '12px', flexWrap: 'wrap' }}>
                    <span style={{ background: '#eff6ff', color: '#1e40af', padding: '2px 8px', borderRadius: '5px', fontFamily: 'monospace' }}>SKU {item.sku || '—'}</span>
                    {item.barcode && <span style={{ background: '#ecfdf5', color: '#065f46', padding: '2px 8px', borderRadius: '5px', fontFamily: 'monospace' }}>{item.barcode}</span>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {item.bins.map((b) => {
                      const tCfg = LOC_TYPE_MAP[b.loc_type || '貨架'] || LOC_TYPE_MAP['貨架'];
                      const selected = moveSource && moveSource.id === b.id;
                      return (
                        <button key={b.id} onClick={() => selectMoveSource(item, b)}
                          style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: '10px', background: selected ? '#ede9fe' : '#f8fafc', border: `2px solid ${selected ? '#7c3aed' : '#eef2f6'}`, borderRadius: '10px', padding: '10px 14px', cursor: 'pointer', fontSize: '14px' }}>
                          <span style={{ background: tCfg.bg, border: `1px solid ${tCfg.border}`, color: tCfg.color, padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '800' }}>{tCfg.emoji} {b.loc_type || '貨架'}</span>
                          <span style={{ color: tCfg.color, fontWeight: '800', fontFamily: 'monospace', fontSize: '15px' }}>{b.bin}</span>
                          {b.stock_date && <span style={{ color: '#92400e', fontFamily: 'monospace', fontSize: '12px' }}>📅 {b.stock_date}</span>}
                          <span style={{ marginLeft: 'auto', color: selected ? '#7c3aed' : '#94a3b8', fontWeight: 'bold', fontSize: '13px' }}>{selected ? '✓ 揀咗' : '→ 揀'}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: 入新位置 */}
        {moveSource && (
          <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 4px 14px rgba(0,0,0,0.06)', padding: '20px 22px', border: '2px solid #7c3aed', marginBottom: '14px', maxWidth: '900px' }}>
            <div style={{ marginBottom: '12px', fontSize: '12px', color: '#7c3aed', fontWeight: 'bold', letterSpacing: '0.5px' }}>🎯 第三步:入新位置</div>
            <div style={{ background: '#f8fafc', border: '1px solid #eef2f6', borderRadius: '10px', padding: '10px 14px', marginBottom: '14px', fontSize: '14px' }}>
              <div style={{ fontWeight: 'bold', color: '#0f172a', marginBottom: '4px' }}>{moveSource.productName}</div>
              <div style={{ color: '#64748b', fontSize: '13px' }}>
                原本喺:<span style={{ marginLeft: '6px', fontFamily: 'monospace', color: (LOC_TYPE_MAP[moveSource.loc_type] || LOC_TYPE_MAP['貨架']).color, fontWeight: '800' }}>
                  {(LOC_TYPE_MAP[moveSource.loc_type] || LOC_TYPE_MAP['貨架']).emoji} {moveSource.bin}
                </span>
                {moveSource.stock_date && <span style={{ marginLeft: '8px', color: '#92400e', fontFamily: 'monospace', fontSize: '12px' }}>📅 {moveSource.stock_date}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '10px', alignItems: isMobile ? 'stretch' : 'center', marginBottom: '14px' }}>
              <div style={{ display: 'flex', gap: '3px', background: '#f8fafc', padding: '4px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                {LOC_TYPES.map((t) => {
                  const active = moveNewType === t.key;
                  return (
                    <button key={t.key} onClick={() => setMoveNewType(t.key)}
                      style={{ flex: isMobile ? 1 : 'none', background: active ? t.color : 'transparent', color: active ? 'white' : '#64748b', border: 'none', padding: '11px 16px', borderRadius: '7px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px', whiteSpace: 'nowrap' }}>
                      {t.emoji} {t.key}
                    </button>
                  );
                })}
              </div>
              <input type="text" value={moveNewBin}
                onChange={(e) => setMoveNewBin(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !moveBusy) { e.preventDefault(); confirmMove(); } }}
                placeholder={moveNewType === '貨架' ? '新位置 A-3-12' : '板位 P-05'}
                autoFocus
                style={{ flex: isMobile ? 'none' : '1', minWidth: '160px', padding: '13px 16px', borderRadius: '10px', border: `2px solid ${moveNewBin.trim() ? '#7c3aed' : '#cbd5e1'}`, fontSize: '16px', fontFamily: 'monospace', fontWeight: 'bold', outline: 'none', boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {isMobile && <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 'bold', whiteSpace: 'nowrap' }}>📅</span>}
                <input type="date" value={moveNewDate}
                  onChange={(e) => setMoveNewDate(e.target.value)}
                  title="新批次日期(可留空)"
                  style={{ flex: isMobile ? 1 : 'none', padding: '12px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', background: 'white', fontSize: '14px', fontFamily: 'monospace', outline: 'none', minHeight: '46px', boxSizing: 'border-box', color: moveNewDate ? '#0f172a' : '#94a3b8' }} />
                {moveNewDate && (
                  <button onClick={() => setMoveNewDate('')} title="清走日期"
                    style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '16px', padding: '4px 6px' }}>✕</button>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setMoveSource(null)} disabled={moveBusy}
                style={{ flex: 1, padding: '13px', borderRadius: '12px', border: '1px solid #cbd5e1', background: 'white', color: '#475569', fontWeight: 'bold', fontSize: '15px', cursor: moveBusy ? 'not-allowed' : 'pointer' }}>取消</button>
              <button onClick={confirmMove} disabled={moveBusy || !moveNewBin.trim()}
                style={{ flex: 2, padding: '13px', borderRadius: '12px', border: 'none', background: moveBusy ? '#a78bfa' : (moveNewBin.trim() ? '#7c3aed' : '#cbd5e1'), color: 'white', fontWeight: 'bold', fontSize: '15px', cursor: (moveBusy || !moveNewBin.trim()) ? 'not-allowed' : 'pointer' }}>
                {moveBusy ? '⏳ 轉緊...' : `✓ 確認移去 ${(LOC_TYPE_MAP[moveNewType] || LOC_TYPE_MAP['貨架']).emoji} ${moveNewBin || '...'}`}
              </button>
            </div>
          </div>
        )}

        {/* Move result */}
        {moveLastResult && (
          <div style={{ background: moveLastResult.ok ? '#ecfdf5' : '#fef2f2', border: `1px solid ${moveLastResult.ok ? '#d1fae5' : '#fecaca'}`, borderRadius: '14px', padding: '14px 18px', maxWidth: '900px', marginBottom: '14px' }}>
            <div style={{ fontWeight: 'bold', color: moveLastResult.ok ? '#065f46' : '#dc2626' }}>
              {moveLastResult.ok ? '✅' : '❌'} {moveLastResult.message}
            </div>
            {moveLastResult.ok && moveLastResult.from && moveLastResult.to && (
              <div style={{ marginTop: '6px', fontSize: '13px', color: '#475569', fontFamily: 'monospace' }}>
                {moveLastResult.from} → {moveLastResult.to}
              </div>
            )}
          </div>
        )}
      </>)}

      {/* 🔒 刪除密碼 modal */}
      {delModal && (
        <div onClick={() => !delBusy && setDelModal(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(2px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '20px',
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'white', borderRadius: '18px', padding: '26px', width: '100%', maxWidth: '380px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>🔒</div>
              <div>
                <div style={{ fontWeight: '800', fontSize: '17px', color: '#0f172a' }}>
                  {delModal.isBatch ? `刪除 ${delModal.ids.length} 件位置記錄` : '刪除位置記錄'}
                </div>
                <div style={{ fontSize: '13px', color: '#64748b' }}>需要 Full Time 同事密碼</div>
              </div>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #eef2f6', borderRadius: '10px', padding: '10px 14px', margin: '14px 0', fontSize: '13px', color: '#334155', maxHeight: '160px', overflowY: 'auto' }}>
              即將刪除:
              {(delModal.labels || []).map((lbl, i) => (
                <div key={i} style={{ marginTop: '4px', color: '#dc2626', fontWeight: 'bold' }}>• {lbl}</div>
              ))}
            </div>
            <input type="password" value={delPw} autoFocus
              onChange={(e) => { setDelPw(e.target.value); setDelErr(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmDelete(); }}
              placeholder="輸入密碼"
              style={{ width: '100%', padding: '13px 16px', fontSize: '16px', borderRadius: '12px', border: `2px solid ${delErr ? '#fca5a5' : '#cbd5e1'}`, outline: 'none', boxSizing: 'border-box', letterSpacing: '2px' }} />
            {delErr && <div style={{ color: '#dc2626', fontSize: '13px', fontWeight: 'bold', marginTop: '8px' }}>❌ {delErr}</div>}
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button onClick={() => setDelModal(null)} disabled={delBusy}
                style={{ flex: 1, padding: '13px', borderRadius: '12px', border: '1px solid #cbd5e1', background: 'white', color: '#475569', fontWeight: 'bold', fontSize: '15px', cursor: delBusy ? 'not-allowed' : 'pointer' }}>取消</button>
              <button onClick={confirmDelete} disabled={delBusy}
                style={{ flex: 1, padding: '13px', borderRadius: '12px', border: 'none', background: delBusy ? '#fca5a5' : '#dc2626', color: 'white', fontWeight: 'bold', fontSize: '15px', cursor: delBusy ? 'not-allowed' : 'pointer' }}>
                {delBusy ? '⏳ 驗證中...' : (delModal.isBatch ? `🗑 確認刪除 ${delModal.ids.length} 件` : '🗑 確認刪除')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 🌟 字體下載 progress hook — 用 fetch + ReadableStream 抓即時進度
function useFontPreload() {
  // null = 未開始 / 已 cache 唔需顯示;0–100 = 下載中;'done' = 啱啱完成準備 fade out
  const [state, setState] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer;

    (async () => {
      // 先把細嘅 font_css 拎到(<1KB)
      fetchFontCss();
      try {
        const url = `${API_BASE_URL}/api/master/font/syst.ttf`;
        // 用 force-cache 配合 cache 行為:如果 browser 已經 cache 過,fetch 即時 return
        const t0 = performance.now();
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!res.ok || !res.body) { setState(null); return; }

        const total = parseInt(res.headers.get('Content-Length') || '0', 10);
        const reader = res.body.getReader();
        let received = 0;

        // 如果 cache hit,內容會極快讀完;200ms 內讀晒就索性唔顯示 progress
        const fastFinish = total > 0 && total < 2 * 1024 * 1024;
        if (!fastFinish) setState(0);

        while (true) {
          const { done, value } = await reader.read();
          if (done || cancelled) break;
          received += value.length;
          if (total > 0) {
            const pct = Math.min(99, Math.round((received / total) * 100));
            // 過咗 200ms 仲未完先開始畫 UI(避免閃)
            if (state === null && performance.now() - t0 > 200) setState(pct);
            else if (state !== null) setState(pct);
          }
        }
        if (cancelled) return;
        setState('done');
        timer = setTimeout(() => { if (!cancelled) setState(null); }, 1500);
      } catch (e) {
        console.error('[font preload]', e);
        if (!cancelled) setState(null);
      }
    })();

    return () => { cancelled = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}

function FontPreloadOverlay({ state }) {
  if (state === null) return null;
  const isDone = state === 'done';
  const pct = isDone ? 100 : (state || 0);
  return (
    <div style={{
      position: 'fixed', bottom: '20px', right: '20px',
      background: 'white', border: '1px solid #e2e8f0',
      borderRadius: '12px', padding: '12px 16px',
      boxShadow: '0 10px 25px rgba(0,0,0,0.12)',
      minWidth: '240px', zIndex: 9999,
      fontFamily: 'sans-serif', fontSize: '13px',
      animation: 'fadein 0.2s ease',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ fontWeight: 'bold', color: isDone ? '#15803d' : '#0f172a' }}>
          {isDone ? '✅ 字體已準備好' : '⏳ 載入中文字體中…'}
        </span>
        <span style={{ color: '#64748b', fontFamily: 'monospace', fontWeight: 'bold' }}>{pct}%</span>
      </div>
      <div style={{
        height: '6px', borderRadius: '999px',
        background: '#e2e8f0', overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: isDone ? '#16a34a' : 'linear-gradient(90deg, #3b82f6, #60a5fa)',
          transition: 'width 0.2s ease',
        }} />
      </div>
      {!isDone && (
        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
          首次載入需要等下,之後永久 cache 唔再下載
        </div>
      )}
    </div>
  );
}

function App() {
  const fontState = useFontPreload();
  return (
    <Router>
      <FontPreloadOverlay state={fontState} />
      <div className="app-container">
        <Sidebar />
        <div className="main-content">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<UnifiedSearchInventoryPage />} />
            <Route path="/yummy" element={<ThreePLPage key="yummy" config={THREE_PL_CONFIGS.yummy} />} />
            <Route path="/anymall" element={<ThreePLPage key="anymall" config={THREE_PL_CONFIGS.anymall} />} />
            <Route path="/hellobear" element={<ThreePLPage key="hellobear" config={THREE_PL_CONFIGS.hellobear} />} />
            <Route path="/homey" element={<ThreePLPage key="homey" config={THREE_PL_CONFIGS.homey} />} />
            <Route path="/label-search" element={<LabelSearchPage />} />
            <Route path="/label-repack" element={<LabelRepackPage />} />
            <Route path="/bin-location" element={<BinLocationPage />} />
            <Route path="/inspection" element={<InspectionHub />} />
            <Route path="/inspection/history" element={<InspectionHistory />} />
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