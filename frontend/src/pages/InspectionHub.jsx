import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';

// 🌟 動態判斷 API 網址(同 App.jsx 一致;VITE_API_BASE 可覆寫俾 local 預覽用)
const API_BASE_URL =
    import.meta.env.VITE_API_BASE ||
    (import.meta.env.DEV ? "http://127.0.0.1:8000" : "https://letech-pro.onrender.com");

const ZONES = [
    { id: 'anymall', name: 'Anymall', color: '#4CAF50', emoji: '🛍️' },
    { id: 'hellobear', name: 'Hello Bear', color: '#2196F3', emoji: '🐻' },
    { id: 'yummy', name: 'Yummy', color: '#FF9800', emoji: '🍔' },
    { id: 'homey', name: 'Homey', color: '#E91E63', emoji: '🏠' },
];

const ZONE_BY_ID = Object.fromEntries(ZONES.map(z => [z.id, z]));

// 將 ISO timestamp 轉成「3 分鐘前 / 2 小時前」
function timeAgo(iso) {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    const diff = Math.max(0, Date.now() - then);
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s} 秒前`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} 分鐘前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} 小時前`;
    const d = Math.floor(h / 24);
    return `${d} 日前`;
}

// 🗓 將 ISO 轉成「2025/06/01 週一」
const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
function formatDateWithDay(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}/${mm}/${dd} 週${WEEK_LABELS[d.getDay()]}`;
}

export default function InspectionHub() {
    const navigate = useNavigate();
    const [summary, setSummary] = useState(null);
    const [legacyKeys, setLegacyKeys] = useState([]); // 🌟 舊版任務(冇 task code)
    const [error, setError] = useState('');
    const [lastUpdated, setLastUpdated] = useState(null);
    const [manageMode, setManageMode] = useState(false);
    const [selectedKeys, setSelectedKeys] = useState(new Set()); // {"yummy_20052", ...}
    const [deleting, setDeleting] = useState(false);
    // 🌟 RWD — 手機(< 640px)行為唔同
    const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 640);
    useEffect(() => {
        const onResize = () => setIsMobile(window.innerWidth < 640);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    // Poll active summary 每 10 秒
    useEffect(() => {
        let cancelled = false;
        async function fetchSummary() {
            try {
                const res = await fetch(`${API_BASE_URL}/api/inspection/active-summary`);
                if (!res.ok) {
                    let detail = '';
                    try {
                        const body = await res.json();
                        detail = body?.detail || JSON.stringify(body);
                    } catch (_) {
                        detail = await res.text().catch(() => '');
                    }
                    throw new Error(`HTTP ${res.status} ${detail.slice(0, 200)}`);
                }
                const data = await res.json();
                if (!cancelled) {
                    setSummary(data.zones || {});
                    setLegacyKeys(data.legacy_zone_keys || []);
                    setLastUpdated(new Date());
                    setError('');
                }
            } catch (err) {
                if (!cancelled) setError(err.message || '無法載入');
            }
        }
        fetchSummary();
        const interval = setInterval(fetchSummary, 10000);
        return () => { cancelled = true; clearInterval(interval); };
    }, []);

    // 計算每 zone 嘅 active 任務數(用嚟喺 zone 鈕到顯示 badge)
    const activeCountByZone = useMemo(() => {
        const c = {};
        if (summary) for (const [zone, tasks] of Object.entries(summary)) c[zone] = tasks.length;
        return c;
    }, [summary]);

    // 全部 active tasks 平鋪一個 array,按 created_at desc
    const flatActive = useMemo(() => {
        if (!summary) return [];
        const arr = [];
        for (const [zoneId, tasks] of Object.entries(summary)) {
            for (const t of tasks) arr.push({ ...t, zoneId });
        }
        arr.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        return arr;
    }, [summary]);

    // ── 管理模式 helpers ──
    const toggleSelect = (key) => {
        setSelectedKeys(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };
    const selectAll = () => setSelectedKeys(new Set(flatActive.map(t => t.zone_key || `${t.zoneId}_${t.task_code}`)));
    const clearSelection = () => setSelectedKeys(new Set());
    const exitManageMode = () => { setManageMode(false); clearSelection(); };

    // 🌟 一鍵清理所有舊版孤兒任務
    const handleCleanupLegacy = async () => {
        if (legacyKeys.length === 0) return;
        const ok = window.confirm(
            `🧹 揾到 ${legacyKeys.length} 個舊版任務(冇 5 位數任務碼,無法經 UI 開返)。\n\n` +
            `確定要徹底清掉?(任務 + 所有 SKU 紀錄一齊清,Supabase 入面都會冇晒)`
        );
        if (!ok) return;
        setDeleting(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/inspection/delete-batch`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task_keys: legacyKeys }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.detail || `HTTP ${res.status}`);
            }
            const data = await res.json();
            alert(`✅ ${data.message || '清理完成'}`);
            setLegacyKeys([]);
        } catch (err) {
            alert('❌ 清理失敗:' + err.message);
        } finally {
            setDeleting(false);
        }
    };

    const handleBulkDelete = async () => {
        if (selectedKeys.size === 0) { alert('未揀任何任務'); return; }
        const keys = Array.from(selectedKeys);
        const ok = window.confirm(
            `⚠️ 確定要徹底刪除 ${keys.length} 個任務嗎?\n\n` +
            `呢個係硬刪 — 任務同所有 SKU 紀錄一齊清掉,冇得喺歷史記錄揾返!\n\n` +
            `任務:${keys.slice(0, 5).join(', ')}${keys.length > 5 ? `…還有 ${keys.length - 5} 個` : ''}`
        );
        if (!ok) return;
        setDeleting(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/inspection/delete-batch`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task_keys: keys }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.detail || `HTTP ${res.status}`);
            }
            const data = await res.json();
            alert(`✅ ${data.message || '刪除成功'}`);
            // 即時 refresh summary
            setSummary(prev => {
                if (!prev) return prev;
                const cleaned = {};
                for (const [zoneId, tasks] of Object.entries(prev)) {
                    cleaned[zoneId] = tasks.filter(t => !selectedKeys.has(t.zone_key || `${zoneId}_${t.task_code}`));
                }
                return cleaned;
            });
            clearSelection();
        } catch (err) {
            alert('❌ 刪除失敗:' + err.message);
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div style={{ padding: isMobile ? '20px 12px' : '40px 20px', fontFamily: 'sans-serif', maxWidth: '1100px', margin: '0 auto' }}>
            {/* ── Header ─────────────── */}
            <div style={{ textAlign: 'center', marginBottom: isMobile ? '20px' : '30px' }}>
                <h1 style={{ fontSize: isMobile ? '24px' : '32px', margin: '0 0 8px', color: '#0f172a' }}>🔍 3PL 貨品檢測中心</h1>
                <p style={{ fontSize: isMobile ? '14px' : '16px', color: '#64748b', margin: 0 }}>請選擇您負責檢測的區域</p>
            </div>

            {/* ── Zone Buttons ─────────────── */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? '10px' : '16px', justifyContent: 'center', marginBottom: isMobile ? '20px' : '40px' }}>
                {ZONES.map(zone => {
                    const cnt = activeCountByZone[zone.id] || 0;
                    return (
                        <button
                            key={zone.id}
                            onClick={() => navigate(`/inspection/${zone.id}`)}
                            style={{
                                padding: isMobile ? '16px 18px' : '24px 32px',
                                fontSize: isMobile ? '16px' : '22px',
                                fontWeight: '900',
                                cursor: 'pointer',
                                backgroundColor: zone.color,
                                color: 'white',
                                border: 'none',
                                borderRadius: '14px',
                                minWidth: isMobile ? '140px' : '200px',
                                flex: isMobile ? '1 1 calc(50% - 5px)' : '0 0 auto',
                                boxShadow: '0 6px 14px rgba(0,0,0,0.12)',
                                transition: 'transform 0.1s, box-shadow 0.2s',
                                position: 'relative',
                            }}
                            onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.96)'}
                            onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                        >
                            <span style={{ marginRight: '6px' }}>{zone.emoji}</span>{zone.name}
                            {cnt > 0 && (
                                <span style={{
                                    position: 'absolute', top: '-6px', right: '-6px',
                                    background: 'white', color: zone.color,
                                    fontSize: '13px', fontWeight: '900',
                                    padding: '4px 9px', borderRadius: '20px',
                                    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                                    minWidth: '22px', textAlign: 'center',
                                }}>{cnt}</span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* ── Dashboard Section ─────────────── */}
            <div style={{
                background: 'white',
                borderRadius: '16px',
                padding: isMobile ? '16px' : '24px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
            }}>
                <div style={{
                    display: 'flex',
                    flexDirection: isMobile ? 'column' : 'row',
                    justifyContent: 'space-between',
                    alignItems: isMobile ? 'stretch' : 'center',
                    marginBottom: '20px', gap: '10px',
                }}>
                    <h2 style={{ margin: 0, fontSize: '20px', color: '#0f172a' }}>
                        📊 進行中嘅任務 {summary && <span style={{ color: '#94a3b8', fontWeight: 'normal', fontSize: '16px' }}>({flatActive.length})</span>}
                    </h2>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        flexWrap: 'wrap',
                        // 手機自動 wrap 多行 + 對齊左
                        justifyContent: isMobile ? 'flex-start' : 'flex-end',
                    }}>
                        {!manageMode ? (
                            <>
                                {/* 🔒 三個管理用按鈕只係電腦版顯示,防止手機員工誤撳 */}
                                {!isMobile && (
                                    <>
                                        {legacyKeys.length > 0 && (
                                            <button onClick={handleCleanupLegacy} disabled={deleting} style={{
                                                background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a',
                                                padding: '7px 14px', borderRadius: '8px', fontWeight: 'bold',
                                                fontSize: '14px', cursor: deleting ? 'not-allowed' : 'pointer',
                                                whiteSpace: 'nowrap',
                                            }} title="清理冇 task code 嘅孤兒任務">
                                                {deleting ? '⏳ 清理中...' : `🧹 清理舊版 (${legacyKeys.length})`}
                                            </button>
                                        )}
                                        <button onClick={() => setManageMode(true)} style={{
                                            background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa',
                                            padding: '7px 14px', borderRadius: '8px', fontWeight: 'bold',
                                            fontSize: '14px', cursor: 'pointer', whiteSpace: 'nowrap',
                                        }}>⚙️ 管理模式</button>
                                        <Link to="/inspection/history" style={{
                                            background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1',
                                            padding: '7px 14px', borderRadius: '8px', fontWeight: 'bold',
                                            fontSize: '14px', textDecoration: 'none', whiteSpace: 'nowrap',
                                        }}>📚 歷史檢測記錄</Link>
                                        <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                                            {error ? `⚠️ ${error}` : (lastUpdated ? `🔄 ${timeAgo(lastUpdated.toISOString())}更新` : '⏳ 載入中...')}
                                        </span>
                                    </>
                                )}
                            </>
                        ) : (
                            <>
                                <button onClick={selectAll} style={{
                                    background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe',
                                    padding: '7px 14px', borderRadius: '8px', fontWeight: 'bold',
                                    fontSize: '14px', cursor: 'pointer', whiteSpace: 'nowrap',
                                }}>☑️ 全選</button>
                                <button onClick={clearSelection} disabled={selectedKeys.size === 0} style={{
                                    background: '#f8fafc', color: '#475569', border: '1px solid #cbd5e1',
                                    padding: '7px 14px', borderRadius: '8px', fontWeight: 'bold',
                                    fontSize: '14px', cursor: selectedKeys.size === 0 ? 'not-allowed' : 'pointer',
                                    opacity: selectedKeys.size === 0 ? 0.5 : 1, whiteSpace: 'nowrap',
                                }}>清除</button>
                                <button onClick={handleBulkDelete} disabled={selectedKeys.size === 0 || deleting} style={{
                                    background: selectedKeys.size === 0 ? '#cbd5e1' : '#dc2626', color: 'white',
                                    border: 'none', padding: '7px 14px', borderRadius: '8px',
                                    fontWeight: 'bold', fontSize: '14px',
                                    cursor: selectedKeys.size === 0 || deleting ? 'not-allowed' : 'pointer',
                                    whiteSpace: 'nowrap',
                                }}>
                                    {deleting ? '⏳ 刪除中...' : `🗑 刪除 (${selectedKeys.size})`}
                                </button>
                                <button onClick={exitManageMode} style={{
                                    background: 'white', color: '#475569', border: '1px solid #cbd5e1',
                                    padding: '7px 14px', borderRadius: '8px', fontWeight: 'bold',
                                    fontSize: '14px', cursor: 'pointer', whiteSpace: 'nowrap',
                                }}>✕ 取消</button>
                            </>
                        )}
                    </div>
                </div>

                {manageMode && (
                    <div style={{
                        background: '#fef3c7', border: '1px solid #fde68a',
                        padding: '10px 14px', borderRadius: '8px', marginBottom: '15px',
                        fontSize: '13px', color: '#92400e',
                    }}>
                        🛠️ <strong>管理模式</strong>:撳張 card 打勾揀,撳「🗑 徹底刪除」清走任務同所有 SKU 紀錄(<strong>呢個係硬刪,冇得返,亦唔會出現喺歷史記錄</strong>)。
                        {selectedKeys.size > 0 && <span style={{ marginLeft: '10px', fontWeight: 'bold' }}>已揀 {selectedKeys.size} 個</span>}
                    </div>
                )}
                {summary === null ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>載入中...</div>
                ) : flatActive.length === 0 ? (
                    <div style={{
                        padding: '40px 20px', textAlign: 'center', color: '#64748b',
                        background: '#f8fafc', borderRadius: '10px', border: '1px dashed #cbd5e1',
                    }}>
                        <div style={{ fontSize: '36px', marginBottom: '8px' }}>📭</div>
                        <div style={{ fontWeight: 'bold' }}>而家冇進行中嘅任務</div>
                        <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '6px' }}>揀個 zone 上載 PDF 開新任務</div>
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' }}>
                        {flatActive.map((t) => {
                            const zone = ZONE_BY_ID[t.zoneId];
                            const pct = t.total_target > 0
                                ? Math.round((t.total_scanned / t.total_target) * 100)
                                : 0;
                            // 🌟 優先用 backend 嘅 zone_key,fallback 至拼裝(舊 cache 兼容)
                            const key = t.zone_key || `${t.zoneId}_${t.task_code}`;
                            const checked = selectedKeys.has(key);
                            const isEmpty = t.items_count === 0;
                            return (
                                <div
                                    key={key}
                                    onClick={manageMode ? (() => toggleSelect(key)) : undefined}
                                    style={{
                                        border: checked ? '2px solid #dc2626' : '1px solid #e2e8f0',
                                        borderRadius: '12px',
                                        padding: '14px 16px',
                                        // 🔒 Normal mode = 純資訊唔畀撳;管理模式先變 pointer
                                        cursor: manageMode ? 'pointer' : 'default',
                                        background: checked ? '#fef2f2' : (t.is_completed ? '#f0fdf4' : 'white'),
                                        transition: 'transform 0.1s, box-shadow 0.2s, border 0.15s',
                                        position: 'relative',
                                    }}
                                    onMouseEnter={(e) => { if (manageMode) { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}}
                                    onMouseLeave={(e) => { if (manageMode) { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            {manageMode && (
                                                <input type="checkbox" checked={checked} readOnly
                                                    style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: '#dc2626' }} />
                                            )}
                                            <span style={{
                                                background: zone?.color || '#64748b', color: 'white',
                                                padding: '3px 10px', borderRadius: '12px',
                                                fontSize: '12px', fontWeight: 'bold',
                                            }}>{zone?.emoji} {zone?.name || t.zoneId}</span>
                                            <span style={{ fontFamily: 'monospace', fontWeight: '900', fontSize: '18px', color: '#0f172a' }}>
                                                #{t.task_code}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '4px' }}>
                                            {isEmpty && (
                                                <span style={{ background: '#fef3c7', color: '#92400e', padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }}>⚠️ 空</span>
                                            )}
                                            {t.is_completed && (
                                                <span style={{ background: '#16a34a', color: 'white', padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }}>✅ 齊貨</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Progress bar */}
                                    <div style={{ background: '#e2e8f0', borderRadius: '999px', overflow: 'hidden', height: '10px', marginBottom: '6px' }}>
                                        <div style={{
                                            width: `${pct}%`,
                                            background: t.is_completed ? '#16a34a' : (zone?.color || '#3b82f6'),
                                            height: '100%', transition: 'width 0.3s',
                                        }} />
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#64748b' }}>
                                        <span><strong style={{ color: '#0f172a' }}>{t.total_scanned}</strong> / {t.total_target} 件 ({pct}%)</span>
                                        <span>{t.items_count} SKU</span>
                                    </div>
                                    <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '6px', display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }} title={t.filename}>
                                            📄 {t.filename || '(未命名)'}
                                        </span>
                                        <span style={{ whiteSpace: 'nowrap', fontWeight: t.created_at ? 'bold' : 'normal', color: t.created_at ? '#475569' : '#cbd5e1' }}>
                                            📅 {formatDateWithDay(t.created_at) || '—'}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
