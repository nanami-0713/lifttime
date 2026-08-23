// 饮食页：按日期记录饮食（热量/蛋白）与开销，支持局域网同步
import { getState, commit, uid, MEAL_SLOTS, EXPENSE_CATS } from './store.js';
import { openSheet, confirmD, toast } from './app.js';
import { escapeHtml, dayKey } from './util.js';

let viewDate = null; // 当前查看的 dayKey

export function render(root) {
  if (!viewDate) viewDate = dayKey(Date.now());
  const st = getState();
  const meals = st.meals.filter(m => m.date === viewDate);
  const expenses = st.expenses.filter(e => e.date === viewDate);

  const kcal = meals.reduce((s, m) => s + (+m.kcal || 0), 0);
  const protein = meals.reduce((s, m) => s + (+m.protein || 0), 0);
  const spend = expenses.reduce((s, e) => s + (+e.amount || 0), 0);

  root.innerHTML = `
    <div class="card diet-head">
      <div class="date-nav">
        <button class="icon-btn" id="d-prev" aria-label="前一天">‹</button>
        <div class="date-mid">
          <input type="date" id="d-date" value="${viewDate}">
          <button class="btn btn-ghost btn-small" id="d-today">今天</button>
        </div>
        <button class="icon-btn" id="d-next" aria-label="后一天">›</button>
      </div>
      <div class="diet-summary">
        <div class="ds-item"><span class="ds-num">${Math.round(kcal)}</span><span class="ds-label">千卡</span></div>
        <div class="ds-item"><span class="ds-num">${Math.round(protein)}</span><span class="ds-label">蛋白 g</span></div>
        <div class="ds-item"><span class="ds-num">¥${spend.toFixed(2)}</span><span class="ds-label">支出</span></div>
      </div>
      <button class="btn btn-primary" id="d-sync" style="width:100%">⇅ 从 PC 同步</button>
      ${st.lastSyncAt ? `<p class="hint" style="margin:6px 0 0">上次同步：${new Date(st.lastSyncAt).toLocaleString('zh-CN')}</p>` : ''}
    </div>

    <div class="card">
      <h2>饮食 <span class="h2-sub">${meals.length} 条</span></h2>
      <div class="rows" id="meal-rows"></div>
      <button class="btn btn-ghost btn-small" id="meal-add" style="margin-top:10px">＋ 记一笔饮食</button>
    </div>

    <div class="card">
      <h2>开销 <span class="h2-sub">¥${spend.toFixed(2)}</span></h2>
      <div class="rows" id="exp-rows"></div>
      <button class="btn btn-ghost btn-small" id="exp-add" style="margin-top:10px">＋ 记一笔开销</button>
    </div>`;

  renderMeals(root, meals);
  renderExpenses(root, expenses);

  root.querySelector('#d-prev').onclick = () => shiftDay(-1);
  root.querySelector('#d-next').onclick = () => shiftDay(1);
  root.querySelector('#d-date').onchange = e => { viewDate = e.target.value || dayKey(Date.now()); rerender(); };
  root.querySelector('#d-today').onclick = () => { viewDate = dayKey(Date.now()); rerender(); };
  root.querySelector('#meal-add').onclick = () => mealSheet(null);
  root.querySelector('#exp-add').onclick = () => expenseSheet(null);
  root.querySelector('#d-sync').onclick = () => doSync(false);
}

function rerender() {
  const v = document.getElementById('view');
  if (v) render(v);
}

function shiftDay(delta) {
  const [y, m, d] = viewDate.split('-').map(Number);
  const t = new Date(y, m - 1, d + delta);
  viewDate = dayKey(t.getTime());
  rerender();
}

function slotOf(key) { return MEAL_SLOTS.find(s => s.key === key) || MEAL_SLOTS[3]; }
function catOfE(key) { return EXPENSE_CATS.find(c => c.key === key) || EXPENSE_CATS[EXPENSE_CATS.length - 1]; }

function renderMeals(root, meals) {
  const box = root.querySelector('#meal-rows');
  if (!meals.length) { box.innerHTML = '<p class="hint" style="margin:0">这一天还没有饮食记录</p>'; return; }
  const order = MEAL_SLOTS.map(s => s.key);
  meals.slice().sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot)).forEach(m => {
    const slot = slotOf(m.slot);
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <div class="row-ic" style="font-size:18px">${slot.icon}</div>
      <div class="row-main">
        <div class="row-title">${escapeHtml(m.name)}</div>
        <div class="row-sub">${slot.label}${m.note ? ' · ' + escapeHtml(m.note) : ''}</div>
      </div>
      <div class="row-side">
        <div class="row-num">${Math.round(+m.kcal || 0)} <small>千卡</small></div>
        <div class="row-sub">蛋白 ${Math.round(+m.protein || 0)}g</div>
      </div>
      <button class="icon-btn row-edit" aria-label="编辑">✎</button>`;
    row.querySelector('.row-edit').onclick = () => mealSheet(m);
    box.appendChild(row);
  });
}

function renderExpenses(root, expenses) {
  const box = root.querySelector('#exp-rows');
  if (!expenses.length) { box.innerHTML = '<p class="hint" style="margin:0">这一天没有开销</p>'; return; }
  expenses.slice().sort((a, b) => (a.time || '').localeCompare(b.time || '')).forEach(x => {
    const cat = catOfE(x.cat);
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <div class="row-ic" style="background:${cat.color}22;color:${cat.color}">${cat.label[0]}</div>
      <div class="row-main">
        <div class="row-title">${escapeHtml(x.note || cat.label)}</div>
        <div class="row-sub">${cat.label} · ${escapeHtml(x.time || '')}</div>
      </div>
      <div class="row-side"><div class="row-num">¥${(+x.amount || 0).toFixed(2)}</div></div>
      <button class="icon-btn row-edit" aria-label="编辑">✎</button>`;
    row.querySelector('.row-edit').onclick = () => expenseSheet(x);
    box.appendChild(row);
  });
}

/* ---------- 饮食表单 ---------- */

function mealSheet(old) {
  const slotsHtml = MEAL_SLOTS.map(s =>
    `<button type="button" class="chip ${old && old.slot === s.key ? 'selected' : ''}" data-slot="${s.key}">${s.icon} ${s.label}</button>`).join('');
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field"><label>餐次</label><div class="chips" id="m-slots">${slotsHtml}</div></div>
    <div class="field"><label>吃了什么</label><input id="m-name" placeholder="如：口蘑酿虾滑 / 炸琵琶腿×2" maxlength="40" value="${escapeHtml(old ? old.name : '')}"></div>
    <div class="form-row">
      <div class="field"><label>热量（千卡）</label><input id="m-kcal" type="number" inputmode="decimal" min="0" step="1" placeholder="0" value="${old ? (+old.kcal || '') : ''}"></div>
      <div class="field"><label>蛋白质（g）</label><input id="m-prot" type="number" inputmode="decimal" min="0" step="0.5" placeholder="0" value="${old ? (+old.protein || '') : ''}"></div>
    </div>
    <div class="field"><label>备注（可选）</label><input id="m-note" placeholder="如：自煮 / 浅炸" maxlength="60" value="${escapeHtml(old ? old.note || '' : '')}"></div>
    ${old ? '<button class="btn btn-ghost btn-small" id="m-del" style="color:#e11d48;margin-top:6px">删除这条</button>' : ''}
    <button class="btn btn-primary" id="m-save" style="width:100%;margin-top:12px">${old ? '保存修改' : '添加'}</button>`;
  const { close } = openSheet(old ? '编辑饮食' : '记一笔饮食', body, { sticky: true });

  let slot = old ? old.slot : 'lunch';
  body.querySelectorAll('#m-slots .chip').forEach(c => c.onclick = () => {
    body.querySelectorAll('#m-slots .chip').forEach(x => x.classList.remove('selected'));
    c.classList.add('selected'); slot = c.dataset.slot;
  });
  if (old) body.querySelector('#m-del').onclick = async () => {
    if (!await confirmD('删除这条饮食记录？', { danger: true })) return;
    const st2 = getState();
    st2.meals = st2.meals.filter(m => m.id !== old.id);
    commit(); close(); rerender(); toast('已删除');
  };
  body.querySelector('#m-save').onclick = () => {
    const name = body.querySelector('#m-name').value.trim();
    if (!name) { toast('先写下吃了什么'); return; }
    const st2 = getState();
    const rec = {
      id: old ? old.id : uid(),
      date: viewDate, slot,
      name,
      kcal: +body.querySelector('#m-kcal').value || 0,
      protein: +body.querySelector('#m-prot').value || 0,
      note: body.querySelector('#m-note').value.trim(),
    };
    if (old) { const i = st2.meals.findIndex(m => m.id === old.id); st2.meals[i] = rec; }
    else { st2.meals.push(rec); st2.outbox.push({ kind: 'meal', id: rec.id }); }
    commit(); close(); rerender(); toast(old ? '已更新' : '已记录');
  };
}

/* ---------- 开销表单 ---------- */

function expenseSheet(old) {
  const catsHtml = EXPENSE_CATS.map(c =>
    `<button type="button" class="chip ${old && old.cat === c.key ? 'selected' : ''}" data-cat="${c.key}">${c.label}</button>`).join('');
  const nowHM = old ? (old.time || '') : new Date().toTimeString().slice(0, 5);
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field"><label>分类</label><div class="chips" id="x-cats">${catsHtml}</div></div>
    <div class="form-row">
      <div class="field"><label>金额（¥）</label><input id="x-amt" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" value="${old ? (+old.amount || '') : ''}"></div>
      <div class="field"><label>时间</label><input id="x-time" type="time" value="${nowHM}"></div>
    </div>
    <div class="field"><label>买了什么（可选）</label><input id="x-note" placeholder="如：五花肉+巧乐兹 / 瑞幸生椰" maxlength="60" value="${escapeHtml(old ? old.note || '' : '')}"></div>
    ${old ? '<button class="btn btn-ghost btn-small" id="x-del" style="color:#e11d48;margin-top:6px">删除这条</button>' : ''}
    <button class="btn btn-primary" id="x-save" style="width:100%;margin-top:12px">${old ? '保存修改' : '添加'}</button>`;
  const { close } = openSheet(old ? '编辑开销' : '记一笔开销', body, { sticky: true });

  let cat = old ? old.cat : 'food';
  body.querySelectorAll('#x-cats .chip').forEach(c => c.onclick = () => {
    body.querySelectorAll('#x-cats .chip').forEach(x => x.classList.remove('selected'));
    c.classList.add('selected'); cat = c.dataset.cat;
  });
  if (old) body.querySelector('#x-del').onclick = async () => {
    if (!await confirmD('删除这条开销记录？', { danger: true })) return;
    const st2 = getState();
    st2.expenses = st2.expenses.filter(e => e.id !== old.id);
    commit(); close(); rerender(); toast('已删除');
  };
  body.querySelector('#x-save').onclick = () => {
    const amt = +body.querySelector('#x-amt').value;
    if (!(amt > 0)) { toast('金额要大于 0'); return; }
    const st2 = getState();
    const rec = {
      id: old ? old.id : uid(),
      date: viewDate,
      time: body.querySelector('#x-time').value || '',
      cat, amount: Math.round(amt * 100) / 100,
      note: body.querySelector('#x-note').value.trim(),
    };
    if (old) { const i = st2.expenses.findIndex(e => e.id === old.id); st2.expenses[i] = rec; }
    else { st2.expenses.push(rec); st2.outbox.push({ kind: 'expense', id: rec.id }); }
    commit(); close(); rerender(); toast(old ? '已更新' : '已记录');
  };
}

/* ---------- 局域网同步 ---------- */

export async function doSync(silent) {
  const st = getState();
  const url = (st.settings.syncUrl || '').replace(/\/+$/, '');
  const token = st.settings.syncToken || '';
  if (!url) { if (!silent) toast('先在设置里填 PC 同步地址'); return; }

  // 1) 手机离线记的条目先推回 PC
  const outIds = new Set((st.outbox || []).map(o => o.id));
  const outMeals = st.meals.filter(m => outIds.has(m.id));
  const outExps = st.expenses.filter(e => outIds.has(e.id));

  try {
    if (outMeals.length || outExps.length) {
      const r = await fetch(url + '/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, meals: outMeals, expenses: outExps }),
      });
      if (!r.ok) throw new Error('push ' + r.status);
      st.outbox = []; commit();
    }

    // 2) 拉取 PC 端全量，按 id 合并（本地已有的 id 不覆盖，避免打掉手机未上报的修改）
    const r2 = await fetch(url + '/api/data?token=' + encodeURIComponent(token));
    if (!r2.ok) throw new Error('pull ' + r2.status);
    const data = await r2.json();
    const byIdM = new Set(st.meals.map(m => m.id));
    const byIdX = new Set(st.expenses.map(e => e.id));
    let addedM = 0, addedX = 0;
    (data.meals || []).forEach(m => { if (!byIdM.has(m.id)) { st.meals.push(m); addedM++; } });
    (data.expenses || []).forEach(x => { if (!byIdX.has(x.id)) { st.expenses.push(x); addedX++; } });
    st.lastSyncAt = Date.now();
    commit();
    if (!silent) toast(`同步完成：+${addedM} 饮食 +${addedX} 开销`);
    rerender();
  } catch (e) {
    if (!silent) toast('同步失败：' + (e.message === 'Failed to fetch' ? '连不上 PC（检查同一 WiFi 和地址）' : e.message), 3200);
  }
}
