import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';

// 🌟 動態判斷 API 網址(同 App.jsx / InspectionZone.jsx 一致)
const API_BASE_URL = import.meta.env.DEV
    ? "http://127.0.0.1:8000"
    : "https://letech-pro.onrender.com";

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

export default function InspectionHub() {
    const navigate = useNavigate();
    const [summary, setSummary] = useState(null);
    const [error, setError] = useState('');
    const [lastUpdated, setLastUpdated] = useState(null);

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

    return (
        <div style={{ padding: '40px 20px', fontFamily: 'sans-serif', maxWidth: '1100px', margin: '0 auto' }}>
            {/* ── Header ─────────────── */}
            <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                <h1 style={{ fontSize: '32px', margin: '0 0 8px', color: '#0f172a' }}>🔍 3PL 貨品檢測中心</h1>
                <p style={{ fontSize: '16px', color: '#64748b', margin: 0 }}>請選擇您負責檢測的區域</p>
            </div>

            {/* ── Zone Buttons ─────────────── */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'center', marginBottom: '40px' }}>
                {ZONES.map(zone => {
                    const cnt = activeCountByZone[zone.id] || 0;
                    return (
                        <button
                            key={zone.id}
                            onClick={() => navigate(`/inspection/${zone.id}`)}
                            style={{
                                padding: '24px 32px',
                                fontSize: '22px',
                                fontWeight: '900',
                                cursor: 'pointer',
                                backgroundColor: zone.color,
                                color: 'white',
                                border: 'none',
                                borderRadius: '14px',
                                minWidth: '200px',
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
                padding: '24px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
            }}>
                <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: '20px', flexWrap: 'wrap', gap: '10px',
                }}>
                    <h2 style={{ margin: 0, fontSize: '20px', color: '#0f172a' }}>
                        📊 進行中嘅任務 {summary && <span style={{ color: '#94a3b8', fontWeight: 'normal', fontSize: '16px' }}>({flatActive.length})</span>}
                    </h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        <Link to="/inspection/history" style={{
                            background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1',
                            padding: '7px 14px', borderRadius: '8px', fontWeight: 'bold',
                            fontSize: '14px', textDecoration: 'none',
                        }}>📚 歷史檢測記錄</Link>
                        <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                            {error ? `⚠️ ${error}` : (lastUpdated ? `🔄 ${timeAgo(lastUpdated.toISOString())}更新` : '⏳ 載入中...')}
                        </span>
                    </div>
                </div>

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
                            return (
                                <div
                                    key={`${t.zoneId}_${t.task_code}`}
                                    onClick={() => navigate(`/inspection/${t.zoneId}`)}
                                    style={{
                                        border: '1px solid #e2e8f0', borderRadius: '12px',
                                        padding: '14px 16px', cursor: 'pointer',
                                        background: t.is_completed ? '#f0fdf4' : 'white',
                                        transition: 'transform 0.1s, box-shadow 0.2s',
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{
                                                background: zone?.color || '#64748b', color: 'white',
                                                padding: '3px 10px', borderRadius: '12px',
                                                fontSize: '12px', fontWeight: 'bold',
                                            }}>{zone?.emoji} {zone?.name || t.zoneId}</span>
                                            <span style={{ fontFamily: 'monospace', fontWeight: '900', fontSize: '18px', color: '#0f172a' }}>
                                                #{t.task_code}
                                            </span>
                                        </div>
                                        {t.is_completed && (
                                            <span style={{ background: '#16a34a', color: 'white', padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }}>✅ 齊貨</span>
                                        )}
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
                                    <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '6px', display: 'flex', justifyContent: 'space-between' }}>
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }} title={t.filename}>
                                            📄 {t.filename || '(未命名)'}
                                        </span>
                                        <span>🕒 {timeAgo(t.created_at)}</span>
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
