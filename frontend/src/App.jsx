import { Html5Qrcode } from 'html5-qrcode'; 
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { BrowserRouter as Router, Routes, useNavigate, Route, Link, useLocation } from 'react-router-dom';
import InspectionHub from './pages/InspectionHub';
import InspectionZone from './pages/InspectionZone';
import InspectionHistory from './pages/InspectionHistory';
import './App.css';

// 🌟 自動切換測試與正式環境的 API 網址 (本地跑 npm run dev 時會是 127.0.0.1，上線時會是 render)
const API_BASE_URL = import.meta.env.DEV
  ? "http://127.0.0.1:8000"
  : "https://letech-pro.onrender.com";

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
      <div className="page-header" style={{ textAlign: 'center', marginBottom: '30px' }}>
        <h2 style={{ fontSize: '30px', color: '#0f172a', fontWeight: '800', margin: 0 }}>🔍 智能查詢中心</h2>
        <p style={{ color: '#64748b', fontSize: '15px', marginTop: '10px' }}>先搜尋商品，再確認庫存，雙管齊下更高效率。</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '35px' }}>
          
        {/* ================= 上層：資料庫搜尋專區 + 上傳面板 ================= */}
        <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          
          {/* 左側：搜尋區塊 */}
          <div style={{ flex: '1', minWidth: '300px', background: '#ffffff', padding: '25px', borderRadius: '24px', border: '1px solid #e2e8f0', boxShadow: '0 8px 25px rgba(59, 130, 246, 0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                  <div style={{ background: '#eff6ff', padding: '10px', borderRadius: '12px', display: 'flex' }}>📚</div>
                  <h3 style={{ margin: 0, color: '#1e293b', fontSize: '20px', fontWeight: 'bold' }}>本地資料庫搜尋</h3>
              </div>

              <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
                  <div style={{ position: 'relative', flex: '1', minWidth: '220px' }}>
                      <input 
                          type="text" 
                          value={searchQuery} 
                          onChange={(e) => setSearchQuery(e.target.value)} 
                          placeholder="輸入 SKU / Barcode / 中英文名稱..." 
                          style={{ width: '100%', padding: '15px 18px', fontSize: '16px', borderRadius: '14px', border: '2px solid #cbd5e1', outline: 'none', boxSizing: 'border-box', transition: 'all 0.2s' }}
                          onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                          onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                      />
                      {searchQuery && (
                          <button type="button" onClick={() => { setSearchQuery(''); setSearchResults([]); setHasSearched(false); }} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '18px', padding: '5px', cursor: 'pointer' }}>✕</button>
                      )}
                  </div>
                  <button type="submit" disabled={searchLoading} style={{ background: searchLoading ? '#94a3b8' : '#3b82f6', color: 'white', padding: '15px 25px', fontSize: '16px', borderRadius: '14px', border: 'none', fontWeight: 'bold', cursor: searchLoading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0, transition: 'background 0.2s' }}>
                      {searchLoading ? '⏳ 搜尋中...' : '🔍 搜尋商品'}
                  </button>
              </form>

              {/* 搜尋結果顯示區 */}
              {searchError && <p style={{ color: '#ef4444', fontWeight: 'bold', padding: '10px', background: '#fef2f2', borderRadius: '10px' }}>❌ {searchError}</p>}
              {!searchLoading && !searchError && hasSearched && searchResults.length === 0 && <p style={{ color: '#d97706', fontWeight: 'bold', background: '#fef3c7', padding: '12px 15px', borderRadius: '12px', margin: 0 }}>⚠️ 找不到相符的商品資料</p>}

              {!searchLoading && searchResults.length > 0 && (
                  <div style={{ maxHeight: '350px', overflowY: 'auto', paddingRight: '5px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {searchResults.map((item, index) => (
                      <div key={index} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '15px', gap: '15px' }}>
                          <div style={{ flex: '1', minWidth: '200px' }}>
                              <div style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a', marginBottom: '8px', lineHeight: '1.4' }}>{item.Name}</div>
                              <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', fontSize: '13px' }}>
                                  <div style={{ background: '#ffffff', padding: '4px 8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}><span style={{ color: '#64748b' }}>SKU:</span> <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#3b82f6' }}>{item.ProductCode}</span></div>
                                  <div style={{ background: '#ffffff', padding: '4px 8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}><span style={{ color: '#64748b' }}>Barcode:</span> <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#10b981' }}>{item.Barcode}</span></div>
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
        <div ref={inventorySectionRef} style={{ background: '#ffffff', padding: '25px', borderRadius: '24px', border: '1px solid #e2e8f0', boxShadow: '0 8px 25px rgba(16, 185, 129, 0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                <div style={{ background: '#ecfdf5', padding: '10px', borderRadius: '12px', display: 'flex' }}>📦</div>
                <h3 style={{ margin: 0, color: '#064e3b', fontSize: '20px', fontWeight: 'bold' }}>DEAR 即時庫存查詢</h3>
            </div>

            <form onSubmit={handleInvSubmit} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
                <div style={{ position: 'relative', flex: '1', minWidth: '220px' }}>
                    <input 
                        type="text" 
                        value={invQuery} 
                        onChange={(e) => setInvQuery(e.target.value)} 
                        placeholder="請輸入精確的 SKU (如: LT10009829)" 
                        style={{ width: '100%', padding: '15px 18px', fontSize: '16px', borderRadius: '14px', border: '2px solid #cbd5e1', outline: 'none', boxSizing: 'border-box', transition: 'all 0.2s' }}
                        onFocus={(e) => e.target.style.borderColor = '#10b981'}
                        onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                    />
                    {invQuery && (
                        <button type="button" onClick={() => { setInvQuery(''); }} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '18px', padding: '5px', cursor: 'pointer' }}>✕</button>
                    )}
                </div>
                <button type="submit" disabled={invLoading} style={{ background: invLoading ? '#94a3b8' : '#10b981', color: 'white', padding: '15px 25px', fontSize: '16px', borderRadius: '14px', border: 'none', fontWeight: 'bold', cursor: invLoading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0, transition: 'background 0.2s' }}>
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

    const doPrint = () => {
      if (printed) return;
      printed = true;
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (e) { console.error(e); }
      // 打印對話框關閉(印完或取消)後清走 iframe
      if (iframe.contentWindow) {
        iframe.contentWindow.onafterprint = cleanup;
      }
      // safety:即使 onafterprint 唔觸發,5 秒後都會 clean(夠時間用戶睇 dialog)
      setTimeout(cleanup, 5000);
    };

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(finalHtml);
    doc.close();

    if (cssNeeded) {
      // 有 embedded font + JS shrink-to-fit,delay 100ms 等渲染完成
      setTimeout(doPrint, 100);
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
        <div style={{ flex: '1', minWidth: '300px', background: 'white', padding: '25px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
          <input type="file" accept=".pdf" onChange={(e) => setFile(e.target.files[0])} style={{ width: '100%', marginBottom: '15px' }} /><br />
          <button onClick={handleProcess} disabled={loading} style={{ background: loading ? '#94a3b8' : config.accent, color: 'white', padding: '12px 24px', borderRadius: '8px', border: 'none', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? '⏳ 解析中...' : '📄 開始解析 PDF'}
          </button>
          {error && <p style={{ color: 'red', marginTop: '10px', fontWeight: 'bold' }}>❌ {error}</p>}
        </div>
        {/* 🔒 手機隱藏防止員工誤撳上傳資料庫 */}
        {!isMobile && config.uploader && (
          <DatabaseUploader title={config.uploader.title} infoUrl={`${API_BASE_URL}/api/master/info`} uploadUrl={`${API_BASE_URL}/api/master/upload`} />
        )}
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
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
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
  const [cancelInputs, setCancelInputs] = useState({ today: '', tomorrow: '' });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false); // 🌟 新增：遠端觸發狀態

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
    fetchOrderData();
    const interval = setInterval(fetchOrderData, 30000); // 30秒自動更新
    return () => clearInterval(interval);
  }, []);

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

  // 處理前端手動增加取消訂單，並同步回 Render 伺服器
  const handleCancelSubmit = async (dayKey) => {
    const qty = parseInt(cancelInputs[dayKey] || 0, 10);
    if (qty <= 0) return;

    // 複製一份當前的資料來修改
    const newData = JSON.parse(JSON.stringify(orderData));
    if (!newData[dayKey]) return;
    
    const currentCanceled = parseInt(newData[dayKey].CANCELED || "0", 10);
    newData[dayKey].CANCELED = (currentCanceled + qty).toString();

    try {
      // 傳送更新後的整包資料給後端
      const res = await fetch(`${API_BASE_URL}/api/hktvmall/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newData)
      });
      if (res.ok) {
        setOrderData(newData);
        setCancelInputs({ ...cancelInputs, [dayKey]: '' }); // 清空輸入框
        alert(`✅ 已成功記錄 ${qty} 筆取消訂單，並同步至系統！`);
      }
    } catch (err) {
      alert("更新失敗：" + err.message);
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
          <div style={{ background: '#fef2f2', padding: '20px', borderRadius: '16px', textAlign: 'center', border: '1px solid #fecaca' }}>
            <div style={{ color: '#ef4444', fontSize: '15px', fontWeight: 'bold', marginBottom: '8px' }}>❌ 已取消</div>
            <div style={{ fontSize: '32px', color: '#b91c1c', fontWeight: '900' }}>{dayData.CANCELED || '0'}</div>
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

        {/* 手動紀錄取消區塊 (改用 details 摺疊面板，大幅節省空間) */}
        <details style={{ background: '#ffffff', padding: '15px 20px', borderRadius: '16px', border: '1px dashed #cbd5e1', cursor: 'pointer' }}>
          <summary style={{ fontSize: '16px', fontWeight: 'bold', color: '#0f172a', outline: 'none', userSelect: 'none' }}>
            ⚙️ 手動紀錄取消訂單 <span style={{ fontSize: '13px', color: '#3b82f6', fontWeight: 'normal', marginLeft: '10px' }}>(點擊展開 ▼)</span>
          </summary>
          <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #f1f5f9', cursor: 'default' }}>
            <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '15px', marginTop: 0 }}>如果發現客人取消訂單，您可以在此手動紀錄取消的數量（總目標數會自動跟隨系統校正）：</p>
            <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
              <input 
                type="number" min="1" step="1" placeholder="請輸入數量..."
                value={cancelInputs[dayKey] || ''} 
                onChange={(e) => setCancelInputs({...cancelInputs, [dayKey]: e.target.value})}
                style={{ padding: '12px 15px', borderRadius: '10px', border: '2px solid #cbd5e1', outline: 'none', width: '150px', fontSize: '16px' }}
              />
              <button onClick={() => handleCancelSubmit(dayKey)} style={{ background: '#0f172a', color: 'white', border: 'none', padding: '12px 25px', borderRadius: '10px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={(e) => e.target.style.background = '#334155'} onMouseOut={(e) => e.target.style.background = '#0f172a'}>
                📝 記錄取消
              </button>
            </div>
          </div>
        </details>
      </div>
    );
  };

  return (
    <div className="page-content" style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: '50px' }}>
      
      {/* 標題與更新按鈕 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '35px', flexWrap: 'wrap', gap: '15px' }}>
        <h1 style={{ fontSize: '36px', color: '#ea580c', margin: 0, fontWeight: '900', letterSpacing: '-0.5px' }}>🛍️ HKTVmall 智慧訂單監控儀表板</h1>
        
        {/* 🌟 修改：新增了遠端觸發按鈕 */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button onClick={fetchOrderData} disabled={isRefreshing} style={{ background: '#ffffff', color: '#0f172a', border: '1px solid #cbd5e1', padding: '12px 20px', borderRadius: '12px', fontSize: '15px', fontWeight: 'bold', cursor: isRefreshing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', transition: 'all 0.2s' }}>
            {isRefreshing ? '🔄 載入中...' : '🔄 重新整理畫面'}
          </button>
          <button onClick={handleRemoteTrigger} disabled={isTriggering} style={{ background: isTriggering ? '#94a3b8' : '#ea580c', color: '#ffffff', border: 'none', padding: '12px 20px', borderRadius: '12px', fontSize: '15px', fontWeight: 'bold', cursor: isTriggering ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 6px rgba(234,88,12,0.2)', transition: 'all 0.2s' }}>
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
      printHtmlInIframe(data.html, data.font_css);
    } catch (err) { alert('❌ ' + err.message); }
    finally { setPrintingKey(null); }
  };

  const TYPE_BADGES = {
    food: { label: '🍱 Food Label', color: '#2563eb', bg: '#eff6ff' },
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
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleKey}
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
function LabelRepackPage() {
  const [mode, setMode] = useState('repack'); // 'repack' | 'barcode_only'
  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(false);

  const handlePrint = async () => {
    if (!barcode.trim()) { alert('請輸入 barcode'); return; }
    if (mode === 'repack' && !name.trim()) { alert('請輸入商品名稱(或切換到「純 Barcode」模式)'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/label_tool/repack`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barcode: barcode.trim(),
          name: name.trim(),
          qty: parseInt(qty || 1, 10),
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
        </div>

        <div style={{ padding: '30px' }}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#0f172a' }}>📊 Barcode(數字 / 字母)</label>
            <input type="text" value={barcode} onChange={(e) => setBarcode(e.target.value)}
              placeholder="例如 49568102370 67A"
              style={{ width: '100%', padding: '14px', borderRadius: '10px', border: '2px solid #cbd5e1', fontSize: '16px', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' }} />
          </div>

          {mode === 'repack' && (
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#0f172a' }}>🏷️ 商品名稱(中/英都得)</label>
              <textarea value={name} onChange={(e) => setName(e.target.value)} rows={3}
                placeholder="例如:日本 Bitatto Okuchi 清新蜂膠便攜除菌漱口水 - 檸檬味 (11ml x 5條) x2"
                style={{ width: '100%', padding: '14px', borderRadius: '10px', border: '2px solid #cbd5e1', fontSize: '15px', lineHeight: '1.5', outline: 'none', boxSizing: 'border-box', resize: 'vertical' }} />
            </div>
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
            ) : (
              <>ℹ️ <strong>純 Barcode label</strong>:70mm × 50mm,大尺寸條碼圖 + 條碼數字(18pt),冇商品名,適合純標識用。</>
            )}
          </div>
        </div>
      </div>
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
            <Route path="/search" element={<UnifiedSearchInventoryPage />} />
            <Route path="/yummy" element={<ThreePLPage key="yummy" config={THREE_PL_CONFIGS.yummy} />} />
            <Route path="/anymall" element={<ThreePLPage key="anymall" config={THREE_PL_CONFIGS.anymall} />} />
            <Route path="/hellobear" element={<ThreePLPage key="hellobear" config={THREE_PL_CONFIGS.hellobear} />} />
            <Route path="/homey" element={<ThreePLPage key="homey" config={THREE_PL_CONFIGS.homey} />} />
            <Route path="/label-search" element={<LabelSearchPage />} />
            <Route path="/label-repack" element={<LabelRepackPage />} />
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