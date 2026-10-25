(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const IMG_EXT = ['jpg', 'png', 'webp', 'gif', 'jpeg'];
  const today = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD（本地時區）

  /* ---------- 儲存（可能不可用，全部包 try） ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('fit:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('fit:' + k, JSON.stringify(v)); } catch { /* 忽略 */ } },
  };

  /* ---------- 圖片：依序試多個副檔名，最後用佔位圖 ---------- */
  const placeholder = (label) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
      <rect width="640" height="480" fill="#e9ecf1"/>
      <g fill="none" stroke="#98a2b3" stroke-width="10" stroke-linecap="round">
        <path d="M210 240h220M210 205v70M430 205v70M180 220v40M460 220v40"/></g>
      <text x="320" y="340" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#667085">${label}</text>
      <text x="320" y="376" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#98a2b3">（待加入效果圖）</text></svg>`);
  window.__imgFail = (img) => {
    const i = (+img.dataset.i || 0) + 1;
    if (i < IMG_EXT.length) { img.dataset.i = i; img.src = `${img.dataset.base}.${IMG_EXT[i]}`; }
    else { img.onerror = null; img.src = placeholder(img.alt); }
  };
  const imgTag = (dir, id, alt) =>
    `<img loading="lazy" alt="${alt}" data-base="assets/${dir}/${id}" data-i="0" src="assets/${dir}/${id}.${IMG_EXT[0]}" onerror="__imgFail(this)">`;

  /* ---------- 個人資料 ---------- */
  const P = { sex: 'm', age: 25, height: 170, weight: 65, activity: 1.55, goal: 'muscle' };
  const fields = ['sex', 'age', 'height', 'weight', 'activity', 'goal'];
  Object.assign(P, store.get('profile', {}));
  fields.forEach(f => { const el = $('#' + f); if (el) el.value = P[f]; });

  function readProfile() {
    const err = [];
    const num = (id, lo, hi, name) => {
      const v = parseFloat($('#' + id).value);
      if (!(v >= lo && v <= hi)) { err.push(`${name}需介乎 ${lo}–${hi}`); return null; }
      return v;
    };
    const age = num('age', 12, 100, '年齡'), height = num('height', 100, 250, '身高'), weight = num('weight', 25, 300, '體重');
    const box = $('#profile-err');
    box.hidden = !err.length; box.className = 'note err'; box.textContent = err.join('；');
    if (err.length) return null;
    return { sex: $('#sex').value, age, height, weight, activity: +$('#activity').value, goal: $('#goal').value };
  }

  /* ---------- 計算 ---------- */
  const calc = {
    bmi: (h, w) => w / Math.pow(h / 100, 2),
    // 香港衛生署（亞洲成年人）
    bmiCat(b) {
      if (b < 18.5) return ['過輕', 0];
      if (b < 23) return ['適中', 1];
      if (b < 25) return ['過重', 2];
      if (b < 30) return ['肥胖', 3];
      return ['嚴重肥胖', 4];
    },
    bmr: (p) => 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161), // Mifflin-St Jeor
    targetKcal(p, bmr, tdee) {
      if (p.goal === 'muscle') return Math.round(tdee * 1.1);
      if (p.goal === 'fatloss') return Math.round(Math.max(tdee * 0.8, bmr));
      return Math.round(tdee);
    },
    protein(p) { // g/kg 範圍：[最低, 目標, 上限]
      const r = { maintain: [1.2, 1.4, 1.6], muscle: [1.6, 1.8, 2.2], fatloss: [1.8, 2.0, 2.2] }[p.goal];
      return r.map(x => Math.round(x * p.weight));
    },
    water: (p, exH) => Math.round((p.weight * 35 + exH * 500) / 50) * 50,
  };
  window.__calc = calc; // 方便在 console 核對

  // 將 BMI 對應到色條位置（15 → 0%，35 → 100%）
  const bmiPos = (b) => Math.min(100, Math.max(0, (b - 15) / 20 * 100));

  let cur = null;
  function renderBody() {
    cur = readProfile();
    if (!cur) return;
    store.set('profile', cur);
    const bmi = calc.bmi(cur.height, cur.weight), [cat] = calc.bmiCat(bmi);
    $('#bmi-val').textContent = bmi.toFixed(1);
    $('#bmi-cat').textContent = cat;
    $('#bmi-pin').style.left = bmiPos(bmi) + '%';
    const h2 = Math.pow(cur.height / 100, 2);
    $('#bmi-range').textContent = `以你嘅身高，BMI 適中範圍（18.5–22.9）對應體重約 ${(18.5 * h2).toFixed(1)}–${(22.9 * h2).toFixed(1)} kg。`;

    const bmr = calc.bmr(cur), tdee = bmr * cur.activity, tk = calc.targetKcal(cur, bmr, tdee);
    $('#bmr').textContent = Math.round(bmr);
    $('#tdee').textContent = Math.round(tdee);
    $('#target-kcal').textContent = tk;
    $('#kcal-note').textContent = {
      muscle: '增肌：TDEE +10%，輕微盈餘，減少脂肪增加。',
      fatloss: '減脂：TDEE −20%（不低於基礎代謝），預計每週約減 0.4–0.6 kg。',
      maintain: '維持：攝取等於消耗。',
    }[cur.goal];

    const [pmin, ptar, pmax] = calc.protein(cur);
    $('#p-min').textContent = pmin; $('#p-target').textContent = ptar; $('#p-max').textContent = pmax;
    $('#p-note').textContent = `以體重 ${cur.weight} kg 計，目標約 ${(ptar / cur.weight).toFixed(1)} g/kg。`;
    const meals = [['早餐', .25], ['午餐', .3], ['晚餐', .3], ['加餐／練後', .15]];
    $('#p-meals').innerHTML = meals.map(([n, r]) => `<div>${n}<b>${Math.round(ptar * r)} g</b></div>`).join('');

    renderFood(); renderWater();
  }

  /* ---------- 食物 ---------- */
  let foodLog = store.get('food:' + today(), []);
  const foodSel = $('#food-select');
  function fillFoodSelect(q = '') {
    const list = FOODS.filter(f => !q || (f.name + f.cat).includes(q));
    foodSel.innerHTML = list.length
      ? list.map(f => `<option value="${f.id}">${f.name}｜${f.cat}</option>`).join('')
      : '<option value="">搵唔到相關食物</option>';
    syncGrams();
  }
  function syncGrams() {
    const f = FOODS.find(x => x.id === foodSel.value);
    if (f) { $('#food-grams').value = f.unit; previewFood(); } else { $('#food-preview').textContent = ''; }
  }
  function nutri(f, g) { return { p: f.p * g / 100, k: f.k * g / 100 }; }
  function previewFood() {
    const f = FOODS.find(x => x.id === foodSel.value), g = parseFloat($('#food-grams').value);
    if (!f || !(g > 0)) { $('#food-preview').textContent = ''; return; }
    const n = nutri(f, g);
    $('#food-preview').textContent = `${g} g → 蛋白質 ${n.p.toFixed(1)} g · ${Math.round(n.k)} kcal`;
  }
  function renderFood() {
    const tk = cur ? calc.targetKcal(cur, calc.bmr(cur), calc.bmr(cur) * cur.activity) : 0;
    const pg = cur ? calc.protein(cur)[1] : 0;
    let tp = 0, tkc = 0;
    $('#food-list').innerHTML = foodLog.map((it, i) => {
      const f = FOODS.find(x => x.id === it.id); if (!f) return '';
      const n = nutri(f, it.g); tp += n.p; tkc += n.k;
      return `<li><div class="nm">${f.name}<small>${it.g} g · 蛋白質 ${n.p.toFixed(1)} g · ${Math.round(n.k)} kcal</small></div>
        <button type="button" data-del="${i}" aria-label="刪除">×</button></li>`;
    }).join('');
    $('#food-empty').hidden = foodLog.length > 0;
    $('#food-p').textContent = tp.toFixed(1); $('#food-k').textContent = Math.round(tkc);
    $('#food-p-goal').textContent = pg || '–'; $('#food-k-goal').textContent = tk || '–';
    const bar = (id, v, goal) => { const el = $(id); el.style.width = Math.min(100, goal ? v / goal * 100 : 0) + '%'; el.classList.toggle('over', goal && v > goal * 1.05); };
    bar('#food-p-bar', tp, pg); bar('#food-k-bar', tkc, tk);
    $('#food-p-left').textContent = pg ? (tp >= pg ? '已達標 ✓' : `仲差 ${(pg - tp).toFixed(0)} g`) : '';
    $('#food-k-left').textContent = tk ? (tkc > tk * 1.05 ? `超出 ${Math.round(tkc - tk)} kcal` : `仲有 ${Math.max(0, Math.round(tk - tkc))} kcal`) : '';
  }
  $('#food-search').addEventListener('input', e => fillFoodSelect(e.target.value.trim()));
  foodSel.addEventListener('change', syncGrams);
  $('#food-grams').addEventListener('input', previewFood);
  $('#food-add').addEventListener('click', () => {
    const g = parseFloat($('#food-grams').value);
    if (!foodSel.value || !(g > 0 && g <= 5000)) return;
    foodLog.push({ id: foodSel.value, g }); store.set('food:' + today(), foodLog); renderFood();
  });
  $('#food-list').addEventListener('click', e => {
    const i = e.target.dataset.del; if (i === undefined) return;
    foodLog.splice(+i, 1); store.set('food:' + today(), foodLog); renderFood();
  });
  $('#food-clear').addEventListener('click', () => {
    if (foodLog.length && confirm('清空今日所有食物記錄？')) { foodLog = []; store.set('food:' + today(), foodLog); renderFood(); }
  });

  /* ---------- 水量 ---------- */
  let waterMl = store.get('water:' + today(), 0);
  $('#water-ex').value = store.get('water-ex', 1);
  function renderWater() {
    if (!cur) return;
    const exH = Math.max(0, parseFloat($('#water-ex').value) || 0);
    const goal = calc.water(cur, exH), pct = Math.min(100, Math.round(waterMl / goal * 100));
    $('#water-goal').textContent = goal; $('#water-now').textContent = waterMl;
    $('#water-fill').style.height = pct + '%'; $('#water-pct').textContent = pct + '%';
    $('#water-note').textContent = waterMl >= goal ? '今日目標達成！' : `仲差 ${goal - waterMl} ml（約 ${Math.ceil((goal - waterMl) / 250)} 杯）`;
  }
  $$('[data-water]').forEach(b => b.addEventListener('click', () => {
    waterMl = Math.max(0, waterMl + +b.dataset.water); store.set('water:' + today(), waterMl); renderWater();
  }));
  $('#water-reset').addEventListener('click', () => { waterMl = 0; store.set('water:' + today(), 0); renderWater(); });
  $('#water-ex').addEventListener('input', () => { store.set('water-ex', $('#water-ex').value); renderWater(); });

  /* ---------- 動作卡 ---------- */
  function exCard(id, dose, tag, n) {
    const e = EXERCISES[id]; if (!e) return '';
    return `<article class="ex"><div class="pair">${imgTag('exercises', id + '-1', e.name)}${imgTag('exercises', id + '-2', e.name)}<span class="tag a">起始</span><span class="tag b">完成</span></div>
      <div class="body"><h4>${n ? `<span class="no">${n}</span>` : ''}${e.name}</h4>
      <div class="chips">${dose ? `<span class="dose">${dose}</span>` : ''}${tag ? `<span class="focus">${tag}</span>` : ''}<span>${e.target}</span><span>${e.equip}</span><span>${e.level}</span></div>
      <p>${e.desc}</p>
      <details><summary>動作步驟與常見錯誤</summary>
        <div class="lbl">步驟</div><ol>${e.steps.map(s => `<li>${s}</li>`).join('')}</ol>
        <div class="lbl">常見錯誤</div><ul class="bad">${e.mistakes.map(s => `<li>${s}</li>`).join('')}</ul>
      </details></div></article>`;
  }

  /* ---------- 拉伸 ---------- */
  let stretchMode = 'dynamic';
  function renderStretch() {
    $('#stretch-note').textContent = stretchMode === 'dynamic'
      ? '訓練前 5–10 分鐘：以動態動作提升體溫同關節活動度，不建議在訓練前做長時間靜態拉伸。'
      : '訓練後 5–10 分鐘：每個動作維持 30 秒左右，拉到輕微緊繃但不痛，正常呼吸、唔好彈震。';
    $('#stretch-list').innerHTML = STRETCHES.filter(s => s.mode === stretchMode).map(s =>
      `<article class="ex"><div class="pair">${imgTag('stretches', s.id + '-1', s.name)}${imgTag('stretches', s.id + '-2', s.name)}<span class="tag a">起始</span><span class="tag b">完成</span></div>
        <div class="body"><h4>${s.name}</h4>
        <div class="chips"><span class="dose">${s.dose}</span><span>${s.area}</span></div>
        <p>${s.desc}</p><ul>${s.tips.map(t => `<li>${t}</li>`).join('')}</ul></div></article>`).join('');
  }
  $$('.seg button').forEach(b => b.addEventListener('click', () => {
    $$('.seg button').forEach(x => x.classList.toggle('on', x === b));
    stretchMode = b.dataset.mode; renderStretch();
  }));

  /* ---------- 訓練計劃 ---------- */
  // 每個目標提供嘅訓練日數不同（三分化係 3／6 日），按目標重建選項
  function syncPlanDays(keep) {
    const g = $('#plan-goal').value, sel = $('#plan-days');
    const days = Object.keys(PLANS[g]).filter(k => /^\d+$/.test(k));
    sel.innerHTML = days.map(d => `<option value="${d}">${d} 日</option>`).join('');
    sel.value = days.includes(String(keep)) ? String(keep) : days[0];
  }
  function renderPlan() {
    const g = $('#plan-goal').value, d = $('#plan-days').value;
    store.set('plan', { g, d });
    const plan = PLANS[g][d];
    $('#plan-name').textContent = `${PLANS[g].label}｜${plan.name}`;
    $('#plan-note').textContent = plan.note || '';
    $('#plan-note').hidden = !plan.note;
    $('#plan-days-list').innerHTML = plan.days.map((day, i) =>
      `<div class="day"><h3><em>第 ${i + 1} 日</em>${day.title}</h3>
       <div class="cards">${day.ex.map(([id, dose, tag], n) => exCard(id, dose, tag, n + 1)).join('')}</div></div>`).join('');
  }
  const sp = store.get('plan', null);
  if (sp && PLANS[sp.g]) $('#plan-goal').value = sp.g;
  syncPlanDays(sp && sp.d);
  $('#plan-goal').addEventListener('change', () => { syncPlanDays($('#plan-days').value); renderPlan(); });
  $('#plan-days').addEventListener('change', renderPlan);

  /* ---------- 動作庫 ---------- */
  function renderLib(q = '') {
    const ids = Object.keys(EXERCISES).filter(id => {
      const e = EXERCISES[id]; return !q || (e.name + e.target + e.equip + e.level).includes(q);
    });
    $('#lib-list').innerHTML = ids.length ? ids.map(id => exCard(id)).join('') : '<p class="note">搵唔到相關動作。</p>';
  }
  $('#lib-search').addEventListener('input', e => renderLib(e.target.value.trim()));

  /* ---------- 進度相（IndexedDB，只存喺本機瀏覽器） ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const photoDB = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        const r = indexedDB.open('fit-progress', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
        r.onsuccess = () => res(this.db = r.result);
        r.onerror = () => rej(r.error);
      });
    },
    async run(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const req = fn(db.transaction('photos', mode).objectStore('photos'));
        req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
      });
    },
    all() { return this.run('readonly', s => s.getAll()); },
    add(rec) { return this.run('readwrite', s => s.add(rec)); },
    del(id) { return this.run('readwrite', s => s.delete(id)); },
  };
  // 縮細到最長邊 1000px 再轉 JPEG，慳空間
  async function shrink(file) {
    let src, w, h, url;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); w = src.width; h = src.height; }
    catch {
      url = URL.createObjectURL(file);
      src = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = url; });
      w = src.naturalWidth; h = src.naturalHeight;
    }
    const k = Math.min(1, 1000 / Math.max(w, h));
    const cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
    cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
    if (url) URL.revokeObjectURL(url);
    return new Promise((ok, no) => cv.toBlob(b => b ? ok(b) : no(new Error('toBlob')), 'image/jpeg', 0.82));
  }
  let pgUrls = [], picked = [];
  const pgMsg = (t, err) => { const m = $('#pg-msg'); m.textContent = t; m.className = 'note' + (err ? ' err' : ''); };
  async function renderProgress() {
    let rows;
    try { rows = await photoDB.all(); } catch { pgMsg('呢個瀏覽器唔支援或封鎖咗本機儲存（例如私隱模式），暫時用唔到進度相。', true); return; }
    pgUrls.forEach(u => URL.revokeObjectURL(u)); pgUrls = [];
    rows.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    picked = picked.filter(id => rows.some(r => r.id === id));
    const url = new Map(rows.map(r => { const u = URL.createObjectURL(r.blob); pgUrls.push(u); return [r.id, u]; }));
    $('#pg-hint').hidden = rows.length > 0;
    $('#pg-pickhint').hidden = rows.length < 2;
    $('#pg-list').innerHTML = rows.map(r => `<figure class="shot${picked.includes(r.id) ? ' picked' : ''}">
      <img alt="進度相 ${esc(r.date)}" src="${url.get(r.id)}">
      <figcaption>${esc(r.date)}${r.weight ? ` · ${r.weight} kg` : ''}${r.note ? `<small>${esc(r.note)}</small>` : ''}</figcaption>
      <div class="acts"><label><input type="checkbox" data-pick="${r.id}"${picked.includes(r.id) ? ' checked' : ''}>對比</label>
      <button type="button" data-delp="${r.id}">刪除</button></div></figure>`).join('');
    const sel = picked.map(id => rows.find(r => r.id === id)).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    $('#pg-compare-card').hidden = sel.length !== 2;
    if (sel.length === 2) {
      const [a, b] = sel;
      $('#pg-compare').innerHTML = [['前', a], ['後', b]].map(([t, r]) =>
        `<figure><img alt="${t}" src="${url.get(r.id)}">${t}：${esc(r.date)}${r.weight ? ` · ${r.weight} kg` : ''}</figure>`).join('');
      const days = Math.round((new Date(b.date) - new Date(a.date)) / 864e5);
      const dw = (a.weight && b.weight) ? `，體重 ${b.weight - a.weight >= 0 ? '+' : '−'}${Math.abs(b.weight - a.weight).toFixed(1)} kg` : '';
      $('#pg-delta').textContent = `相隔 ${days} 日${dw}。拍攝時請盡量用同一角度、光線同時間（例如早上空腹）。`;
    }
  }
  $('#pg-date').value = today();
  $('#pg-save').addEventListener('click', async () => {
    const file = $('#pg-file').files[0], date = $('#pg-date').value;
    if (!file || !file.type.startsWith('image/')) { pgMsg('請先揀一張相片。', true); return; }
    if (!date) { pgMsg('請揀日期。', true); return; }
    const w = parseFloat($('#pg-weight').value);
    try {
      pgMsg('處理中…');
      const blob = await shrink(file);
      await photoDB.add({ date, weight: w >= 25 && w <= 300 ? w : null, note: $('#pg-note').value.trim().slice(0, 60), blob });
      $('#pg-file').value = ''; $('#pg-note').value = '';
      pgMsg('已儲存。'); renderProgress();
    } catch { pgMsg('儲存失敗，可能係相片格式唔支援或儲存空間不足。', true); }
  });
  $('#pg-list').addEventListener('click', async e => {
    const del = e.target.dataset.delp, pick = e.target.dataset.pick;
    if (del !== undefined) {
      if (!confirm('刪除呢張進度相？刪除後唔可以還原。')) return;
      try { await photoDB.del(+del); picked = picked.filter(id => id !== +del); } catch { pgMsg('刪除失敗。', true); }
      renderProgress();
    } else if (pick !== undefined) {
      const id = +pick;
      picked = e.target.checked ? [...picked, id].slice(-2) : picked.filter(x => x !== id);
      renderProgress();
    }
  });

  /* ---------- 分頁 ---------- */
  function showTab(name) {
    if (!$('#tab-' + name)) name = 'body';
    $$('.panel').forEach(p => p.classList.toggle('on', p.id === 'tab-' + name));
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    $('#profile').style.display = ['body', 'food', 'water'].includes(name) ? '' : 'none';
    history.replaceState(null, '', '#' + name);
    window.scrollTo({ top: 0 });
    if (name === 'progress') renderProgress();
  }
  $('#tabs').addEventListener('click', e => { const t = e.target.dataset.tab; if (t) showTab(t); });

  fields.forEach(f => $('#' + f).addEventListener('input', renderBody));
  fillFoodSelect(); renderStretch(); renderPlan(); renderLib(); renderBody();
  showTab(location.hash.slice(1));
})();
