// 训练页：进行中训练的记录（动作 × 重量 × 次数）+ 历史与详情
import { getState, commit, uid } from './store.js';
import { openSheet, confirmD, toast, nav } from './app.js';
import { renderAnalysisHTML } from './analysisView.js';
import { analyzeSession, sessionStats } from './analysis.js';
import { summarize, entriesOfDay } from './nutrition.js';
import { aiConfig, generateAIAnalysis } from './ai.js';
import { searchExercises, resolveExercise, MUSCLES, muscleLabels } from './exercises.js';
import { fmtClock, fmtHM, fmtDateCN, fmtDur, fmtLoad, escapeHtml, dayRange, dayKey } from './util.js';

let tickTimer = null;
const FITNESS_CATS = ['warmup', 'strength', 'cardio', 'stretch', 'shower'];

export function render(root) {
  stopTick();
  const st = getState();
  if (st.activeWorkout) renderActive(root, st);
  else renderIdle(root, st);
}

function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }

/* ============ 空闲态 ============ */

function renderIdle(root, st) {
  root.innerHTML = `
    <div class="card timer-card">
      <h2 style="justify-content:center">开始一次训练</h2>
      <p class="hint" style="margin:0 0 14px">记录每个动作的重量×次数，结束后自动告诉你这次练了什么部位、效果如何、怎么吃怎么休息。</p>
      <button class="btn btn-primary btn-xl" id="btn-start-wo">开始训练</button>
    </div>
    <div class="card">
      <h2>训练历史 <span class="h2-sub" id="wo-count"></span></h2>
      <div class="rows" id="wo-history"></div>
    </div>`;
  root.querySelector('#btn-start-wo').addEventListener('click', () => {
    getState().activeWorkout = { id: uid(), startedAt: Date.now(), exercises: [], notes: '' };
    commit();
    toast('训练开始，先从第一个动作记起');
  });
  const list = st.workouts.slice().sort((a, b) => b.startedAt - a.startedAt);
  const el = root.querySelector('#wo-history');
  root.querySelector('#wo-count').textContent = list.length ? list.length + ' 次' : '';
  if (!list.length) {
    el.innerHTML = '<p class="empty">还没有训练记录</p>';
    return;
  }
  el.innerHTML = list.slice(0, 100).map(w => {
    const a = w.analysis;
    const stats = sessionStats(w, st.customExercises);
    const sets = (w.exercises || []).reduce((s, e) => s + (e.sets || []).length, 0);
    const ton = stats.tonnage;
    const labels = (a && a.primaryLabels) ||
      stats.muscles.filter(m => m.share >= 0.25).slice(0, 3).map(m => m.label).join('、') ||
      (stats.muscles[0] ? stats.muscles[0].label : '');
    return `<div class="row" data-id="${w.id}" style="cursor:pointer">
      <div class="row-main">
        <div class="row-title">${fmtDateCN(w.startedAt)} ${fmtHM(w.startedAt)}${labels ? ' · ' + escapeHtml(labels) : ''}</div>
        <div class="row-sub">${(w.exercises || []).length} 个动作 · ${sets} 组${ton > 0 ? ' · ' + escapeHtml(fmtLoad(ton, st.settings.unit)) : ''}</div>
      </div>
      <span style="color:var(--muted)">›</span>
    </div>`;
  }).join('');
  el.querySelectorAll('.row').forEach(r => r.addEventListener('click', () => detailSheet(r.dataset.id)));
}

/* ============ 进行中 ============ */

function renderActive(root, st) {
  const wo = st.activeWorkout;
  root.innerHTML = `
    <div class="card">
      <div class="wo-head">
        <div>
          <div class="wo-status">● 训练进行中</div>
          <div class="wo-clock" id="wo-clock">${fmtClock(Date.now() - wo.startedAt)}</div>
        </div>
        <button class="btn btn-ghost btn-small" id="btn-discard">放弃</button>
      </div>
    </div>
    <div id="wo-ex"></div>
    <div class="card" style="display:flex;gap:10px;margin-bottom:16px">
      <button class="btn" id="btn-add-ex" style="flex:1">＋ 添加动作</button>
      <button class="btn btn-primary" id="btn-finish" style="flex:1">结束训练</button>
    </div>`;

  root.querySelector('#btn-discard').addEventListener('click', async () => {
    if (await confirmD('放弃这次训练？已记的组都不会保存。', { danger: true, yes: '放弃训练' })) {
      getState().activeWorkout = null;
      commit();
    }
  });
  root.querySelector('#btn-add-ex').addEventListener('click', pickerSheet);
  root.querySelector('#btn-finish').addEventListener('click', finishSheet);

  renderExList(root, st);
  tickTimer = setInterval(() => {
    const w = getState().activeWorkout;
    if (!w) return stopTick();
    const el = document.getElementById('wo-clock');
    if (el) el.textContent = fmtClock(Date.now() - w.startedAt);
  }, 1000);
}

function renderExList(root, st) {
  const box = root.querySelector('#wo-ex');
  const wo = st.activeWorkout;
  if (!wo.exercises.length) {
    box.innerHTML = `<div class="card"><p class="empty">还没有动作，点「添加动作」开始记录第一组。</p></div>`;
    return;
  }
  box.innerHTML = wo.exercises.map((ex, i) => {
    const res = resolveExercise(ex.name, st.customExercises);
    const tags = res.primary.length ? muscleLabels(res.primary).join('·') : '未设部位';
    const isCardio = res.flags.cardio;
    const setsHtml = ex.sets.map((s, j) =>
      `<span class="set-chip" data-j="${j}">${s.w > 0 ? escapeHtml(fmtLoad(s.w, st.settings.unit)) : '自重'}×${s.r}<span class="x" data-j="${j}">✕</span></span>`).join('');
    const ton = ex.sets.reduce((a, s) => a + (s.w > 0 ? s.w * s.r : 0), 0);
    return `<div class="card ex-card" data-i="${i}">
      <div class="ex-head">
        <b>${escapeHtml(ex.name)}</b>
        <span class="muscle-tags">${escapeHtml(tags)}</span>
        <button class="icon-btn ex-del" title="移除动作">✕</button>
      </div>
      <div class="set-chips">${setsHtml || '<span style="color:var(--muted);font-size:13px">还没有组</span>'}</div>
      <div class="set-form">
        <input class="set-w" type="number" inputmode="decimal" min="0" step="any" placeholder="${isCardio || res.flags.bw ? '重量选填' : '重量' + (st.settings.unit === 'lb' ? 'lb' : 'kg')}">
        <span class="times">×</span>
        <input class="set-r" type="number" inputmode="numeric" min="1" step="1" placeholder="${isCardio ? '分钟' : '次数'}">
        <button class="btn btn-primary btn-small set-add">记一组</button>
        <button class="btn btn-ghost btn-small set-dup" ${ex.sets.length ? '' : 'disabled'}>复制</button>
      </div>
      <div class="ex-sum">${ex.sets.length} 组${ton > 0 ? ' · ' + escapeHtml(fmtLoad(ton, st.settings.unit)) : ''}</div>
    </div>`;
  }).join('');

  box.querySelectorAll('.ex-card').forEach(card => {
    const i = Number(card.dataset.i);
    const ex = st.activeWorkout.exercises[i];
    card.querySelector('.ex-del').addEventListener('click', async () => {
      if (await confirmD('移除「' + ex.name + '」及其所有组？', { danger: true, yes: '移除' })) {
        getState().activeWorkout.exercises.splice(i, 1);
        commit();
      }
    });
    card.querySelector('.set-add').addEventListener('click', () => {
      const wRaw = card.querySelector('.set-w').value.trim();
      const rRaw = card.querySelector('.set-r').value.trim();
      const w = wRaw === '' ? null : Math.max(0, Number(wRaw));
      const r = Math.round(Number(rRaw));
      if (!r || r <= 0) { toast('先填' + (resolveExercise(ex.name, st.customExercises).flags.cardio ? '分钟' : '次数')); return; }
      const store = getState();
      const kg = w != null ? (store.settings.unit === 'lb' ? w / 2.20462 : w) : null;
      store.activeWorkout.exercises[i].sets.push({ w: kg, r, ts: Date.now() });
      card.querySelector('.set-w').value = '';
      card.querySelector('.set-r').value = '';
      commit();
      card.querySelector('.set-w').focus();
    });
    card.querySelector('.set-dup').addEventListener('click', () => {
      const store = getState();
      const sets = store.activeWorkout.exercises[i].sets;
      if (!sets.length) return;
      const last = sets[sets.length - 1];
      sets.push({ w: last.w, r: last.r, ts: Date.now() });
      commit();
    });
    card.querySelectorAll('.set-chip .x').forEach(x => x.addEventListener('click', e => {
      e.stopPropagation();
      const j = Number(x.dataset.j);
      getState().activeWorkout.exercises[i].sets.splice(j, 1);
      commit();
    }));
  });
}

/* ============ 动作选择器 ============ */

function pickerSheet() {
  const st = getState();
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field"><input id="ex-search" placeholder="搜索动作，如：卧推 / 深蹲 / 引体…" autocomplete="off"></div>
    <div class="search-list" id="ex-results"></div>`;
  const { close } = openSheet('添加动作', body, { onClose: null });
  const input = body.querySelector('#ex-search');
  const listBox = body.querySelector('#ex-results');
  let customMode = false;

  function addExercise(name) {
    const store = getState();
    store.activeWorkout.exercises.push({ name, sets: [] });
    commit();
    close();
    toast('已添加「' + name + '」，记第一组吧');
  }

  function paint() {
    const q = input.value.trim();
    const results = searchExercises(q, 30);
    let html = results.map(r =>
      `<div class="row ex-opt" data-name="${escapeHtml(r.name)}" style="cursor:pointer">
        <div class="row-main"><div class="row-title">${escapeHtml(r.name)}</div>
        <div class="row-sub">${escapeHtml(muscleLabels(r.primary).join('·') + (r.secondary && r.secondary.length ? '（辅助 ' + muscleLabels(r.secondary).join('·') + '）' : ''))}</div></div>
        <span style="color:var(--muted)">＋</span>
      </div>`).join('');
    if (q && !results.some(r => r.name === q)) {
      customMode = true;
      html = `<div class="row ex-custom" style="cursor:pointer">
          <div class="row-main"><div class="row-title">自定义动作「${escapeHtml(q)}」</div>
          <div class="row-sub">库里没有，点这里选它的目标部位</div></div><span style="color:var(--brand)">＋</span>
        </div>` + html;
    }
    listBox.innerHTML = html || '<p class="empty">输入动作名搜索</p>';
    listBox.querySelectorAll('.ex-opt').forEach(r => r.addEventListener('click', () => addExercise(r.dataset.name)));
    const c = listBox.querySelector('.ex-custom');
    if (c) c.addEventListener('click', () => customSheet(q, addExercise));
  }
  paint();
  input.addEventListener('input', paint);
  setTimeout(() => input.focus(), 250);
}

function customSheet(name, onDone) {
  const st = getState();
  const selected = new Set();
  const body = document.createElement('div');
  body.innerHTML = `
    <p style="color:var(--muted);font-size:13px">「${escapeHtml(name)}」主要练哪些部位？（可多选）</p>
    <div class="chips" id="cu-muscles"></div>
    <button class="btn btn-primary btn-xl" id="cu-save" style="margin-top:14px" disabled>保存并添加</button>`;
  const chips = body.querySelector('#cu-muscles');
  chips.innerHTML = Object.keys(MUSCLES).map(k =>
    `<button class="chip" data-k="${k}">${MUSCLES[k].label}</button>`).join('');
  chips.addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const k = b.dataset.k;
    if (selected.has(k)) { selected.delete(k); b.classList.remove('selected'); }
    else { selected.add(k); b.classList.add('selected'); }
    body.querySelector('#cu-save').disabled = selected.size === 0;
  });
  const { close } = openSheet('设置目标部位', body, { sticky: true });
  body.querySelector('#cu-save').addEventListener('click', () => {
    const store = getState();
    store.customExercises[name] = { p: Array.from(selected) };
    commit();
    close();
    onDone(name);
  });
}

/* ============ 结束训练 ============ */

function finishSheet() {
  const st = getState();
  const wo = st.activeWorkout;
  const totalSets = wo.exercises.reduce((a, e) => a + e.sets.length, 0);
  if (!totalSets) { toast('至少记录一组再结束'); return; }
  let feeling = 3;
  const feelOpts = [[1, '毫无感觉'], [2, '轻松'], [3, '适中'], [4, '较累'], [5, '疲惫/力竭']];
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field"><label>这次练完的感觉</label><div class="chips" id="fi-feel"></div></div>
    <div class="field"><label>备注（可选）</label><textarea id="fi-note" maxlength="200" placeholder="比如：状态好/睡眠差/试了新动作…"></textarea></div>
    <button class="btn btn-primary btn-xl" id="fi-save">生成训练简评</button>`;
  const chips = body.querySelector('#fi-feel');
  const paint = () => {
    chips.innerHTML = feelOpts.map(([v, t]) =>
      `<button class="chip ${v === feeling ? 'selected' : ''}" data-v="${v}">${t}</button>`).join('');
  };
  paint();
  chips.addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    feeling = Number(b.dataset.v);
    paint();
  });
  const { close } = openSheet('结束训练', body, { sticky: true });
  body.querySelector('#fi-save').addEventListener('click', () => {
    const store = getState();
    const active = store.activeWorkout;
    const finished = {
      id: active.id, startedAt: active.startedAt, endAt: Date.now(),
      exercises: active.exercises, feeling, notes: body.querySelector('#fi-note').value.trim(),
    };
    finished.analysis = analyzeSession(finished, {
      history: store.workouts,
      bodyweight: store.settings.bodyweight,
      unit: store.settings.unit,
      custom: store.customExercises,
      dayTimeMs: fitnessTimeToday(store),
      dayIntake: dayIntakeToday(store, active.startedAt),
    });
    store.workouts.push(finished);
    store.activeWorkout = null;
    commit();
    close();
    nav('report');
    toast('训练已保存，看看今天的简评 ↓');
    aiUpgrade(finished.id);
  });
}

/** 配置了 AI 则在后台用大模型重写简评文字，失败保留规则版 */
async function aiUpgrade(workoutId, opts) {
  opts = opts || {};
  const store = getState();
  const cfg = aiConfig(store.settings);
  if (!cfg) return;
  const w = store.workouts.find(x => x.id === workoutId);
  if (!w || !w.analysis) return;
  if (!opts.silent) toast('🤖 AI 简评生成中（深度思考，约 10–60 秒）…', 5000);
  try {
    const fields = await generateAIAnalysis(w, w.analysis, {
      bodyweight: store.settings.bodyweight,
      dayIntake: dayIntakeToday(store, w.startedAt),
      history: store.workouts.filter(x => x.startedAt < w.startedAt),
    }, cfg);
    const store2 = getState();
    const target = store2.workouts.find(x => x.id === workoutId);
    if (!target) return;
    Object.assign(target.analysis, fields, { ai: { model: cfg.model, effort: cfg.effort, at: Date.now() } });
    commit();
    toast('🤖 AI 简评已生成');
  } catch (e) {
    toast('AI 简评失败，已保留规则版：' + (e && e.message ? e.message : '未知错误'), 5000);
  }
}

function dayIntakeToday(store, woStartedAt) {
  const entries = entriesOfDay(store.dietEntries, Date.now());
  const s = summarize(entries);
  const hasPostMeal = entries.some(e => e.meal === 'postworkout' && e.ts >= woStartedAt);
  return { p: s.p, cal: s.kcal, items: s.items, hasPostMeal };
}

function fitnessTimeToday(store) {
  const { start, end } = dayRange(Date.now());
  return store.timeBlocks
    .filter(b => b.start >= start && b.start < end && FITNESS_CATS.indexOf(b.cat) >= 0)
    .reduce((a, b) => a + (b.end - b.start), 0);
}

/* ============ 历史详情 ============ */

function detailSheet(id) {
  const st = getState();
  const w = st.workouts.find(x => x.id === id);
  if (!w) return;
  let a = w.analysis;
  if (!a) {
    a = analyzeSession(w, { history: st.workouts.filter(x => x.startedAt < w.startedAt), bodyweight: st.settings.bodyweight, unit: st.settings.unit, custom: st.customExercises });
    w.analysis = a;
    commit();
  }
  const body = document.createElement('div');
  const exHtml = (w.exercises || []).map(ex => {
    const chips = ex.sets.map(s =>
      `<span class="set-chip">${s.w > 0 ? escapeHtml(fmtLoad(s.w, st.settings.unit)) : '自重'}×${s.r}</span>`).join(' ');
    return `<div style="margin-bottom:10px"><b style="font-size:14px">${escapeHtml(ex.name)}</b>
      <div style="margin-top:4px">${chips}</div></div>`;
  }).join('');
  const dur = w.endAt && w.endAt > w.startedAt ? fmtDur(w.endAt - w.startedAt) : '';
  body.innerHTML = `
    <p style="color:var(--muted);font-size:13px;margin:2px 0 10px">
      ${fmtDateCN(w.startedAt)} ${fmtHM(w.startedAt)}${dur ? ' · 用时 ' + dur : ''}${w.notes ? ' · ' + escapeHtml(w.notes) : ''}
    </p>
    <div style="margin-bottom:6px">${exHtml}</div>
    <div style="margin:4px -16px 0;padding:0 16px">${renderAnalysisHTML(a)}</div>
    ${st.settings.aiKey ? '<button class="btn btn-xl" id="dt-ai" style="margin-top:14px">🤖 用 AI 重新生成简评</button>' : ''}
    <button class="btn btn-ghost btn-xl" id="dt-del" style="margin-top:14px;color:var(--brand)">删除这次训练</button>`;
  const { close } = openSheet('训练详情', body);
  const aiBtn = body.querySelector('#dt-ai');
  if (aiBtn) aiBtn.addEventListener('click', async () => {
    aiBtn.disabled = true;
    aiBtn.textContent = '🤖 生成中（约 10–60 秒）…';
    await aiUpgrade(id, { silent: true });
    close();
    detailSheet(id); // 重新打开展示新简评
  });
  body.querySelector('#dt-del').addEventListener('click', async () => {
    if (await confirmD('删除这次训练记录及其分析？', { danger: true, yes: '删除' })) {
      const store = getState();
      store.workouts = store.workouts.filter(x => x.id !== id);
      commit();
      close();
    }
  });
}
