// 预算页：周/月预算计划、开销记录、趋势总结、饮食联动
import { getState, commit, uid } from './store.js';
import { openSheet, confirmD, toast } from './app.js';
import { donut, stackedBars, legend, hbars } from './charts.js';
import {
  EXP_CATS, MANUAL_CATS, catOfExp, weekRange, monthRange, allExpenses, inRange,
  summarizeSpend, proteinEconomy, budgetStatus, budgetAdvice, fmtMoney, PROTEIN_PRICE_REF,
} from './finance.js';
import { periodDiet } from './nutrition.js';
import { dayKey, escapeHtml, fmtHM, fmtDateCN, hmToTs } from './util.js';

let view = 'week'; // 'week' | 'month'

export function render(root) {
  root.innerHTML = `
    <div class="card">
      <h2>预算进度 <button class="btn btn-ghost btn-small" id="btn-edit-budget" style="min-height:32px">编辑预算</button></h2>
      <div id="budget-progress"></div>
    </div>
    <div class="card">
      <button class="btn btn-primary btn-xl" id="btn-add-exp">＋ 记一笔开销</button>
      <p class="hint" style="margin:8px 0 0">在「饮食」页记餐时填了花费的，会自动计入这里的「记餐开销」。</p>
    </div>
    <div class="card">
      <h2>最近开销 <span class="h2-sub" id="exp-count"></span></h2>
      <div class="rows" id="exp-rows"></div>
    </div>
    <div class="card">
      <h2>开销趋势与总结</h2>
      <div class="seg" id="exp-seg">
        <button data-v="week">本周</button>
        <button data-v="month">本月</button>
      </div>
      <div id="exp-period"></div>
    </div>`;

  root.querySelector('#btn-edit-budget').addEventListener('click', budgetSheet);
  root.querySelector('#btn-add-exp').addEventListener('click', () => expenseSheet(null));
  root.querySelector('#exp-seg').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    view = b.dataset.v;
    paintPeriod(root);
  });

  paintProgress(root);
  paintRows(root);
  paintPeriod(root);
}

/* ---------- 预算进度 ---------- */

function paintProgress(root) {
  const st = getState();
  const now = Date.now();
  const all = allExpenses(st.expenses, st.dietEntries);
  const wr = weekRange(now), mr = monthRange(now);
  const weekSpent = summarizeSpend(inRange(all, wr.start, wr.end)).total;
  const monthSpent = summarizeSpend(inRange(all, mr.start, mr.end)).total;
  const week = budgetStatus(weekSpent, st.settings.weeklyBudget, wr.start, wr.end, now);
  const month = budgetStatus(monthSpent, st.settings.monthlyBudget, mr.start, mr.end, now);
  const box = root.querySelector('#budget-progress');

  if (!week && !month) {
    box.innerHTML = `<p class="empty">还没有设置预算。点右上角「编辑预算」，设一个周预算或月预算，这里就会显示进度和节奏提醒。</p>
      ${progressFree('本周已花', weekSpent)}${progressFree('本月已花', monthSpent)}`;
    return;
  }
  let html = '';
  if (week) html += statusBar('本周', week);
  else html += progressFree('本周已花（未设周预算）', weekSpent);
  if (month) html += statusBar('本月', month);
  else html += progressFree('本月已花（未设月预算）', monthSpent);
  box.innerHTML = html;
}

function progressFree(label, v) {
  return `<div class="row" style="border-bottom:none;padding:8px 4px">
    <div class="row-main"><div class="row-title" style="font-weight:500;font-size:13.5px;color:var(--muted)">${label}</div></div>
    <span class="row-val">¥${fmtMoney(v)}</span></div>`;
}

function statusBar(label, st) {
  const color = st.overProjected ? '#ef4444' : st.pct >= 85 ? '#f59e0b' : '#22c55e';
  const sub = st.remaining >= 0
    ? `剩 ¥${fmtMoney(st.remaining)} · 余 ${st.daysLeft} 天日均 ¥${fmtMoney(Math.max(0, st.perDayLeft))}`
    : `已超 ¥${fmtMoney(-st.remaining)}`;
  return `<div style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
      <b>${label}预算</b><span style="color:${color};font-weight:700">${st.pct}%</span></div>
    <div class="hbar-track" style="height:12px"><div class="hbar-fill" style="width:${Math.min(100, st.pct)}%;background:${color}"></div></div>
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-top:4px">
      <span>¥${fmtMoney(st.spent)} / ¥${fmtMoney(st.budget)}</span>
      <span>${sub}${st.overProjected ? ' · 节奏超支 ⚠️' : ''}</span></div>
  </div>`;
}

/* ---------- 开销列表 ---------- */

function paintRows(root) {
  const st = getState();
  const all = allExpenses(st.expenses, st.dietEntries);
  const el = root.querySelector('#exp-rows');
  root.querySelector('#exp-count').textContent = all.length ? '共 ¥' + fmtMoney(summarizeSpend(all).total) : '';
  if (!all.length) {
    el.innerHTML = '<p class="empty">还没有开销记录</p>';
    return;
  }
  el.innerHTML = all.slice(0, 30).map(e => {
    const c = catOfExp(e.cat);
    return `<div class="row" data-id="${e.id}" data-auto="${e.auto ? 1 : 0}" style="cursor:pointer">
      <span class="bar-mark" style="background:${c.color}"></span>
      <div class="row-main">
        <div class="row-title">${c.label}${e.auto ? ' <span style="color:var(--muted);font-weight:400;font-size:11px">自动</span>' : ''}</div>
        <div class="row-sub">${escapeHtml(e.note || '')} · ${fmtDateCN(e.ts)} ${fmtHM(e.ts)}</div>
      </div>
      <span class="row-val">¥${fmtMoney(e.amount)}</span>
    </div>`;
  }).join('');
  el.querySelectorAll('.row').forEach(r => r.addEventListener('click', () => {
    if (r.dataset.auto === '1') {
      toast('这笔来自饮食记录，去「饮食」页编辑对应那餐');
      return;
    }
    expenseSheet(r.dataset.id);
  }));
}

/* ---------- 记一笔 / 编辑 ---------- */

function expenseSheet(editId) {
  const st = getState();
  const existing = editId ? st.expenses.find(e => e.id === editId) : null;
  let cat = existing ? existing.cat : 'groceries';
  const now = Date.now();
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-row">
      <div class="field" style="flex:1.2"><label>金额 ¥</label><input type="number" inputmode="decimal" min="0" step="any" id="ex-amt" placeholder="0.00" value="${existing ? existing.amount : ''}"></div>
      <div class="field"><label>日期</label><input type="date" id="ex-date" value="${existing ? dayKey(existing.ts) : dayKey(now)}"></div>
    </div>
    <div class="field"><label>分类</label><div class="chips" id="ex-cats"></div></div>
    <div class="field"><label>备注（可选）</label><input id="ex-note" maxlength="60" placeholder="比如：超市买菜 / 蛋白粉一罐" value="${existing ? escapeHtml(existing.note || '') : ''}"></div>
    <div style="display:flex;gap:10px">
      ${existing ? '<button class="btn btn-ghost" id="ex-del" style="flex:1;color:var(--brand)">删除</button>' : ''}
      <button class="btn btn-primary" id="ex-save" style="flex:1.6">${existing ? '保存修改' : '保存'}</button>
    </div>`;
  const chipsEl = body.querySelector('#ex-cats');
  const paint = () => {
    chipsEl.innerHTML = MANUAL_CATS.map(c =>
      `<button class="chip ${c.key === cat ? 'selected' : ''}" data-c="${c.key}"><span class="dot" style="background:${c.color}"></span>${c.label}</button>`).join('');
  };
  paint();
  chipsEl.addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    cat = b.dataset.c;
    paint();
  });
  const { close } = openSheet(existing ? '编辑开销' : '记一笔开销', body, { sticky: true });
  body.querySelector('#ex-save').addEventListener('click', () => {
    const amt = Number(body.querySelector('#ex-amt').value);
    if (!(amt > 0)) { toast('先填金额'); return; }
    const ts = hmToTs(body.querySelector('#ex-date').value || dayKey(now), '12:00');
    const store = getState();
    const data = { ts, amount: Math.round(amt * 100) / 100, cat, note: body.querySelector('#ex-note').value.trim() };
    if (existing) {
      Object.assign(existing, data);
      toast('已更新');
    } else {
      store.expenses.push(Object.assign({ id: uid() }, data));
      toast('已记录：¥' + fmtMoney(data.amount) + ' ' + catOfExp(cat).label);
    }
    commit();
    close();
  });
  const del = body.querySelector('#ex-del');
  if (del) del.addEventListener('click', async () => {
    if (await confirmD('删除这笔开销？', { danger: true, yes: '删除' })) {
      const store = getState();
      store.expenses = store.expenses.filter(e => e.id !== editId);
      commit();
      close();
    }
  });
}

/* ---------- 预算设置 ---------- */

function budgetSheet() {
  const st = getState();
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field"><label>周预算 ¥（每周一重置）</label>
      <input type="number" inputmode="decimal" min="0" step="any" id="bg-week" placeholder="如 500" value="${st.settings.weeklyBudget || ''}"></div>
    <div class="field"><label>月预算 ¥（每月 1 号重置）</label>
      <input type="number" inputmode="decimal" min="0" step="any" id="bg-month" placeholder="如 2000" value="${st.settings.monthlyBudget || ''}"></div>
    <p class="hint">只填一个也可以；留空表示不跟踪该周期。</p>
    <button class="btn btn-primary btn-xl" id="bg-save">保存</button>`;
  const { close } = openSheet('预算设置', body, { sticky: true });
  body.querySelector('#bg-save').addEventListener('click', () => {
    const store = getState();
    const w = Number(body.querySelector('#bg-week').value);
    const m = Number(body.querySelector('#bg-month').value);
    store.settings.weeklyBudget = w > 0 ? w : null;
    store.settings.monthlyBudget = m > 0 ? m : null;
    commit();
    close();
    toast('预算已保存');
  });
}

/* ---------- 趋势与总结 ---------- */

function paintPeriod(root) {
  const st = getState();
  root.querySelectorAll('#exp-seg button').forEach(b => b.classList.toggle('active', b.dataset.v === view));
  const box = root.querySelector('#exp-period');
  const now = Date.now();
  const range = view === 'week' ? weekRange(now) : monthRange(now);
  const budget = view === 'week' ? st.settings.weeklyBudget : st.settings.monthlyBudget;
  const all = allExpenses(st.expenses, st.dietEntries);
  const items = inRange(all, range.start, range.end);
  const sum = summarizeSpend(items);

  if (!items.length) {
    box.innerHTML = '<p class="empty">这个周期还没有开销记录</p>';
    return;
  }

  const title = view === 'week' ? '本周' : '本月';
  const foodSpend = (sum.byCat.meals || 0) + (sum.byCat.groceries || 0) + (sum.byCat.takeout || 0) + (sum.byCat.social || 0);
  let html = `
    <p class="brief-p">${title}共 ${sum.count} 笔开销、合计 ¥${fmtMoney(sum.total)}${budget ? '（预算 ¥' + fmtMoney(budget) + '，已用 ' + Math.round(sum.total / budget * 100) + '%）' : ''}；活跃 ${sum.daysWithSpend} 天，日均 ¥${fmtMoney(sum.avgPerActiveDay)}。${foodSpend > 0 ? '其中餐饮相关 ¥' + fmtMoney(foodSpend) + '（' + Math.round(foodSpend / sum.total * 100) + '%）。' : ''}</p>`;

  // 每日开销堆叠（按分类）
  const days = [];
  const nDays = Math.min(view === 'week' ? 7 : 31, Math.round((Math.min(now, range.end) - range.start) / 86400000) + 1);
  for (let i = 0; i < nDays; i++) {
    const dayStart = range.start + i * 86400000;
    const d = new Date(dayStart);
    const dayItems = inRange(items, dayStart, dayStart + 86400000);
    const byCat = {};
    dayItems.forEach(e => { byCat[e.cat] = (byCat[e.cat] || 0) + e.amount; });
    days.push({
      label: (d.getMonth() + 1) + '/' + d.getDate(),
      parts: EXP_CATS.map(c => ({ value: byCat[c.key] || 0, color: c.color, label: c.label })),
    });
  }
  html += `<div class="section-title">每日开销（¥，按分类）</div>${stackedBars(days, { format: v => '¥' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v)) })}`;

  // 分类构成
  const parts = EXP_CATS.map(c => ({ label: c.label, value: Math.round((sum.byCat[c.key] || 0) * 100) / 100, color: c.color })).filter(p => p.value > 0);
  html += `<div class="section-title">分类构成</div><div class="chart-wrap">
    ${donut(parts, { title: '¥' + fmtMoney(sum.total), sub: title + '总开销' })}
    ${legend(parts, v => '¥' + fmtMoney(v))}
  </div>`;

  // —— 饮食联动卡 ——
  const eco = proteinEconomy(st.dietEntries, range.start, range.end);
  const pd = periodDiet(st.dietEntries, Math.min(7, Math.round((range.end - range.start) / 86400000)), { bodyweight: st.settings.bodyweight, workouts: st.workouts, now });
  const proteinHitRate = pd.daysTracked ? pd.proteinHitDays / pd.daysTracked : null;
  html += `<div class="section-title">💪 吃的值不值（饮食联动）</div>`;
  if (eco.meals >= 1) {
    html += `<p class="brief-p" style="font-weight:400">${title}记餐花费 ¥${fmtMoney(eco.cost)}（${eco.meals} 餐），换来蛋白质约 ${Math.round(eco.protein)}g` +
      (eco.per10g != null ? `，折合 <b>¥${fmtMoney(eco.per10g)}/10g 蛋白质</b>` : '') + `。</p>` +
      `<p class="hint" style="margin-top:-4px">参考成本：${PROTEIN_PRICE_REF.map(r => r.name + ' ¥' + r.per10g).join(' · ')}（每 10g 蛋白质）</p>`;
  } else {
    html += `<p class="hint">在「饮食」页记餐时填上花费，这里就能算出你每 10g 蛋白质花多少钱。</p>`;
  }

  // 建议
  const weekRangeNow = weekRange(now);
  const weekSum = summarizeSpend(inRange(all, weekRangeNow.start, weekRangeNow.end));
  const advice = budgetAdvice({
    week: budgetStatus(weekSum.total, st.settings.weeklyBudget, weekRangeNow.start, weekRangeNow.end, now),
    month: budgetStatus(summarizeSpend(inRange(all, monthRange(now).start, monthRange(now).end)).total, st.settings.monthlyBudget, monthRange(now).start, monthRange(now).end, now),
    sumWeek: weekSum,
    proteinEco: eco,
    proteinHitRate,
  });
  html += `<div class="section-title">给你的建议</div><ul class="advice-list">` +
    advice.map(a => `<li>${escapeHtml(a)}</li>`).join('') + `</ul>`;
  box.innerHTML = html;
}
