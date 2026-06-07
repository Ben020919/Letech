import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';

const API_BASE_URL = import.meta.env.DEV
    ? "http://127.0.0.1:8000"
    : "https://letech-pro.onrender.com";

const ZONES = [
    { id: 'all', name: '全部', color: '#475569', emoji: '📋' },
    { id: 'anymall', name: 'Anymall', color: '#4CAF50', emoji: '🛍️' },
    { id: 'hellobear', name: 'Hello Bear', color: '#2196F3', emoji: '🐻' },
    { id: 'yummy', name: 'Yummy', color: '#FF9800', emoji: '🍔' },
    { id: 'homey', name: 'Homey', color: '#E91E63', emoji: '🏠' },
];
const ZONE_BY_ID = Object.fromEntries(ZONES.map(z => [z.id, z]));

function fmtDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export default function InspectionHistory() {
    const [zoneFilter, setZoneFilter] = useState('all');
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [keyword, setKeyword] = useState('');
    const [openDetail, setOpenDetail] = useState(null); // { task, items }
    const [detailLoading, setDetailLoading] = useState(false);

    const fetchHistory = async () => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams();
            if (zoneFilter && zoneFilter !== 'all') params.set('zone', zoneFilter);
            const res = await fetch(`${API_BASE_URL}/api/inspection/history?${params.toString()}`);
            if (!res.ok) throw new Error('載入失敗');
            const data = await res.json();
            setHistory(data.history || []);
        } catch (err) {
            setError(err.message);
            setHistory([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchHistory(); }, [zoneFilter]);

    const filteredHistory = useMemo(() => {
        if (!keyword.trim()) return history;
        const k = keyword.trim().toLowerCase();
        return history.filter(h =>
            (h.task_code || '').toLowerCase().includes(k) ||
            (h.filename || '').toLowerCase().includes(k) ||
            (h.zone || '').toLowerCase().includes(k)
        );
    }, [history, keyword]);

    const openTaskDetail = async (zone, task_code) => {
        setDetailLoading(true);
        setOpenDetail({ loading: true, zone, task_code });
        try {
            const res = await fetch(`${API_BASE_URL}/api/inspection/history/${zone}/${task_code}`);
            if (!res.ok) throw new Error('載入詳情失敗');
            const data = await res.json();
            setOpenDetail({ zone, task_code, task: data.task, items: data.items });
        } catch (err) {
            alert('❌ ' + err.message);
            setOpenDetail(null);
        } finally {
            setDetailLoading(false);
        }
    };

    const exportDetailCSV = () => {
        if (!openDetail || !openDetail.items) return;
        const z = ZONE_BY_ID[openDetail.zone];
        const headers = "商品編號,商品名稱,條碼,應檢數量,已掃數量,狀態\n";
        const rows = openDetail.items.map(i =>
            `${i.Product_No},${(i.Name || '').replace(/,/g, ' ')},${i.Barcode},${i.Target_Qty},${i.Scanned_Qty},${i.Status}`
        ).join("\n");
        const csv = "data:text/csv;charset=utf-8,﻿" + encodeURIComponent(headers + rows);
        const link = document.createElement("a");
        link.href = csv;
        link.download = `${z?.name || openDetail.zone}_${openDetail.task_code}_歷史記錄.csv`;
        link.click();
    };

    return (
        <div style={{ padding: '30px 20px', fontFamily: 'sans-serif', maxWidth: '1100px', margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '20px', flexWrap: 'wrap' }}>
                <Link to="/inspection" style={{
                    background: '#f1f5f9', border: '1px solid #cbd5e1',
                    padding: '8px 14px', borderRadius: '8px', textDecoration: 'none',
                    color: '#475569', fontWeight: 'bold',
                }}>⬅️ 返回檢測中心</Link>
                <h1 style={{ margin: 0, fontSize: '26px', color: '#0f172a' }}>📚 檢測歷史記錄</h1>
            </div>

            {/* Filter tabs + search */}
            <div style={{ background: 'white', padding: '16px', borderRadius: '12px', boxShadow: '0 2px 6px rgba(0,0,0,0.04)', marginBottom: '20px' }}>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                    {ZONES.map(z => {
                        const active = zoneFilter === z.id;
                        return (
                            <button key={z.id} onClick={() => setZoneFilter(z.id)} style={{
                                padding: '8px 16px', borderRadius: '999px',
                                border: active ? `2px solid ${z.color}` : '1px solid #cbd5e1',
                                background: active ? z.color : 'white',
                                color: active ? 'white' : '#475569',
                                fontWeight: 'bold', cursor: 'pointer', fontSize: '14px',
                            }}>
                                {z.emoji} {z.name}
                            </button>
                        );
                    })}
                </div>
                <input
                    type="text"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="🔍 搜尋任務碼 / 檔案名 ..."
                    style={{
                        width: '100%', padding: '10px 14px', borderRadius: '8px',
                        border: '1px solid #cbd5e1', fontSize: '14px', outline: 'none',
                        boxSizing: 'border-box',
                    }}
                />
            </div>

            {/* History list */}
            <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>⏳ 載入中...</div>
                ) : error ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: '#dc2626' }}>❌ {error}</div>
                ) : filteredHistory.length === 0 ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                        <div style={{ fontSize: '36px', marginBottom: '8px' }}>📭</div>
                        <div style={{ fontWeight: 'bold' }}>{keyword ? '冇符合搜尋嘅結果' : '冇歷史記錄'}</div>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                            <thead>
                                <tr style={{ background: '#f8fafc', textAlign: 'left', color: '#64748b' }}>
                                    <th style={{ padding: '12px' }}>區域</th>
                                    <th style={{ padding: '12px' }}>任務碼</th>
                                    <th style={{ padding: '12px' }}>檔案</th>
                                    <th style={{ padding: '12px', textAlign: 'center' }}>SKU</th>
                                    <th style={{ padding: '12px', textAlign: 'center' }}>完成度</th>
                                    <th style={{ padding: '12px' }}>建立時間</th>
                                    <th style={{ padding: '12px' }}>結案時間</th>
                                    <th style={{ padding: '12px', textAlign: 'center' }}>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredHistory.map((h) => {
                                    const z = ZONE_BY_ID[h.zone];
                                    const pct = h.total_target > 0 ? Math.round((h.total_scanned / h.total_target) * 100) : 0;
                                    const isComplete = h.total_target > 0 && h.total_scanned === h.total_target;
                                    return (
                                        <tr key={`${h.zone}_${h.task_code}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ padding: '12px' }}>
                                                <span style={{
                                                    background: z?.color || '#64748b', color: 'white',
                                                    padding: '3px 10px', borderRadius: '12px',
                                                    fontSize: '12px', fontWeight: 'bold',
                                                }}>{z?.emoji} {z?.name || h.zone}</span>
                                            </td>
                                            <td style={{ padding: '12px', fontFamily: 'monospace', fontWeight: '900', color: '#0f172a' }}>#{h.task_code}</td>
                                            <td style={{ padding: '12px', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={h.filename}>
                                                {h.filename || '-'}
                                            </td>
                                            <td style={{ padding: '12px', textAlign: 'center', color: '#475569' }}>{h.items_count}</td>
                                            <td style={{ padding: '12px', textAlign: 'center' }}>
                                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                                    <span style={{ fontWeight: 'bold', color: isComplete ? '#16a34a' : '#0f172a' }}>
                                                        {h.total_scanned}/{h.total_target}
                                                    </span>
                                                    <span style={{
                                                        background: isComplete ? '#dcfce7' : '#fef3c7',
                                                        color: isComplete ? '#166534' : '#92400e',
                                                        padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 'bold',
                                                    }}>{pct}%</span>
                                                </div>
                                            </td>
                                            <td style={{ padding: '12px', fontSize: '12px', color: '#64748b' }}>{fmtDate(h.created_at)}</td>
                                            <td style={{ padding: '12px', fontSize: '12px', color: '#64748b' }}>{fmtDate(h.archived_at)}</td>
                                            <td style={{ padding: '12px', textAlign: 'center' }}>
                                                <button onClick={() => openTaskDetail(h.zone, h.task_code)} style={{
                                                    background: '#0f172a', color: 'white', border: 'none',
                                                    padding: '6px 14px', borderRadius: '6px', fontWeight: 'bold',
                                                    cursor: 'pointer', fontSize: '13px',
                                                }}>🔍 詳情</button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Detail Modal */}
            {openDetail && (
                <div onClick={() => setOpenDetail(null)} style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 1000, padding: '20px',
                }}>
                    <div onClick={(e) => e.stopPropagation()} style={{
                        background: 'white', borderRadius: '16px', padding: '24px',
                        maxWidth: '900px', width: '100%', maxHeight: '85vh', overflow: 'auto',
                    }}>
                        {detailLoading || openDetail.loading ? (
                            <div style={{ padding: '40px', textAlign: 'center' }}>⏳ 載入中...</div>
                        ) : (
                            <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', flexWrap: 'wrap', gap: '10px' }}>
                                    <div>
                                        <h2 style={{ margin: '0 0 4px', color: '#0f172a' }}>
                                            {ZONE_BY_ID[openDetail.zone]?.emoji} {ZONE_BY_ID[openDetail.zone]?.name || openDetail.zone} · #{openDetail.task_code}
                                        </h2>
                                        <div style={{ fontSize: '13px', color: '#64748b' }}>📄 {openDetail.task?.filename}</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button onClick={exportDetailCSV} style={{
                                            background: '#3b82f6', color: 'white', border: 'none',
                                            padding: '8px 14px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer',
                                        }}>📥 匯出 CSV</button>
                                        <button onClick={() => setOpenDetail(null)} style={{
                                            background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1',
                                            padding: '8px 14px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer',
                                        }}>✕ 關閉</button>
                                    </div>
                                </div>
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                        <thead>
                                            <tr style={{ background: '#f8fafc', textAlign: 'left', color: '#64748b' }}>
                                                <th style={{ padding: '10px' }}>商品編號</th>
                                                <th style={{ padding: '10px' }}>名稱</th>
                                                <th style={{ padding: '10px' }}>條碼</th>
                                                <th style={{ padding: '10px', textAlign: 'center' }}>應檢</th>
                                                <th style={{ padding: '10px', textAlign: 'center' }}>已掃</th>
                                                <th style={{ padding: '10px', textAlign: 'center' }}>狀態</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(openDetail.items || []).map((it) => {
                                                const isComplete = it.Scanned_Qty >= it.Target_Qty;
                                                const isShort = it.Scanned_Qty < it.Target_Qty;
                                                return (
                                                    <tr key={it.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                        <td style={{ padding: '10px', fontWeight: 'bold' }}>{it.Product_No}</td>
                                                        <td style={{ padding: '10px', maxWidth: '260px', wordBreak: 'break-word' }}>{it.Name}</td>
                                                        <td style={{ padding: '10px', fontFamily: 'monospace', color: '#3b82f6' }}>{it.Barcode}</td>
                                                        <td style={{ padding: '10px', textAlign: 'center', fontWeight: 'bold' }}>{it.Target_Qty}</td>
                                                        <td style={{ padding: '10px', textAlign: 'center', color: isComplete ? '#16a34a' : '#dc2626', fontWeight: 'bold' }}>{it.Scanned_Qty}</td>
                                                        <td style={{ padding: '10px', textAlign: 'center' }}>
                                                            {isComplete ? (
                                                                <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 10px', borderRadius: '10px', fontWeight: 'bold', fontSize: '11px' }}>✅ 齊</span>
                                                            ) : isShort ? (
                                                                <span style={{ background: '#fef2f2', color: '#b91c1c', padding: '2px 10px', borderRadius: '10px', fontWeight: 'bold', fontSize: '11px' }}>⚠️ 短裝</span>
                                                            ) : (
                                                                <span style={{ background: '#f1f5f9', color: '#475569', padding: '2px 10px', borderRadius: '10px', fontWeight: 'bold', fontSize: '11px' }}>-</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
