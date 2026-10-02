import React, { useState, useEffect, useRef, useMemo } from 'react';

// 🎯 食乜好轉盤 — 唔知食乜就轉下佢
// 選項存喺 localStorage(每部機各自一份),唔使郁後端同資料庫。

const STORAGE_KEY = 'letech_food_wheel_items';
const HISTORY_KEY = 'letech_food_wheel_history';
const NO_REPEAT_KEY = 'letech_food_wheel_norepeat';

const DEFAULT_ITEMS = [
    '茶餐廳', '燒味飯', '麥當勞', '粉麵',
    '日本野', '韓國野', '點心', '便利店',
];

// 相鄰唔會撞色嘅調色盤
const COLORS = [
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899',
    '#f43f5e', '#84cc16', '#06b6d4', '#6366f1',
];

const MAX_ITEMS = 24;
const MAX_LEN = 20;

// ── 音效(同檢測頁一樣用 WebAudio,唔使載任何檔案)──
let sharedAudioCtx = null;
const playSound = (type) => {
    try {
        if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = sharedAudioCtx.createOscillator();
        const gain = sharedAudioCtx.createGain();
        osc.connect(gain);
        gain.connect(sharedAudioCtx.destination);
        const t = sharedAudioCtx.currentTime;
        if (type === 'win') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(660, t);
            osc.frequency.setValueAtTime(880, t + 0.12);
            osc.frequency.setValueAtTime(1180, t + 0.24);
            gain.gain.setValueAtTime(0.35, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.6);
            osc.start(t);
            osc.stop(t + 0.6);
            if (navigator.vibrate) navigator.vibrate([80, 60, 160]);
        } else {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(420, t);
            gain.gain.setValueAtTime(0.18, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
            osc.start(t);
            osc.stop(t + 0.15);
        }
    } catch { /* 靜音都唔算錯誤,照跑 */ }
};

const loadJSON = (key, fallback) => {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const v = JSON.parse(raw);
        return Array.isArray(v) ? v : fallback;
    } catch {
        return fallback;   // 私隱模式 / 清咗 site data 都唔好當機
    }
};

const saveJSON = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 存唔到就算 */ }
};

export default function FoodWheel() {
    const [items, setItems] = useState(() => loadJSON(STORAGE_KEY, DEFAULT_ITEMS));
    const [history, setHistory] = useState(() => loadJSON(HISTORY_KEY, []));
    const [noRepeat, setNoRepeat] = useState(() => {
        try { return localStorage.getItem(NO_REPEAT_KEY) !== 'false'; } catch { return true; }
    });

    const [input, setInput] = useState('');
    const [editing, setEditing] = useState(null);     // {index, value}
    const [rotation, setRotation] = useState(0);
    const [spinning, setSpinning] = useState(false);
    const [winner, setWinner] = useState(null);
    const [toast, setToast] = useState('');

    const pendingWinner = useRef(null);
    const inputRef = useRef(null);
    const editRef = useRef(null);

    useEffect(() => { saveJSON(STORAGE_KEY, items); }, [items]);
    useEffect(() => { saveJSON(HISTORY_KEY, history); }, [history]);
    useEffect(() => {
        try { localStorage.setItem(NO_REPEAT_KEY, String(noRepeat)); } catch { /* 算數 */ }
    }, [noRepeat]);

    useEffect(() => {
        if (editing && editRef.current) editRef.current.focus();
    }, [editing]);

    const showToast = (msg) => {
        setToast(msg);
        setTimeout(() => setToast(''), 2200);
    };

    // ── 選項管理 ──
    const addItem = () => {
        const v = input.trim().slice(0, MAX_LEN);
        if (!v) return;
        if (items.length >= MAX_ITEMS) return showToast(`最多得 ${MAX_ITEMS} 個選項`);
        if (items.some(i => i === v)) return showToast(`「${v}」已經喺度喇`);
        setItems(prev => [...prev, v]);
        setInput('');
        if (inputRef.current) inputRef.current.focus();   // 連續加嘢唔使再撳格仔
    };

    const removeItem = (idx) => {
        setItems(prev => prev.filter((_, i) => i !== idx));
        if (editing && editing.index === idx) setEditing(null);
    };

    const commitEdit = () => {
        if (!editing) return;
        const v = editing.value.trim().slice(0, MAX_LEN);
        const { index } = editing;
        setEditing(null);
        if (!v) return;
        if (items.some((it, i) => it === v && i !== index)) return showToast(`「${v}」已經喺度喇`);
        setItems(prev => prev.map((it, i) => (i === index ? v : it)));
    };

    const resetDefaults = () => {
        if (!window.confirm('確定要還原做預設嗰 8 個選項?\n(你自己加嘅會冇晒)')) return;
        setItems(DEFAULT_ITEMS);
        setEditing(null);
    };

    // ── 轉盤 ──
    const spin = () => {
        if (spinning || items.length < 2) return;

        // 可以揀嘅範圍:開咗「唔好連續中同一樣」就剔走上次嗰個
        let pool = items.map((_, i) => i);
        const last = history[0];
        if (noRepeat && last && items.length > 1) {
            const filtered = pool.filter(i => items[i] !== last);
            if (filtered.length > 0) pool = filtered;
        }
        const picked = pool[Math.floor(Math.random() * pool.length)];

        const step = 360 / items.length;
        // 指針喺 12 點鐘。sector i 由頂部順時針數起,中心角度 = (i + 0.5) * step。
        // 要佢停喺指針度,轉盤最終角度就要 ≡ -中心角度 (mod 360)。
        const centre = (picked + 0.5) * step;
        const target = ((-centre % 360) + 360) % 360;
        const current = ((rotation % 360) + 360) % 360;
        let delta = target - current;
        if (delta < 0) delta += 360;
        // 轉 5 圈先停,睇落先似轉盤
        const next = rotation + 360 * 5 + delta;

        pendingWinner.current = items[picked];
        setWinner(null);
        setSpinning(true);
        setRotation(next);
        playSound('tick');
    };

    const onSpinEnd = () => {
        if (!spinning) return;
        setSpinning(false);
        const w = pendingWinner.current;
        if (!w) return;
        setWinner(w);
        setHistory(prev => [w, ...prev].slice(0, 8));
        playSound('win');
    };

    // ── SVG 扇形 ──
    const sectors = useMemo(() => {
        const n = items.length;
        if (n === 0) return [];
        const step = 360 / n;
        const R = 190, CX = 200, CY = 200;
        const rad = (d) => ((d - 90) * Math.PI) / 180;   // -90 = 由 12 點鐘開始

        return items.map((label, i) => {
            const a0 = i * step, a1 = (i + 1) * step;
            const x0 = CX + R * Math.cos(rad(a0)), y0 = CY + R * Math.sin(rad(a0));
            const x1 = CX + R * Math.cos(rad(a1)), y1 = CY + R * Math.sin(rad(a1));
            const largeArc = step > 180 ? 1 : 0;
            const d = n === 1
                ? `M ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX - 0.01} ${CY - R} Z`
                : `M ${CX} ${CY} L ${x0} ${y0} A ${R} ${R} 0 ${largeArc} 1 ${x1} ${y1} Z`;

            // 文字擺喺扇形中線,左半邊要反轉 180° 唔係會倒轉
            const mid = a0 + step / 2;
            const tr = R * (n > 14 ? 0.68 : 0.62);
            const tx = CX + tr * Math.cos(rad(mid));
            const ty = CY + tr * Math.sin(rad(mid));
            const norm = ((mid % 360) + 360) % 360;
            const flip = norm > 180;
            const textRot = flip ? mid + 90 + 180 : mid + 90;

            // 色:相鄰唔好撞,首尾都唔好撞
            let colorIdx = i % COLORS.length;
            if (n > 1 && i === n - 1 && colorIdx === 0) colorIdx = 1 % COLORS.length;

            const fontSize = n <= 6 ? 20 : n <= 10 ? 17 : n <= 16 ? 14 : 11;
            const maxChars = n <= 6 ? 9 : n <= 10 ? 8 : n <= 16 ? 7 : 6;
            const shown = label.length > maxChars ? label.slice(0, maxChars - 1) + '…' : label;

            return { d, fill: COLORS[colorIdx], tx, ty, textRot, fontSize, shown, label };
        });
    }, [items]);

    const canSpin = items.length >= 2 && !spinning;

    return (
        <div className="page-content" style={{ maxWidth: '1000px', margin: '0 auto', paddingBottom: '50px' }}>
            <h1 style={{ fontSize: '27px', color: '#0f172a', margin: '0 0 6px', fontWeight: '800', letterSpacing: '-0.6px' }}>
                🎯 輪盤
            </h1>
            <p style={{ color: '#64748b', margin: '0 0 25px', fontSize: '15px' }}>
                諗唔到食乜就轉下佢。下面可以自己加、改、刪選項,會記住喺你部機度。
            </p>

            <div style={{ display: 'flex', gap: '25px', flexWrap: 'wrap', alignItems: 'flex-start' }}>

                {/* ───── 轉盤 ───── */}
                <div style={{ flexGrow: 1, flexBasis: '340px', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ position: 'relative', width: '100%', maxWidth: '400px' }}>
                        {/* 指針 */}
                        <div style={{
                            position: 'absolute', top: '-6px', left: '50%', transform: 'translateX(-50%)',
                            width: 0, height: 0, zIndex: 2,
                            borderLeft: '16px solid transparent', borderRight: '16px solid transparent',
                            borderTop: '30px solid #0f172a',
                            filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.3))',
                        }} />

                        <div
                            onTransitionEnd={onSpinEnd}
                            style={{
                                transform: `rotate(${rotation}deg)`,
                                transition: spinning ? 'transform 4.6s cubic-bezier(0.16, 0.84, 0.26, 1)' : 'none',
                                willChange: 'transform',
                            }}
                        >
                            <svg viewBox="0 0 400 400" style={{ width: '100%', display: 'block', filter: 'drop-shadow(0 6px 18px rgba(0,0,0,0.14))' }}>
                                <circle cx="200" cy="200" r="196" fill="#0f172a" />
                                {items.length === 0 ? (
                                    <circle cx="200" cy="200" r="190" fill="#e2e8f0" />
                                ) : sectors.map((s, i) => (
                                    <g key={i}>
                                        <path d={s.d} fill={s.fill} stroke="#ffffff" strokeWidth="2" />
                                        <text
                                            x={s.tx} y={s.ty}
                                            transform={`rotate(${s.textRot} ${s.tx} ${s.ty})`}
                                            textAnchor="middle" dominantBaseline="central"
                                            fill="#ffffff" fontSize={s.fontSize} fontWeight="900"
                                            style={{ paintOrder: 'stroke', pointerEvents: 'none' }}
                                            stroke="rgba(0,0,0,0.25)" strokeWidth="2.5"
                                        >
                                            {s.shown}
                                        </text>
                                    </g>
                                ))}
                                <circle cx="200" cy="200" r="26" fill="#ffffff" stroke="#0f172a" strokeWidth="4" />
                            </svg>
                        </div>
                    </div>

                    <button
                        onClick={spin} disabled={!canSpin}
                        style={{
                            marginTop: '22px', width: '100%', maxWidth: '400px',
                            background: canSpin ? '#ea580c' : '#cbd5e1', color: '#ffffff',
                            border: 'none', padding: '18px', borderRadius: '16px',
                            fontSize: '22px', fontWeight: '900', letterSpacing: '1px',
                            cursor: canSpin ? 'pointer' : 'not-allowed',
                            boxShadow: canSpin ? '0 6px 16px rgba(234,88,12,0.3)' : 'none',
                        }}
                    >
                        {spinning ? '🌀 轉緊...' : items.length < 2 ? '最少要有 2 個選項' : '🎲 轉!'}
                    </button>

                    {/* 結果 */}
                    {winner && !spinning && (
                        <div style={{
                            marginTop: '18px', width: '100%', maxWidth: '400px',
                            background: '#f0fdf4', border: '3px solid #86efac', borderRadius: '16px',
                            padding: '20px', textAlign: 'center',
                        }}>
                            <div style={{ fontSize: '14px', color: '#15803d', fontWeight: 'bold', marginBottom: '6px' }}>
                                🎉 就食呢樣啦
                            </div>
                            <div style={{ fontSize: '32px', fontWeight: '900', color: '#14532d', wordBreak: 'break-word' }}>
                                {winner}
                            </div>
                        </div>
                    )}

                    {history.length > 0 && (
                        <div style={{ marginTop: '16px', width: '100%', maxWidth: '400px' }}>
                            <div style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 'bold', marginBottom: '7px' }}>
                                最近轉過
                            </div>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                {history.map((h, i) => (
                                    <span key={i} style={{
                                        background: i === 0 ? '#dcfce7' : '#f1f5f9',
                                        color: i === 0 ? '#166534' : '#64748b',
                                        border: `1px solid ${i === 0 ? '#86efac' : '#e2e8f0'}`,
                                        padding: '4px 11px', borderRadius: '999px',
                                        fontSize: '13px', fontWeight: 'bold',
                                    }}>{h}</span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* ───── 選項管理 ───── */}
                <div style={{
                    flexGrow: 1, flexBasis: '320px', minWidth: 0,
                    background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '20px', padding: '22px',
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', gap: '10px' }}>
                        <h3 style={{ margin: 0, fontSize: '18px', color: '#0f172a' }}>
                            轉盤選項 <span style={{ color: '#94a3b8', fontWeight: 'normal', fontSize: '15px' }}>({items.length})</span>
                        </h3>
                        <button onClick={resetDefaults} style={{
                            background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1',
                            padding: '6px 12px', borderRadius: '9px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer',
                        }}>↩️ 還原預設</button>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                        <input
                            ref={inputRef} type="text" value={input} maxLength={MAX_LEN}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
                            placeholder="例如:牛肉麵"
                            style={{
                                flexGrow: 1, flexBasis: 0, minWidth: 0, padding: '12px 14px', fontSize: '16px',
                                borderRadius: '10px', border: '2px solid #cbd5e1', outline: 'none', boxSizing: 'border-box',
                            }}
                        />
                        <button onClick={addItem} disabled={!input.trim()} style={{
                            background: input.trim() ? '#2563eb' : '#cbd5e1', color: 'white', border: 'none',
                            padding: '12px 18px', borderRadius: '10px', fontSize: '16px', fontWeight: 'bold',
                            cursor: input.trim() ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap',
                        }}>➕ 加</button>
                    </div>

                    <label style={{
                        display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '14px',
                        fontSize: '14px', color: '#475569', cursor: 'pointer', userSelect: 'none',
                    }}>
                        <input type="checkbox" checked={noRepeat} onChange={(e) => setNoRepeat(e.target.checked)}
                            style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                        唔好連續中同一樣
                    </label>

                    {items.length === 0 ? (
                        <div style={{
                            padding: '28px 15px', textAlign: 'center', color: '#94a3b8',
                            background: '#f8fafc', borderRadius: '12px', border: '2px dashed #cbd5e1', fontSize: '14px',
                        }}>
                            未有選項,喺上面加啦
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                            {items.map((it, idx) => {
                                const colorIdx = (items.length > 1 && idx === items.length - 1 && idx % COLORS.length === 0)
                                    ? 1 % COLORS.length : idx % COLORS.length;
                                const isEditing = editing && editing.index === idx;
                                return (
                                    <div key={idx} style={{
                                        display: 'flex', alignItems: 'center', gap: '10px',
                                        background: '#f8fafc', border: '1px solid #e2e8f0',
                                        borderRadius: '10px', padding: '9px 11px',
                                    }}>
                                        <span style={{
                                            width: '14px', height: '14px', borderRadius: '4px',
                                            background: COLORS[colorIdx], flexShrink: 0,
                                        }} />
                                        {isEditing ? (
                                            <input
                                                ref={editRef} type="text" value={editing.value} maxLength={MAX_LEN}
                                                onChange={(e) => setEditing({ index: idx, value: e.target.value })}
                                                onBlur={commitEdit}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                                                    if (e.key === 'Escape') setEditing(null);
                                                }}
                                                style={{
                                                    flexGrow: 1, flexBasis: 0, minWidth: 0, padding: '5px 8px', fontSize: '15px',
                                                    borderRadius: '7px', border: '2px solid #3b82f6', outline: 'none', boxSizing: 'border-box',
                                                }}
                                            />
                                        ) : (
                                            <span
                                                onClick={() => setEditing({ index: idx, value: it })}
                                                title="撳一下改名"
                                                style={{
                                                    flexGrow: 1, flexBasis: 0, minWidth: 0, fontSize: '15px', fontWeight: 'bold',
                                                    color: '#0f172a', cursor: 'text', wordBreak: 'break-word',
                                                }}
                                            >{it}</span>
                                        )}
                                        <button onClick={() => removeItem(idx)} title="刪走" style={{
                                            background: 'transparent', color: '#94a3b8', border: 'none',
                                            fontSize: '18px', cursor: 'pointer', padding: '0 4px', lineHeight: 1, flexShrink: 0,
                                        }}>✕</button>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div style={{ marginTop: '14px', fontSize: '12.5px', color: '#94a3b8', lineHeight: '1.6' }}>
                        撳選項個名就可以改。最多 {MAX_ITEMS} 個,每個最長 {MAX_LEN} 字。
                        <br />選項只會存喺你呢部機,同事嗰邊係佢哋自己嗰份。
                    </div>
                </div>
            </div>

            {toast && (
                <div style={{
                    position: 'fixed', bottom: '28px', left: '50%', transform: 'translateX(-50%)',
                    background: '#0f172a', color: 'white', padding: '13px 22px', borderRadius: '12px',
                    fontSize: '15px', fontWeight: 'bold', zIndex: 9999, boxShadow: '0 8px 22px rgba(0,0,0,0.25)',
                }}>
                    {toast}
                </div>
            )}
        </div>
    );
}
