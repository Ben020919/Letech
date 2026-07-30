import { useState, useEffect, useMemo, useRef } from 'react';

const LS_UNLOCK = 'gym_unlocked_v1';
const LS_PLAN = 'gym_plan_v1';
const LS_LOGS = 'gym_logs_v1';
const LS_REASONS = 'gym_week_reasons_v1';
const PASSWORD = '020919';
const WEEKLY_TARGET = 3;

// Backend API base(自動切換 local vs Render)
const API_BASE_URL =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.DEV ? 'http://127.0.0.1:8000' : 'https://letech-pro.onrender.com');

async function apiGetGym() {
  const r = await fetch(`${API_BASE_URL}/api/gym/data?password=${encodeURIComponent(PASSWORD)}`);
  if (!r.ok) throw new Error(`GET failed ${r.status}`);
  return r.json();
}
async function apiSaveGym({ plan, logs, reasons }) {
  const body = { password: PASSWORD };
  if (plan !== undefined) body.plan = plan;
  if (logs !== undefined) body.logs = logs;
  if (reasons !== undefined) body.reasons = reasons;
  const r = await fetch(`${API_BASE_URL}/api/gym/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST failed ${r.status}`);
  return r.json();
}

const DEFAULT_PLAN = {
  Day1: {
    name: '胸部訓練日',
    short: '胸部',
    exercises: [
      '窄握推胸機：3組，每組10-12次',
      '啞鈴上斜臥推：4組，每組10-12次',
      '史密斯機平板臥推：3組，每組10-12次',
      '蝴蝶機夾胸：3組，每組12-15次',
      '下胸繩索推舉：3組，每組10-12次',
      '繩索反手三頭肌下壓：3組，每組12-15次',
    ],
  },
  Day2: {
    name: '背部訓練日',
    short: '背部',
    exercises: [
      '繩索下拉：3組，每組10-12次',
      '單手划船機：3組，每組8-10次',
      '單手寬握下拉：3組，每組8-10次',
      '坐姿窄握划船：3組，每組10-12次',
      '引體向上：3組，盡可能多次',
      '啞鈴錘式彎舉：3組，每組10-12次',
    ],
  },
  Day3: {
    name: '腿部訓練日',
    short: '腿部',
    exercises: [
      '史密斯深蹲：4組，每組8-10次',
      '啞鈴羅馬尼亞硬拉：4組，每組8-10次',
      '髖外展機：3組，每組10-12次',
      '髖內收機：3組，每組10-12次',
      '腿彎舉：3組，每組10-12次',
      '箭步蹲：3組，每組8-10次',
    ],
  },
  Day4: {
    name: '手臂訓練日',
    short: '手臂',
    exercises: [
      '啞鈴肩推：3組，每組8-12次',
      '啞鈴側平舉：3組，每組12-15次',
      '反向飛鳥訓練機：3組，每組12-15次',
      '面拉：3組，每組12-15次',
      '單手繩索三頭肌下壓：3組，每組10-12次',
      '啞鈴過頭臂屈伸：3組，每組10-12次',
      '槓鈴彎舉：3組，每組8-10次',
    ],
  },
};

// ─── Date helpers ─────────────────────────────────────────
function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function getWeekThursday(weekStart) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 3);
  return d;
}
function getMonthLabel(weekStart) {
  const thu = getWeekThursday(weekStart);
  return `${thu.getFullYear()} 年 ${thu.getMonth() + 1} 月`;
}
function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
// 拎某月完整月曆網格 (由當月頭嘅星期一開始,到當月尾嘅星期日)
function getMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const start = getWeekStart(first);
  const end = new Date(last);
  const dayOfLast = end.getDay();
  const diffToSun = dayOfLast === 0 ? 0 : 7 - dayOfLast;
  end.setDate(end.getDate() + diffToSun);
  end.setHours(23, 59, 59, 999);
  const days = [];
  const cur = new Date(start);
  while (cur <= end) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}
// log 拎狀態:未指定 status 當 'done' (舊資料 backwards compat)
function logStatus(log) {
  if (!log) return null;
  return log.status || 'done';
}

// ─── LocalStorage helpers ─────────────────────────────────
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// 統一 dispatch 事件通知 sidebar 更新
function notifyGymAuthChanged() {
  window.dispatchEvent(new Event('gym-auth-changed'));
}

// ═══════════════════════════════════════════════════════════
// Password Gate
// ═══════════════════════════════════════════════════════════
function PasswordGate({ onUnlock }) {
  const [input, setInput] = useState('');
  const [err, setErr] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (input === PASSWORD) {
      localStorage.setItem(LS_UNLOCK, 'true');
      notifyGymAuthChanged();
      onUnlock();
    } else {
      setErr('密碼錯誤');
      setInput('');
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '80vh', padding: 20,
    }}>
      <form onSubmit={submit} style={{
        background: '#fff', padding: 40, borderRadius: 20,
        boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
        width: '100%', maxWidth: 380, textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🏋️</div>
        <h2 style={{ margin: 0, marginBottom: 8, color: '#0f172a' }}>私人健身打卡</h2>
        <p style={{ color: '#64748b', marginBottom: 24, fontSize: 14 }}>請輸入密碼</p>
        <input
          type="password"
          value={input}
          onChange={(e) => { setInput(e.target.value); setErr(''); }}
          autoFocus
          inputMode="numeric"
          style={{
            width: '100%', padding: '14px 16px', fontSize: 18,
            border: `2px solid ${err ? '#ef4444' : '#e2e8f0'}`,
            borderRadius: 12, textAlign: 'center', letterSpacing: 4,
            outline: 'none',
          }}
        />
        {err && <p style={{ color: '#ef4444', margin: '10px 0 0', fontSize: 13 }}>{err}</p>}
        <button type="submit" style={{
          marginTop: 20, width: '100%', padding: '14px',
          background: '#3b82f6', color: '#fff', border: 'none',
          borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: 'pointer',
        }}>解鎖</button>
      </form>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Check-in Modal
// ═══════════════════════════════════════════════════════════
function CheckInModal({ dateKey, plan, existingLog, today, onSave, onDelete, onClose }) {
  const [type, setType] = useState(existingLog?.type || '');
  const [dayKey, setDayKey] = useState(existingLog?.dayKey || '');
  const [note, setNote] = useState(existingLog?.note || '');

  const entryDate = new Date(dateKey);
  entryDate.setHours(0, 0, 0, 0);
  const isFuture = entryDate > today;
  // mode: 'plan' = 預先安排 (future date) / 'checkin' = 打卡 (today/past)
  const [mode, setMode] = useState(() => {
    if (existingLog?.status === 'planned' && !isFuture) return 'plan_or_confirm'; // planned entry viewed on/after
    return isFuture ? 'plan' : 'checkin';
  });

  const canSave = type === 'rest' || (type === 'workout' && dayKey);

  const save = (asStatus) => {
    if (!canSave) return;
    const log = { type, note, status: asStatus };
    if (type === 'workout') log.dayKey = dayKey;
    onSave(dateKey, log);
  };

  const primarySaveLabel = mode === 'plan' ? '💾 儲存安排' : '💾 儲存打卡';
  const saveStatus = mode === 'plan' ? 'planned' : 'done';
  const workoutBtnLabel = mode === 'plan' ? '安排訓練' : '已打卡';
  const restBtnLabel = mode === 'plan' ? '安排休息' : '休息日';

  const modeLabel = mode === 'plan'
    ? { text: '📅 預先安排 (未到當日,可以先揀想練咩)', bg: '#eff6ff', color: '#1d4ed8' }
    : mode === 'plan_or_confirm'
    ? { text: '📅 已安排 — 撳「打卡完成」確認今日已完成', bg: '#eff6ff', color: '#1d4ed8' }
    : { text: '✅ 今日/過去打卡', bg: '#ecfdf5', color: '#065f46' };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 20,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 20, padding: 24,
        width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{dateKey}</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 24, cursor: 'pointer', color: '#64748b' }}>×</button>
        </div>

        <div style={{ padding: '8px 12px', background: modeLabel.bg, color: modeLabel.color, borderRadius: 8, fontSize: 12, fontWeight: 600, marginBottom: 16 }}>
          {modeLabel.text}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            onClick={() => setType('workout')}
            style={{
              flexGrow: 1, flexBasis: 0, minWidth: 0, padding: '14px', borderRadius: 12,
              background: type === 'workout' ? '#3b82f6' : '#f1f5f9',
              color: type === 'workout' ? '#fff' : '#334155',
              border: 'none', fontWeight: 700, fontSize: 15, cursor: 'pointer',
            }}
          >{workoutBtnLabel}</button>
          <button
            onClick={() => { setType('rest'); setDayKey(''); }}
            style={{
              flexGrow: 1, flexBasis: 0, minWidth: 0, padding: '14px', borderRadius: 12,
              background: type === 'rest' ? '#f59e0b' : '#f1f5f9',
              color: type === 'rest' ? '#fff' : '#334155',
              border: 'none', fontWeight: 700, fontSize: 15, cursor: 'pointer',
            }}
          >{restBtnLabel}</button>
        </div>

        {type === 'workout' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: '#64748b', fontWeight: 600, marginBottom: 8 }}>練咩？</div>
            {Object.keys(plan).length === 0 ? (
              <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 8, fontSize: 13 }}>
                ⚠️ 訓練計劃係空,去下面「📋 完整訓練計劃 → ✏️ 編輯」加返日子先。
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {Object.entries(plan).map(([k, d]) => (
                  <button key={k} onClick={() => setDayKey(k)} style={{
                    padding: '12px 8px', borderRadius: 10,
                    background: dayKey === k ? '#0f172a' : '#f8fafc',
                    color: dayKey === k ? '#fff' : '#334155',
                    border: '1px solid #e2e8f0', fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', textAlign: 'left',
                  }}>{d.name}</button>
                ))}
              </div>
            )}
          </div>
        )}

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="備註（重量、感想…）"
          rows={3}
          style={{
            width: '100%', padding: 12, borderRadius: 10,
            border: '1px solid #e2e8f0', fontSize: 14, resize: 'vertical',
            fontFamily: 'inherit', outline: 'none',
          }}
        />

        {mode === 'plan_or_confirm' && (
          <button onClick={() => save('done')} disabled={!canSave} style={{
            marginTop: 16, width: '100%', padding: 14,
            background: canSave ? '#10b981' : '#cbd5e1',
            color: '#fff', border: 'none', borderRadius: 12,
            fontWeight: 700, fontSize: 16, cursor: canSave ? 'pointer' : 'not-allowed',
          }}>🎯 打卡完成 (確認今日已練)</button>
        )}

        <button onClick={() => save(saveStatus)} disabled={!canSave} style={{
          marginTop: mode === 'plan_or_confirm' ? 8 : 16, width: '100%', padding: 14,
          background: canSave ? (mode === 'plan_or_confirm' ? '#3b82f6' : '#10b981') : '#cbd5e1',
          color: '#fff', border: 'none', borderRadius: 12,
          fontWeight: 700, fontSize: 16, cursor: canSave ? 'pointer' : 'not-allowed',
        }}>{mode === 'plan_or_confirm' ? '💾 只更新安排 (未打卡)' : primarySaveLabel}</button>

        {existingLog && (
          <button onClick={() => onDelete(dateKey)} style={{
            marginTop: 8, width: '100%', padding: 12,
            background: '#fef2f2', color: '#dc2626',
            border: '1px solid #fecaca', borderRadius: 10,
            fontWeight: 600, fontSize: 14, cursor: 'pointer',
          }}>🗑️ 清除呢日</button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Plan Editor Modal
// ═══════════════════════════════════════════════════════════
function PlanEditorModal({ plan, onSave, onClose }) {
  const [draft, setDraft] = useState(JSON.parse(JSON.stringify(plan)));

  const updateField = (dayKey, field, val) => {
    setDraft({ ...draft, [dayKey]: { ...draft[dayKey], [field]: val } });
  };
  const updateExercise = (dayKey, idx, val) => {
    const newEx = [...draft[dayKey].exercises];
    newEx[idx] = val;
    setDraft({ ...draft, [dayKey]: { ...draft[dayKey], exercises: newEx } });
  };
  const addExercise = (dayKey) => {
    setDraft({ ...draft, [dayKey]: { ...draft[dayKey], exercises: [...draft[dayKey].exercises, ''] } });
  };
  const delExercise = (dayKey, idx) => {
    const newEx = draft[dayKey].exercises.filter((_, i) => i !== idx);
    setDraft({ ...draft, [dayKey]: { ...draft[dayKey], exercises: newEx } });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 20,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 20, padding: 24,
        width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>編輯訓練計劃</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 24, cursor: 'pointer', color: '#64748b' }}>×</button>
        </div>

        {Object.entries(draft).map(([dayKey, d]) => (
          <div key={dayKey} style={{
            background: '#f8fafc', padding: 16, borderRadius: 12,
            marginBottom: 12, border: '1px solid #e2e8f0',
          }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input
                value={d.name}
                onChange={(e) => updateField(dayKey, 'name', e.target.value)}
                placeholder="全名（例:胸部訓練日）"
                style={{ flexGrow: 2, flexBasis: 0, minWidth: 0, padding: 8, border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, fontWeight: 700, outline: 'none' }}
              />
              <input
                value={d.short || ''}
                onChange={(e) => updateField(dayKey, 'short', e.target.value)}
                placeholder="簡稱（例:胸部）"
                maxLength={4}
                style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, padding: 8, border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, outline: 'none' }}
              />
            </div>
            {d.exercises.map((ex, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input
                  value={ex}
                  onChange={(e) => updateExercise(dayKey, idx, e.target.value)}
                  style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, padding: 8, border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, outline: 'none' }}
                />
                <button onClick={() => delExercise(dayKey, idx)} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 8, padding: '0 10px', cursor: 'pointer', fontSize: 16 }}>−</button>
              </div>
            ))}
            <button onClick={() => addExercise(dayKey)} style={{ marginTop: 4, background: '#dbeafe', color: '#1d4ed8', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>+ 加動作</button>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={onClose} style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, padding: 14, background: '#f1f5f9', color: '#334155', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>取消</button>
          <button onClick={() => onSave(draft)} style={{ flexGrow: 2, flexBasis: 0, minWidth: 0, padding: 14, background: '#10b981', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>💾 儲存</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Reason Modal (weekly incomplete)
// ═══════════════════════════════════════════════════════════
function ReasonModal({ weekKey, monthLabel, workoutCount, existing, onSave, onClose }) {
  const [reason, setReason] = useState(existing || '');
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 20,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 20, padding: 24,
        width: '100%', maxWidth: 480,
      }}>
        <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>⚠️</div>
        <h3 style={{ margin: 0, textAlign: 'center', color: '#dc2626' }}>呢星期練得唔夠</h3>
        <p style={{ textAlign: 'center', color: '#64748b', margin: '8px 0 20px', fontSize: 14 }}>
          {monthLabel} · 只練咗 <b style={{ color: '#dc2626' }}>{workoutCount}</b>/{WEEKLY_TARGET} 日<br />
          記錄原因，之後翻返睇提醒自己
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. 感冒發燒 / 加班 / 出 trip / 純粹懶..."
          rows={4}
          autoFocus
          style={{
            width: '100%', padding: 12, borderRadius: 10,
            border: '1px solid #e2e8f0', fontSize: 14, resize: 'vertical',
            fontFamily: 'inherit', outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, padding: 12, background: '#f1f5f9', color: '#334155', border: 'none', borderRadius: 10, fontWeight: 600, cursor: 'pointer' }}>之後再填</button>
          <button onClick={() => onSave(reason)} disabled={!reason.trim()} style={{ flexGrow: 2, flexBasis: 0, minWidth: 0, padding: 12, background: reason.trim() ? '#3b82f6' : '#cbd5e1', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, cursor: reason.trim() ? 'pointer' : 'not-allowed' }}>💾 記錄原因</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Monthly Summary
// ═══════════════════════════════════════════════════════════
function MonthlySummary({ monthKey, monthLabel, plan, logs }) {
  const monthLogs = Object.entries(logs).filter(([dateKey]) => dateKey.startsWith(monthKey));

  const perDayType = {};
  Object.keys(plan).forEach((k) => { perDayType[k] = 0; });
  let workoutCount = 0;
  let restCount = 0;

  let plannedCount = 0;
  monthLogs.forEach(([, log]) => {
    if (logStatus(log) !== 'done') {
      plannedCount++;
      return;
    }
    if (log.type === 'workout') {
      workoutCount++;
      if (log.dayKey && perDayType.hasOwnProperty(log.dayKey)) {
        perDayType[log.dayKey]++;
      }
    } else if (log.type === 'rest') {
      restCount++;
    }
  });

  return (
    <div style={{
      background: '#fff', borderRadius: 16, padding: 20, marginBottom: 20,
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
    }}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>📊 {monthLabel} 月度總結</h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
        <div style={{ background: '#ecfdf5', padding: 14, borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: '#065f46', fontWeight: 700 }}>總打卡</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#10b981' }}>{workoutCount} <span style={{ fontSize: 14 }}>日</span></div>
        </div>
        <div style={{ background: '#fef3c7', padding: 14, borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: '#92400e', fontWeight: 700 }}>休息日</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#d97706' }}>{restCount} <span style={{ fontSize: 14 }}>日</span></div>
        </div>
      </div>

      <div style={{ background: '#f8fafc', padding: 14, borderRadius: 10, border: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700, marginBottom: 10 }}>各訓練日分佈</div>
        {Object.entries(plan).map(([k, d]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 13, color: '#334155' }}>{d.name}</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: perDayType[k] > 0 ? '#0f172a' : '#94a3b8' }}>{perDayType[k]} 次</span>
          </div>
        ))}
      </div>

      {monthLogs.length === 0 && (
        <p style={{ textAlign: 'center', color: '#94a3b8', margin: '12px 0 0', fontSize: 13 }}>呢個月未有記錄</p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Sync status badge
// ═══════════════════════════════════════════════════════════
function SyncBadge({ status, lastSyncedAt }) {
  const config = {
    loading:  { bg: '#f1f5f9', color: '#64748b', text: '⏳ 載入中...' },
    saving:   { bg: '#fef3c7', color: '#92400e', text: '💾 同步中...' },
    synced:   { bg: '#ecfdf5', color: '#065f46', text: '✅ 已同步' },
    error:    { bg: '#fef2f2', color: '#991b1b', text: '⚠️ 同步失敗' },
    offline:  { bg: '#fef3c7', color: '#92400e', text: '📡 離線模式' },
  }[status] || { bg: '#f1f5f9', color: '#64748b', text: status };
  return (
    <span
      title={lastSyncedAt ? `最後同步:${new Date(lastSyncedAt).toLocaleString()}` : ''}
      style={{
        display: 'inline-block',
        padding: '6px 10px',
        borderRadius: 8,
        background: config.bg,
        color: config.color,
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {config.text}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════
// Main Dashboard
// ═══════════════════════════════════════════════════════════
function Dashboard({ onLock }) {
  const [plan, setPlan] = useState(() => {
    const stored = loadJSON(LS_PLAN, DEFAULT_PLAN);
    // 補 short field 舊資料
    const patched = { ...stored };
    Object.keys(patched).forEach((k) => {
      if (!patched[k].short && patched[k].name) {
        patched[k].short = patched[k].name.replace(/訓練日|練日|日/g, '').slice(0, 2) || patched[k].name.slice(0, 2);
      }
    });
    return patched;
  });
  const [logs, setLogs] = useState(() => loadJSON(LS_LOGS, {}));
  const [reasons, setReasons] = useState(() => loadJSON(LS_REASONS, {}));

  const [checkInDate, setCheckInDate] = useState(null);
  const [showPlanEditor, setShowPlanEditor] = useState(false);
  const [reasonWeek, setReasonWeek] = useState(null);
  const [viewMonthOffset, setViewMonthOffset] = useState(0);
  const [planExpanded, setPlanExpanded] = useState(false);

  // ─── Sync ─────────────────────────────────────────────
  // status: 'loading' | 'synced' | 'saving' | 'error' | 'offline'
  const [syncStatus, setSyncStatus] = useState('loading');
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const initialLoadDone = useRef(false);
  const saveTimer = useRef(null);

  // 首次載入:由 backend 拎最新資料 覆蓋 localStorage
  useEffect(() => {
    (async () => {
      try {
        const data = await apiGetGym();
        // Backend 可能返回 empty {} plan — 保留現有 (DEFAULT_PLAN / localStorage)
        if (data.plan && Object.keys(data.plan).length > 0) setPlan(data.plan);
        if (data.logs) setLogs(data.logs);
        if (data.reasons) setReasons(data.reasons);
        setLastSyncedAt(data.updated_at);
        setSyncStatus('synced');
      } catch (e) {
        console.warn('Gym sync fetch fail, using localStorage:', e);
        setSyncStatus('offline');
      } finally {
        initialLoadDone.current = true;
      }
    })();
  }, []);

  // Debounced save 落 backend + localStorage
  useEffect(() => {
    saveJSON(LS_PLAN, plan);
    saveJSON(LS_LOGS, logs);
    saveJSON(LS_REASONS, reasons);

    if (!initialLoadDone.current) return; // 唔好 push 初始 default state
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSyncStatus('saving');
    saveTimer.current = setTimeout(async () => {
      try {
        const res = await apiSaveGym({ plan, logs, reasons });
        setLastSyncedAt(res.row?.updated_at || new Date().toISOString());
        setSyncStatus('synced');
      } catch (e) {
        console.warn('Gym sync save fail:', e);
        setSyncStatus('error');
      }
    }, 500);
    return () => saveTimer.current && clearTimeout(saveTimer.current);
  }, [plan, logs, reasons]);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // 現時 view 緊嘅月份
  const viewMonth = useMemo(() => {
    return new Date(today.getFullYear(), today.getMonth() + viewMonthOffset, 1);
  }, [today, viewMonthOffset]);

  const monthGrid = useMemo(() => getMonthGrid(viewMonth.getFullYear(), viewMonth.getMonth()), [viewMonth]);
  const monthLabel = `${viewMonth.getFullYear()} 年 ${viewMonth.getMonth() + 1} 月`;
  const monthKey = getMonthKey(viewMonth);

  // 本星期(今日所在星期)進度 — 只 count status='done'
  const thisWeekStart = useMemo(() => getWeekStart(today), [today]);
  const thisWeekDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(thisWeekStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }, [thisWeekStart]);
  const thisWeekWorkouts = thisWeekDays.filter((d) => {
    const l = logs[toDateKey(d)];
    return l?.type === 'workout' && logStatus(l) === 'done';
  }).length;

  // 呢個月已完成/剩餘計 (顯示喺 header)
  const monthDoneWorkouts = monthGrid.filter((d) => {
    if (d.getMonth() !== viewMonth.getMonth()) return false;
    const l = logs[toDateKey(d)];
    return l?.type === 'workout' && logStatus(l) === 'done';
  }).length;
  const monthPlannedWorkouts = monthGrid.filter((d) => {
    if (d.getMonth() !== viewMonth.getMonth()) return false;
    const l = logs[toDateKey(d)];
    return l?.type === 'workout' && logStatus(l) === 'planned';
  }).length;
  const monthRestDays = monthGrid.filter((d) => {
    if (d.getMonth() !== viewMonth.getMonth()) return false;
    const l = logs[toDateKey(d)];
    return l?.type === 'rest' && logStatus(l) === 'done';
  }).length;

  // 過去嘅星期(該月內)如果 done < target 就標記
  const pastWeeksInMonth = useMemo(() => {
    const weeks = [];
    const seen = new Set();
    for (const d of monthGrid) {
      if (d.getMonth() !== viewMonth.getMonth()) continue;
      const wStart = getWeekStart(d);
      const wKey = toDateKey(wStart);
      if (seen.has(wKey)) continue;
      seen.add(wKey);
      const wEnd = new Date(wStart);
      wEnd.setDate(wEnd.getDate() + 6);
      wEnd.setHours(23, 59, 59, 999);
      if (wEnd >= today) continue; // 未過完就唔判
      const wDays = [];
      for (let i = 0; i < 7; i++) {
        const wd = new Date(wStart);
        wd.setDate(wd.getDate() + i);
        wDays.push(wd);
      }
      const done = wDays.filter((wd) => {
        const l = logs[toDateKey(wd)];
        return l?.type === 'workout' && logStatus(l) === 'done';
      }).length;
      if (done < WEEKLY_TARGET) {
        weeks.push({ ident: wKey, start: wStart, end: wEnd, done });
      }
    }
    return weeks;
  }, [monthGrid, viewMonth, logs, today]);

  const saveLog = (dateKey, log) => {
    setLogs({ ...logs, [dateKey]: log });
    setCheckInDate(null);
  };
  const deleteLog = (dateKey) => {
    const newLogs = { ...logs };
    delete newLogs[dateKey];
    setLogs(newLogs);
    setCheckInDate(null);
  };

  return (
    <div className="page-content" style={{ maxWidth: 920, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 28 }}>🏋️ 健身打卡</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 14 }}>目標:每星期練 {WEEKLY_TARGET}-4 日</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SyncBadge status={syncStatus} lastSyncedAt={lastSyncedAt} />
          <button onClick={onLock} style={{ background: 'transparent', border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 13, color: '#64748b' }}>🔒 鎖定</button>
        </div>
      </div>

      {/* Month nav + calendar */}
      <div style={{ background: '#fff', borderRadius: 16, padding: 20, marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <button onClick={() => setViewMonthOffset(viewMonthOffset - 1)} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 15 }}>◀</button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 20 }}>{monthLabel}</div>
          </div>
          <button onClick={() => setViewMonthOffset(viewMonthOffset + 1)} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 15 }}>▶</button>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, background: '#ecfdf5', padding: 12, borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#10b981' }}>{monthDoneWorkouts}</div>
            <div style={{ fontSize: 12, color: '#065f46' }}>本月已練</div>
          </div>
          <div style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, background: '#eff6ff', padding: 12, borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#1d4ed8' }}>{monthPlannedWorkouts}</div>
            <div style={{ fontSize: 12, color: '#1e3a8a' }}>已安排</div>
          </div>
          <div style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, background: '#fef3c7', padding: 12, borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#d97706' }}>{monthRestDays}</div>
            <div style={{ fontSize: 12, color: '#92400e' }}>休息</div>
          </div>
        </div>

        {/* 本週進度 mini */}
        {viewMonthOffset === 0 && (
          <div style={{ marginBottom: 14, padding: 10, background: thisWeekWorkouts >= WEEKLY_TARGET ? '#dbeafe' : '#fff7ed', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
            <span style={{ color: thisWeekWorkouts >= WEEKLY_TARGET ? '#1e3a8a' : '#7c2d12', fontWeight: 600 }}>
              📅 本週已練 <b style={{ fontSize: 16 }}>{thisWeekWorkouts}</b> / {WEEKLY_TARGET}-4 日
            </span>
            <span style={{ fontSize: 11, color: '#64748b' }}>{toDateKey(thisWeekDays[0])} → {toDateKey(thisWeekDays[6])}</span>
          </div>
        )}

        {/* Month grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
          {['一','二','三','四','五','六','日'].map((n, i) => (
            <div key={i} style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8', fontWeight: 700, marginBottom: 4 }}>{n}</div>
          ))}
          {monthGrid.map((d) => {
            const key = toDateKey(d);
            const log = logs[key];
            const isToday = key === toDateKey(today);
            const isCurrentMonth = d.getMonth() === viewMonth.getMonth();
            const status = logStatus(log);
            const isPlanned = status === 'planned';

            // 跨月嘅 cell 用透明佔位,keep grid alignment
            if (!isCurrentMonth) {
              return <div key={key} style={{ aspectRatio: '1' }} />;
            }

            let bg = '#fff';
            let fg = '#334155';
            let border = '1px solid #e2e8f0';
            if (log?.type === 'workout' && status === 'done') { bg = '#10b981'; fg = '#fff'; }
            else if (log?.type === 'rest' && status === 'done') { bg = '#f59e0b'; fg = '#fff'; }
            else if (log?.type === 'workout' && isPlanned) { bg = '#d1fae5'; fg = '#065f46'; border = '1px dashed #10b981'; }
            else if (log?.type === 'rest' && isPlanned) { bg = '#fef3c7'; fg = '#92400e'; border = '1px dashed #f59e0b'; }

            if (isToday) border = '2px solid #0f172a';

            const label = log?.type === 'workout' ? (plan[log.dayKey]?.short || '訓練')
              : log?.type === 'rest' ? '休息'
              : '';

            return (
              <button
                key={key}
                onClick={() => setCheckInDate(key)}
                style={{
                  aspectRatio: '1', background: bg, color: fg, border,
                  borderRadius: 10, padding: 4, cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 2, position: 'relative',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700 }}>{d.getDate()}</div>
                {label && <div style={{ fontSize: 10, fontWeight: 600, textAlign: 'center', lineHeight: 1.1 }}>{label}</div>}
                {isPlanned && <div style={{ position: 'absolute', top: 2, right: 3, fontSize: 9 }}>📅</div>}
              </button>
            );
          })}
        </div>

        {/* 圖例 */}
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11, color: '#64748b' }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#10b981', borderRadius: 3, verticalAlign: 'middle', marginRight: 4 }} />已打卡</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#f59e0b', borderRadius: 3, verticalAlign: 'middle', marginRight: 4 }} />休息</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#d1fae5', border: '1px dashed #10b981', borderRadius: 3, verticalAlign: 'middle', marginRight: 4 }} />已安排 📅</span>
        </div>

        {/* 過去未達標星期 */}
        {pastWeeksInMonth.length > 0 && (
          <div style={{ marginTop: 16 }}>
            {pastWeeksInMonth.map((w) => (
              <div key={w.ident} style={{ marginBottom: 8, padding: 10, background: reasons[w.ident] ? '#f0fdf4' : '#fef2f2', borderRadius: 8, border: `1px solid ${reasons[w.ident] ? '#bbf7d0' : '#fecaca'}` }}>
                {reasons[w.ident] ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#166534' }}>📝 {toDateKey(w.start)} → {toDateKey(w.end)} · 只練 {w.done}/{WEEKLY_TARGET}</div>
                      <div style={{ fontSize: 13, color: '#14532d', marginTop: 2 }}>{reasons[w.ident]}</div>
                    </div>
                    <button onClick={() => setReasonWeek(w.ident)} style={{ background: 'transparent', border: 'none', color: '#059669', cursor: 'pointer', fontSize: 12 }}>編輯</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 12, color: '#7f1d1d' }}>⚠️ {toDateKey(w.start)} → {toDateKey(w.end)} 只練 {w.done}/{WEEKLY_TARGET}</div>
                    <button onClick={() => setReasonWeek(w.ident)} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>填原因</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Today card */}
      {(() => {
        const todayKey = toDateKey(today);
        const todayLog = logs[todayKey];
        if (!todayLog) return null;
        const todayPlan = todayLog.type === 'workout' ? plan[todayLog.dayKey] : null;

        return (
          <div style={{ background: '#fff', borderRadius: 16, padding: 20, marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700, marginBottom: 4 }}>今日 · {todayKey}</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>
                  {todayLog.type === 'workout' ? (todayPlan?.name || '訓練') : '休息日'}
                </div>
                {todayLog.note && (
                  <div style={{ marginTop: 8, color: '#475569', fontSize: 13 }}>{todayLog.note}</div>
                )}
              </div>
              <button onClick={() => setCheckInDate(todayKey)} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>編輯</button>
            </div>

            {todayPlan && (
              <div style={{ marginTop: 16, background: '#f8fafc', padding: 16, borderRadius: 12, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700, marginBottom: 10 }}>今日訓練內容</div>
                <ol style={{ margin: 0, paddingLeft: 22, fontSize: 13.5, color: '#334155', lineHeight: 1.7 }}>
                  {todayPlan.exercises.map((ex, i) => <li key={i}>{ex}</li>)}
                </ol>
              </div>
            )}
          </div>
        );
      })()}

      {/* Monthly summary */}
      <MonthlySummary monthKey={monthKey} monthLabel={monthLabel} plan={plan} logs={logs} />

      {/* Training plan (collapsible) */}
      <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            onClick={() => setPlanExpanded(!planExpanded)}
            style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <h3 style={{ margin: 0 }}>📋 完整訓練計劃</h3>
            <span style={{ color: '#94a3b8', fontSize: 14, transition: 'transform 0.2s', display: 'inline-block', transform: planExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
          </button>
          <button onClick={() => setShowPlanEditor(true)} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>✏️ 編輯</button>
        </div>
        {planExpanded && (
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            {Object.entries(plan).map(([k, d]) => (
              <div key={k} style={{ background: '#f8fafc', padding: 14, borderRadius: 12, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 10 }}>
                  {d.name} <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 500 }}>({k})</span>
                </div>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, color: '#475569', lineHeight: 1.6 }}>
                  {d.exercises.map((ex, i) => <li key={i}>{ex}</li>)}
                </ol>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {checkInDate && (
        <CheckInModal
          dateKey={checkInDate}
          plan={plan}
          existingLog={logs[checkInDate]}
          today={today}
          onSave={saveLog}
          onDelete={deleteLog}
          onClose={() => setCheckInDate(null)}
        />
      )}
      {showPlanEditor && (
        <PlanEditorModal
          plan={plan}
          onSave={(p) => { setPlan(p); setShowPlanEditor(false); }}
          onClose={() => setShowPlanEditor(false)}
        />
      )}
      {reasonWeek && (() => {
        const w = pastWeeksInMonth.find((x) => x.ident === reasonWeek);
        return (
          <ReasonModal
            weekKey={reasonWeek}
            monthLabel={monthLabel}
            workoutCount={w?.done ?? 0}
            existing={reasons[reasonWeek]}
            onSave={(r) => { setReasons({ ...reasons, [reasonWeek]: r }); setReasonWeek(null); }}
            onClose={() => setReasonWeek(null)}
          />
        );
      })()}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Root export
// ═══════════════════════════════════════════════════════════
export default function GymCheckIn() {
  const [unlocked, setUnlocked] = useState(() => localStorage.getItem(LS_UNLOCK) === 'true');

  const lock = () => {
    localStorage.removeItem(LS_UNLOCK);
    notifyGymAuthChanged();
    setUnlocked(false);
  };

  if (!unlocked) return <PasswordGate onUnlock={() => setUnlocked(true)} />;
  return <Dashboard onLock={lock} />;
}
