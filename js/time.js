// 时间页：练前/日常计时 + 时间块记录 + 分布图
import { getState, commit, uid, catOf } from './store.js';
import { openSheet, confirmD, toast } from './app.js';
import { donut, stackedBars, timeline24, legend } from './charts.js';
import {
  fmtDur, fmtClock, fmtHM, fmtMin, dayRange, dayKey, dayStart, lastNDays,
  escapeHtml, hmToTs, minutes,
} from './util.js';

let tickTimer = null;
let period = 'today';

export function render(root) {
  stopTick();
  root.innerHTML = `
    <div class="card timer-card" id="timer-card">
      <div class="timer-state" id="timer-state">未在计时</div>
      <div class="big-clock" id="timer-clock">00:00</div>
      <button class="btn btn-primary btn-xl" id="btn-timer">开始记录</button>
      <p class="hint">练前换衣服、通勤、热身……点一下开始，做完再点一下，这段时间就被记下来，然后写下这段时间做了什么。</p>
    </div>
    <div class="card">
      <h2>今天的时间 <span class="h2-sub" id="today-total"></span></h2>
      <div id="today-tl" style="margin-bottom:6px"></div>
      <div class="rows" id="today-rows"></div>
      <div style="margin-top:10px"><button class="btn btn-ghost btn-small" id="btn-manual">＋ 手动补记一段</button></div>
    </div>
    <div class="card">
      <h2>时间分布</h2>
      <div class="seg" id="time-seg">
        <button data-p="today">今日</button>
        <button data-p="7">近7天</button>
        <button data-p="30">近30天</button>
      </div>
      <div id="time-charts"></div>
    </div>`;

  const st = getState();
  root.querySelector('#btn-timer').addEventListener('click', onToggleTimer);
  root.querySelector('#btn-manual').addEventListener('click', manualSheet);
  root.querySelector('#time-seg').addEventListener('click', e => {
    const b = e.target.closest('button[data-p]');
    if (!b) return;
    period = b.dataset.p;
    renderCharts(root);
  });

  renderTimer(root);
  renderToday(root);
  renderCharts(root);
  startTick(root);
}

function startTick(root) {
  stopTick();
  tickTimer = setInterval(() => {
    const st = getState();
    if (!st.timer) return;
    const el = document.getElementById('timer-clock');
    if (el) el.textContent = fmtClock(Date.now() - st.timer.startedAt);
  }, 1000);
}
function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }

function renderTimer(root) {
  const st = getState();
  const card = root.querySelector('#timer-card');
  const running = !!st.timer;
  card.classList.toggle('running', running);
  root.querySelector('#timer-state').textContent = running ? '● 正在记录' : '未在计时';
  root.querySelector('#timer-clock').textContent = running ? fmtClock(Date.now() - st.timer.startedAt) : '00:00';
  const btn = root.querySelector('#btn-timer');
  btn.textContent = running ? '停止并记录' : '开始记录';
  btn.classList.toggle('btn-danger', running);
  btn.classList.toggle('btn-primary', !running);
}

function onToggleTimer() {
  const st = getState();
  if (!st.timer) {
    st.timer = { startedAt: Date.now() };
    commit();
    toast('已开始记录这段时刻');
  } else {
    stopSheet(st.timer.startedAt, Date.now());
  }
}

/** 停止后：这段做了什么 */
function stopSheet(start, end) {
  const st = getState();
  const cats = st.categories;
  let selected = null;
  const body = document.createElement('div');
  body.innerHTML = `
    <p style="color:var(--muted);font-size:13px;margin:2px 0 12px">
      ${fmtHM(start)} – ${fmtHM(end)} · 共 ${fmtDur(end - start)}
    </p>
    <div class="field"><label>这段时间做了什么？</label><div class="chips" id="stop-cats"></div></div>
    <div class="field"><label>备注（可选）</label><input id="stop-note" placeholder="比如：骑车去健身房、买蛋白粉…" maxlength="60"></div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" id="stop-drop" style="flex:1">丢弃</button>
      <button class="btn btn-primary" id="stop-save" style="flex:1.6">保存记录</button>
    </div>`;
  const chipsEl = body.querySelector('#stop-cats');
  chipsEl.innerHTML = cats.map(c =>
    `<button class="chip" data-cat="${c.key}"><span class="dot" style="background:${c.color}"></span>${escapeHtml(c.label)}</button>`).join('');
  chipsEl.addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    selected = b.dataset.cat;
    chipsEl.querySelectorAll('.chip').forEach(x => x.classList.toggle('selected', x === b));
    body.querySelector('#stop-save').disabled = false;
  });
  const { close } = openSheet('记录这段时间', body, { sticky: true });
  const saveBtn = body.querySelector('#stop-save');
  saveBtn.disabled = true;
  saveBtn.addEventListener('click', () => {
    if (!selected) return;
    st.timeBlocks.push({ id: uid(), start, end, cat: selected, note: body.querySelector('#stop-note').value.trim() });
    st.timer = null;
    commit();
    close();
    toast('已记录：' + catOf(selected).label + ' ' + fmtDur(end - start));
  });
  body.querySelector('#stop-drop').addEventListener('click', async () => {
    if (await confirmD('丢弃这段计时？不会保存任何内容。', { danger: true, yes: '丢弃' })) {
      st.timer = null;
      commit();
      close();
    }
  });
}

function renderToday(root) {
  const st = getState();
  const { start, end } = dayRange(Date.now());
  const blocks = st.timeBlocks.filter(b => b.start >= start && b.start < end).sort((a, b) => b.start - a.start);
  const total = blocks.reduce((a, b) => a + (b.end - b.start), 0);
  root.querySelector('#today-total').textContent = total > 0 ? '共 ' + fmtDur(total) : '';
  root.querySelector('#today-tl').innerHTML = blocks.length ? timeline24(blocks.map(b => ({
    start: b.start, end: b.end, color: catOf(b.cat).color, label: catOf(b.cat).label,
  }))) : '';
  const rowsEl = root.querySelector('#today-rows');
  if (!blocks.length) {
    rowsEl.innerHTML = '<p class="empty">今天还没有记录，点上面的按钮开始第一段。</p>';
    return;
  }
  rowsEl.innerHTML = blocks.map(b => {
    const c = catOf(b.cat);
    return `<div class="row" data-id="${b.id}" style="cursor:pointer">
      <span class="bar-mark" style="background:${c.color}"></span>
      <div class="row-main">
        <div class="row-title">${escapeHtml(c.label)}${b.note ? ' <span style="color:var(--muted);font-weight:400;font-size:12.5px">' + escapeHtml(b.note) + '</span>' : ''}</div>
        <div class="row-sub">${fmtHM(b.start)} – ${fmtHM(b.end)}</div>
      </div>
      <span class="row-val">${fmtDur(b.end - b.start)}</span>
    </div>`;
  }).join('');
  rowsEl.querySelectorAll('.row').forEach(r => r.addEventListener('click', () => editSheet(r.dataset.id)));
}

function editSheet(id) {
  const st = getState();
  const b = st.timeBlocks.find(x => x.id === id);
  if (!b) return;
  let selected = b.cat;
  const body = document.createElement('div');
  body.innerHTML = `
    <p style="color:var(--muted);font-size:13px;margin:2px 0 12px">${fmtHM(b.start)} – ${fmtHM(b.end)} · ${fmtDur(b.end - b.start)}</p>
    <div class="field"><label>分类</label><div class="chips" id="ed-cats"></div></div>
    <div class="field"><label>备注</label><input id="ed-note" value="${escapeHtml(b.note || '')}" maxlength="60"></div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" id="ed-del" style="flex:1;color:var(--brand)">删除</button>
      <button class="btn btn-primary" id="ed-save" style="flex:1.6">保存</button>
    </div>`;
  const chipsEl = body.querySelector('#ed-cats');
  const paint = () => {
    chipsEl.innerHTML = st.categories.map(c =>
      `<button class="chip ${c.key === selected ? 'selected' : ''}" data-cat="${c.key}"><span class="dot" style="background:${c.color}"></span>${escapeHtml(c.label)}</button>`).join('');
  };
  paint();
  chipsEl.addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    selected = btn.dataset.cat;
    paint();
  });
  const { close } = openSheet('编辑时间记录', body, { sticky: true });
  body.querySelector('#ed-save').addEventListener('click', () => {
    b.cat = selected;
    b.note = body.querySelector('#ed-note').value.trim();
    commit();
    close();
    toast('已更新');
  });
  body.querySelector('#ed-del').addEventListener('click', async () => {
    if (await confirmD('删除这条时间记录？', { danger: true, yes: '删除' })) {
      st.timeBlocks = st.timeBlocks.filter(x => x.id !== id);
      commit();
      close();
    }
  });
}

function manualSheet() {
  const st = getState();
  const now = new Date();
  const nowKey = dayKey(now);
  const hmNow = fmtHM(now.getTime());
  const hmPrev = fmtHM(now.getTime() - 3600000);
  let selected = st.categories[0].key;
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-row">
      <div class="field"><label>日期</label><input type="date" id="mn-date" value="${nowKey}"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>开始</label><input type="time" id="mn-start" value="${hmPrev}"></div>
      <div class="field"><label>结束</label><input type="time" id="mn-end" value="${hmNow}"></div>
    </div>
    <div class="field"><label>分类</label><div class="chips" id="mn-cats"></div></div>
    <div class="field"><label>备注（可选）</label><input id="mn-note" maxlength="60" placeholder="做了什么…"></div>
    <button class="btn btn-primary btn-xl" id="mn-save">保存</button>`;
  const chipsEl = body.querySelector('#mn-cats');
  const paint = () => {
    chipsEl.innerHTML = st.categories.map(c =>
      `<button class="chip ${c.key === selected ? 'selected' : ''}" data-cat="${c.key}"><span class="dot" style="background:${c.color}"></span>${escapeHtml(c.label)}</button>`).join('');
  };
  paint();
  chipsEl.addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    selected = btn.dataset.cat;
    paint();
  });
  const { close } = openSheet('手动补记时间', body, { sticky: true });
  body.querySelector('#mn-save').addEventListener('click', () => {
    const dk = body.querySelector('#mn-date').value || nowKey;
    const s = hmToTs(dk, body.querySelector('#mn-start').value || '00:00');
    const e2 = hmToTs(dk, body.querySelector('#mn-end').value || '00:00');
    if (!(e2 > s)) { toast('结束时间要晚于开始时间'); return; }
    st.timeBlocks.push({ id: uid(), start: s, end: e2, cat: selected, note: body.querySelector('#mn-note').value.trim() });
    commit();
    close();
    toast('已补记 ' + fmtDur(e2 - s));
  });
}

function renderCharts(root) {
  const st = getState();
  const segEl = root.querySelector('#time-seg');
  segEl.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.p === period));
  const box = root.querySelector('#time-charts');
  const cats = st.categories;

  if (period === 'today') {
    const { start, end } = dayRange(Date.now());
    const blocks = st.timeBlocks.filter(b => b.start >= start && b.start < end);
    box.innerHTML = blocks.length ? chartHTML(cats, blocks, '今日') : '<p class="empty">今天暂无数据</p>';
    return;
  }
  const n = Number(period);
  const keys = lastNDays(n, Date.now());
  const blocks = st.timeBlocks.filter(b => {
    const k = dayKey(b.start);
    return keys.indexOf(k) >= 0;
  });
  box.innerHTML = blocks.length ? chartHTML(cats, blocks, '近' + n + '天', keys) : '<p class="empty">这个时间段还没有记录</p>';
}

function chartHTML(cats, blocks, title, dayKeys) {
  const sums = {};
  blocks.forEach(b => { sums[b.cat] = (sums[b.cat] || 0) + (b.end - b.start); });
  const parts = cats.map(c => ({ label: c.label, color: c.color, value: minutes(sums[c.key] || 0) })).sort((a, b) => b.value - a.value);
  const totalMin = parts.reduce((a, p) => a + p.value, 0);
  let html = `<div class="chart-wrap">
    ${donut(parts, { title: totalMin >= 60 ? Math.floor(totalMin / 60) + 'h' + (totalMin % 60 ? (totalMin % 60) + 'm' : '') : totalMin + 'm', sub: title + '总投入' })}
    ${legend(parts, v => fmtMin(v))}
  </div>`;
  if (dayKeys) {
    const byDay = {};
    blocks.forEach(b => {
      const k = dayKey(b.start);
      if (!byDay[k]) byDay[k] = {};
      byDay[k][b.cat] = (byDay[k][b.cat] || 0) + (b.end - b.start);
    });
    const days = dayKeys.map(k => {
      const d = new Date(k + 'T00:00:00');
      return {
        label: (d.getMonth() + 1) + '/' + d.getDate(),
        parts: cats.map(c => ({ value: minutes(byDay[k] ? byDay[k][c.key] || 0 : 0), color: c.color, label: c.label })),
      };
    });
    html += `<div class="section-title">每天投入（分钟）</div>${stackedBars(days, { format: v => Math.round(v) + 'm' })}`;
  }
  return html;
}
