import { useState, useEffect, useMemo } from 'react';

const LS_UNLOCK = 'gym_unlocked_v1';
const LS_PLAN = 'gym_plan_v1';
const LS_LOGS = 'gym_logs_v1';
const LS_REASONS = 'gym_week_reasons_v1';
const PASSWORD = '020919';
const WEEKLY_TARGET = 3;

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
function CheckInModal({ dateKey, plan, existingLog, onSave, onDelete, onClose }) {
  const [type, setType] = useState(existingLog?.type || '');
  const [dayKey, setDayKey] = useState(existingLog?.dayKey || '');
  const [note, setNote] = useState(existingLog?.note || '');

  const canSave = type === 'rest' || (type === 'workout' && dayKey);

  const save = () => {
    if (!canSave) return;
    const log = { type, note };
    if (type === 'workout') log.dayKey = dayKey;
    onSave(dateKey, log);
  };

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>{dateKey}</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 24, cursor: 'pointer', color: '#64748b' }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            onClick={() => setType('workout')}
            style={{
              flex: 1, padding: '14px', borderRadius: 12,
              background: type === 'workout' ? '#3b82f6' : '#f1f5f9',
              color: type === 'workout' ? '#fff' : '#334155',
              border: 'none', fontWeight: 700, fontSize: 15, cursor: 'pointer',
            }}
          >已打卡</button>
          <button
            onClick={() => { setType('rest'); setDayKey(''); }}
            style={{
              flex: 1, padding: '14px', borderRadius: 12,
              background: type === 'rest' ? '#f59e0b' : '#f1f5f9',
              color: type === 'rest' ? '#fff' : '#334155',
              border: 'none', fontWeight: 700, fontSize: 15, cursor: 'pointer',
            }}
          >休息日</button>
        </div>

        {type === 'workout' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: '#64748b', fontWeight: 600, marginBottom: 8 }}>練咩？</div>
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

        <button onClick={save} disabled={!canSave} style={{
          marginTop: 16, width: '100%', padding: 14,
          background: canSave ? '#10b981' : '#cbd5e1',
          color: '#fff', border: 'none', borderRadius: 12,
          fontWeight: 700, fontSize: 16, cursor: canSave ? 'pointer' : 'not-allowed',
        }}>儲存</button>

        {existingLog && (
          <button onClick={() => onDelete(dateKey)} style={{
            marginTop: 8, width: '100%', padding: 12,
            background: '#fef2f2', color: '#dc2626',
            border: '1px solid #fecaca', borderRadius: 10,
            fontWeight: 600, fontSize: 14, cursor: 'pointer',
          }}>🗑️ 清除呢日打卡</button>
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
                style={{ flex: 2, padding: 8, border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, fontWeight: 700, outline: 'none' }}
              />
              <input
                value={d.short || ''}
                onChange={(e) => updateField(dayKey, 'short', e.target.value)}
                placeholder="簡稱（例:胸部）"
                maxLength={4}
                style={{ flex: 1, padding: 8, border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, outline: 'none' }}
              />
            </div>
            {d.exercises.map((ex, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input
                  value={ex}
                  onChange={(e) => updateExercise(dayKey, idx, e.target.value)}
                  style={{ flex: 1, padding: 8, border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, outline: 'none' }}
                />
                <button onClick={() => delExercise(dayKey, idx)} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 8, padding: '0 10px', cursor: 'pointer', fontSize: 16 }}>−</button>
              </div>
            ))}
            <button onClick={() => addExercise(dayKey)} style={{ marginTop: 4, background: '#dbeafe', color: '#1d4ed8', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>+ 加動作</button>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 14, background: '#f1f5f9', color: '#334155', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>取消</button>
          <button onClick={() => onSave(draft)} style={{ flex: 2, padding: 14, background: '#10b981', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>💾 儲存</button>
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
          <button onClick={onClose} style={{ flex: 1, padding: 12, background: '#f1f5f9', color: '#334155', border: 'none', borderRadius: 10, fontWeight: 600, cursor: 'pointer' }}>之後再填</button>
          <button onClick={() => onSave(reason)} disabled={!reason.trim()} style={{ flex: 2, padding: 12, background: reason.trim() ? '#3b82f6' : '#cbd5e1', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, cursor: reason.trim() ? 'pointer' : 'not-allowed' }}>💾 記錄原因</button>
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

  monthLogs.forEach(([, log]) => {
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
  const [viewWeekOffset, setViewWeekOffset] = useState(0);
  const [planExpanded, setPlanExpanded] = useState(false);

  useEffect(() => saveJSON(LS_PLAN, plan), [plan]);
  useEffect(() => saveJSON(LS_LOGS, logs), [logs]);
  useEffect(() => saveJSON(LS_REASONS, reasons), [reasons]);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const weekStart = useMemo(() => {
    const w = getWeekStart(today);
    w.setDate(w.getDate() + viewWeekOffset * 7);
    return w;
  }, [today, viewWeekOffset]);

  const weekDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }, [weekStart]);

  const monthLabel = getMonthLabel(weekStart);
  const monthKey = getMonthKey(getWeekThursday(weekStart));
  // 用 monthLabel+start date 做 unique week identifier (for reasons)
  const weekIdent = `${toDateKey(weekDays[0])}`;
  const workoutCount = weekDays.filter((d) => logs[toDateKey(d)]?.type === 'workout').length;
  const restCount = weekDays.filter((d) => logs[toDateKey(d)]?.type === 'rest').length;
  const isPastWeek = weekStart < getWeekStart(today);

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
    <div style={{ maxWidth: 920, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 28 }}>🏋️ 健身打卡</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 14 }}>目標:每星期練 {WEEKLY_TARGET}-4 日</p>
        </div>
        <button onClick={onLock} style={{ background: 'transparent', border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 13, color: '#64748b' }}>🔒 鎖定</button>
      </div>

      {/* Week nav + calendar */}
      <div style={{ background: '#fff', borderRadius: 16, padding: 20, marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <button onClick={() => setViewWeekOffset(viewWeekOffset - 1)} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 15 }}>◀</button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{monthLabel}</div>
            <div style={{ color: '#64748b', fontSize: 12 }}>{toDateKey(weekDays[0])} → {toDateKey(weekDays[6])}</div>
          </div>
          <button onClick={() => setViewWeekOffset(viewWeekOffset + 1)} disabled={viewWeekOffset >= 0} style={{ background: viewWeekOffset >= 0 ? '#f8fafc' : '#f1f5f9', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: viewWeekOffset >= 0 ? 'not-allowed' : 'pointer', fontSize: 15, opacity: viewWeekOffset >= 0 ? 0.4 : 1 }}>▶</button>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1, background: '#ecfdf5', padding: 12, borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#10b981' }}>{workoutCount}</div>
            <div style={{ fontSize: 12, color: '#065f46' }}>已打卡</div>
          </div>
          <div style={{ flex: 1, background: '#fef3c7', padding: 12, borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#d97706' }}>{restCount}</div>
            <div style={{ fontSize: 12, color: '#92400e' }}>休息日</div>
          </div>
          <div style={{ flex: 1, background: workoutCount >= WEEKLY_TARGET ? '#dbeafe' : '#fee2e2', padding: 12, borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: workoutCount >= WEEKLY_TARGET ? '#1d4ed8' : '#dc2626' }}>{workoutCount}/{WEEKLY_TARGET}</div>
            <div style={{ fontSize: 12, color: workoutCount >= WEEKLY_TARGET ? '#1e3a8a' : '#7f1d1d' }}>目標</div>
          </div>
        </div>

        {/* Week grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
          {['一','二','三','四','五','六','日'].map((n, i) => (
            <div key={i} style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8', fontWeight: 700, marginBottom: 4 }}>{n}</div>
          ))}
          {weekDays.map((d) => {
            const key = toDateKey(d);
            const log = logs[key];
            const isToday = key === toDateKey(today);
            const isFuture = d > today;
            const bg = log?.type === 'workout' ? '#10b981'
              : log?.type === 'rest' ? '#f59e0b'
              : isFuture ? '#f8fafc'
              : '#fff';
            const fg = log ? '#fff' : isFuture ? '#cbd5e1' : '#334155';
            const label = log?.type === 'workout' ? (plan[log.dayKey]?.short || '訓練')
              : log?.type === 'rest' ? '休息日'
              : '';
            return (
              <button
                key={key}
                onClick={() => !isFuture && setCheckInDate(key)}
                disabled={isFuture}
                style={{
                  aspectRatio: '1', background: bg, color: fg,
                  border: isToday ? '2px solid #0f172a' : '1px solid #e2e8f0',
                  borderRadius: 10, padding: 4, cursor: isFuture ? 'not-allowed' : 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 2, transition: 'transform 0.1s',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700 }}>{d.getDate()}</div>
                {label && <div style={{ fontSize: 10, fontWeight: 600, textAlign: 'center', lineHeight: 1.1 }}>{label}</div>}
              </button>
            );
          })}
        </div>

        {/* Week reason */}
        {isPastWeek && workoutCount < WEEKLY_TARGET && (
          <div style={{ marginTop: 16, padding: 12, background: reasons[weekIdent] ? '#f0fdf4' : '#fef2f2', borderRadius: 10, border: `1px solid ${reasons[weekIdent] ? '#bbf7d0' : '#fecaca'}` }}>
            {reasons[weekIdent] ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#166534', marginBottom: 4 }}>📝 未達標原因</div>
                  <div style={{ fontSize: 13, color: '#14532d' }}>{reasons[weekIdent]}</div>
                </div>
                <button onClick={() => setReasonWeek(weekIdent)} style={{ background: 'transparent', border: 'none', color: '#059669', cursor: 'pointer', fontSize: 12 }}>編輯</button>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 13, color: '#7f1d1d' }}>⚠️ 呢星期練得唔夠 3-4 日,填返個原因</div>
                <button onClick={() => setReasonWeek(weekIdent)} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>填原因</button>
              </div>
            )}
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
      {reasonWeek && (
        <ReasonModal
          weekKey={reasonWeek}
          monthLabel={monthLabel}
          workoutCount={workoutCount}
          existing={reasons[reasonWeek]}
          onSave={(r) => { setReasons({ ...reasons, [reasonWeek]: r }); setReasonWeek(null); }}
          onClose={() => setReasonWeek(null)}
        />
      )}
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
