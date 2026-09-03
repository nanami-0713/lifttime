// 饮食页：记餐 + 当日概览 + 趋势总结 + 训练联动
import { getState, commit, uid } from './store.js';
import { openSheet, confirmD, toast } from './app.js';
import { donut, stackedBars, hbars } from './charts.js';
import {
  MEALS, mealOf, parseMealText, targets, summarize, dailyAdvice, periodDiet, entriesOfDay,
  ESTIMATE_CATS, estimateFor, guessFor, entryTotals, cleanFoodName, learnFood,
} from './nutrition.js';
import { aiConfig, aiEstimateFood } from './ai.js';
import { sessionStats } from './analysis.js';
import { fmtHM, fmtNum, dayKey, dayRange, escapeHtml, hmToTs, fmtDateCN } from './util.js';

let period = 7;

export function render(root) {
  root.innerHTML = `
    <div class="card">
      <h2>今日饮食 <span class="h2-sub" id="diet-date"></span></h2>
      <div id="diet-today"></div>
    </div>
    <div class="card">
      <button class="btn btn-primary btn-xl" id="btn-add-meal">＋ 记一餐</button>
      <p class="hint" style="margin:8px 0 0">直接写「2个鸡蛋、一杯牛奶、一碗米饭」即可自动估算热量和蛋白质。</p>
      <div style="margin-top:8px;text-align:right"><button class="btn btn-ghost btn-small" id="btn-myfoods" style="min-height:32px">📚 我的食物库</button></div>
    </div>
    <div class="card">
      <h2>今日餐次 <span class="h2-sub" id="meal-count"></span></h2>
      <div class="rows" id="meal-rows"></div>
    </div>
    <div class="card">
      <h2>饮食趋势与总结</h2>
      <div class="seg" id="diet-seg">
        <button data-p="7">近7天</button>
        <button data-p="30">近30天</button>
      </div>
      <div id="diet-period"></div>
    </div>`;

  root.querySelector('#btn-add-meal').addEventListener('click', () => mealSheet(null));
  root.querySelector('#btn-myfoods').addEventListener('click', myFoodsSheet);
  root.querySelector('#diet-seg').addEventListener('click', e => {
    const b = e.target.closest('button[data-p]');
    if (!b) return;
    period = Number(b.dataset.p);
    paintPeriod(root);
  });

  paintToday(root);
  paintMeals(root);
  paintPeriod(root);
}

/* ---------- 今日概览 ---------- */

function workoutsTodayLabels(st) {
  const { start, end } = dayRange(Date.now());
  return st.workouts
    .filter(w => w.startedAt >= start && w.startedAt < end)
    .map(w => {
      let labels = w.analysis && w.analysis.primaryLabels;
      if (!labels) {
        const stats = sessionStats(w, st.customExercises);
        labels = stats.muscles.filter(m => m.share >= 0.25).slice(0, 2).map(m => m.label).join('、') ||
          (stats.muscles[0] ? stats.muscles[0].label : '');
      }
      return { startedAt: w.startedAt, endAt: w.endAt, primaryLabels: labels };
    });
}

function paintToday(root) {
  const st = getState();
  root.querySelector('#diet-date').textContent = fmtDateCN(Date.now());
  const entries = entriesOfDay(st.dietEntries, Date.now());
  const wos = workoutsTodayLabels(st);
  const { summary: s, targets: tg, advice } = dailyAdvice(entries, {
    bodyweight: st.settings.bodyweight, now: Date.now(), workoutsToday: wos,
  });
  const box = root.querySelector('#diet-today');

  if (!entries.length) {
    box.innerHTML = `<p class="empty">今天还没记饮食${wos.length ? '；今天有训练，别忘了练后餐。' : '。'}</p>` + adviceHTML(advice);
    return;
  }

  const macroParts = [
    { label: '蛋白质', value: s.p * 4, color: '#3b82f6' },
    { label: '碳水', value: s.c * 4, color: '#f59e0b' },
    { label: '脂肪', value: s.f * 9, color: '#a855f7' },
  ];
  const pct = v => Math.min(100, Math.round(v));
  const barColor = (v, lo) => v >= lo * 0.9 ? '#22c55e' : v >= lo * 0.5 ? '#f59e0b' : '#ef4444';
  const rows = [
    { label: '蛋白质', value: pct(s.p / tg.proteinTarget * 100), color: barColor(s.p, tg.proteinLo), text: Math.round(s.p) + '/' + tg.proteinLo + '–' + tg.proteinHi + 'g' },
    { label: '碳水', value: pct(s.c / tg.carbs * 100), color: '#f59e0b', text: Math.round(s.c) + '/' + tg.carbs + 'g' },
    { label: '脂肪', value: pct(s.f / tg.fat * 100), color: '#a855f7', text: Math.round(s.f) + '/' + tg.fat + 'g' },
  ];

  let html = `
    <div class="chart-wrap" style="margin-bottom:4px">
      ${donut(macroParts, { size: 150, thickness: 20, title: fmtNum(s.kcal), sub: 'kcal / 目标 ' + fmtNum(tg.cal) })}
    </div>
    ${hbars(rows)}
    <p class="hint" style="margin:2px 0 8px">目标按${st.settings.bodyweight ? '体重 ' + st.settings.bodyweight + 'kg' : '通用默认（设置里填体重可个性化）'}估算${wos.length ? '；今天有训练，碳水可以往上靠。' : '。'}</p>`;

  if (wos.length) {
    const labels = wos.map(w => w.primaryLabels).filter(Boolean).join('、') || '力量';
    html += `<p class="brief-p" style="background:var(--card-2);border-radius:10px;padding:8px 10px;margin:0 0 10px;font-size:13px">🏋️ 今天练了${escapeHtml(labels)}，饮食建议已按训练日调整 ↓</p>`;
  }
  html += adviceHTML(advice);
  box.innerHTML = html;
}

function adviceHTML(advice) {
  return `<ul class="advice-list">` + advice.map(a => `<li>${escapeHtml(a)}</li>`).join('') + `</ul>`;
}

/* ---------- 今日餐次 ---------- */

function paintMeals(root) {
  const st = getState();
  const entries = entriesOfDay(st.dietEntries, Date.now());
  const el = root.querySelector('#meal-rows');
  root.querySelector('#meal-count').textContent = entries.length ? entries.length + ' 餐' : '';
  if (!entries.length) {
    el.innerHTML = '<p class="empty">还没有记录</p>';
    return;
  }
  el.innerHTML = entries.map(e => {
    const m = mealOf(e.meal);
    const desc = (e.items || []).map(i => i.label)
      .concat((e.manualItems || []).map(i => i.name + '📝')).join('、') +
      ((e.unmatched || []).length ? '；未计入：' + e.unmatched.join('、') : '');
    return `<div class="row" data-id="${e.id}" style="cursor:pointer">
      <span class="bar-mark" style="background:${m.color}"></span>
      <div class="row-main">
        <div class="row-title">${m.label} <span style="color:var(--muted);font-weight:400;font-size:12.5px">${fmtHM(e.ts)}</span></div>
        <div class="row-sub">${escapeHtml(desc || e.text || '')}</div>
      </div>
      <span class="row-val">${fmtNum(e.kcal || 0)}<small style="font-weight:400;color:var(--muted)"> kcal</small>${e.cost > 0 ? '<br><small style="font-weight:400;color:var(--muted)">¥' + e.cost + '</small>' : ''}</span>
    </div>`;
  }).join('');
  el.querySelectorAll('.row').forEach(r => r.addEventListener('click', () => mealSheet(r.dataset.id)));
}

function estRowHTML(r, i, showAI) {
  if (!r.include) {
    return `<div class="est-row" data-i="${i}">
      <div class="est-head">「${escapeHtml(r.text)}」<span style="color:var(--muted)">已不计入</span>
      <button class="btn btn-ghost btn-small est-skip" style="min-height:30px">恢复</button></div>
    </div>`;
  }
  return `<div class="est-row" data-i="${i}">
    <div class="est-head">「${escapeHtml(r.text)}」没认出来 · 帮你估一下：
      <span style="display:flex;gap:4px">${showAI ? '<button class="btn btn-ghost btn-small est-ai" style="min-height:30px">🤖 AI 估</button>' : ''}<button class="btn btn-ghost btn-small est-skip" style="min-height:30px">不计入</button></span></div>
    <div class="est-controls">
      <select class="est-cat">${ESTIMATE_CATS.map(c =>
        `<option value="${c.key}" ${c.key === r.catKey ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
      <input class="est-grams" type="number" inputmode="decimal" min="0" step="any" value="${r.grams}"><span class="est-unit">g</span>
    </div>
    <div class="est-inputs">
      <label>kcal<input class="est-k" type="number" inputmode="decimal" min="0" step="any" value="${r.kcal}"></label>
      <label>蛋白<input class="est-p" type="number" inputmode="decimal" min="0" step="any" value="${r.p}"></label>
      <label>碳水<input class="est-c" type="number" inputmode="decimal" min="0" step="any" value="${r.c}"></label>
      <label>脂肪<input class="est-f" type="number" inputmode="decimal" min="0" step="any" value="${r.f}"></label>
    </div>
  </div>`;
}

/* ---------- 记餐 / 编辑 ---------- */

function mealSheet(editId) {
  const st = getState();
  const existing = editId ? st.dietEntries.find(e => e.id === editId) : null;

  // 默认餐次：练后 2.5h 内且未吃练后餐 → 练后餐；否则按时间猜
  let meal = existing ? existing.meal : guessMeal(st);
  const now = Date.now();
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field"><label>餐次</label><div class="chips" id="ms-meals"></div></div>
    <div class="field"><label>吃了什么？（数量+食物，顿号/逗号/加号分隔）</label>
      <textarea id="ms-text" maxlength="300" placeholder="例：2个鸡蛋、一杯牛奶、一碗米饭、一份西兰花">${existing ? escapeHtml(existing.text || '') : ''}</textarea>
    </div>
    <div id="ms-preview" style="margin:-4px 0 10px"></div>
    <div class="form-row">
      <div class="field"><label>日期</label><input type="date" id="ms-date" value="${existing ? dayKey(existing.ts) : dayKey(now)}"></div>
      <div class="field"><label>时间</label><input type="time" id="ms-time" value="${existing ? fmtHM(existing.ts) : fmtHM(now)}"></div>
      <div class="field" style="max-width:110px"><label>花费 ¥（选填）</label><input type="number" inputmode="decimal" min="0" step="any" id="ms-cost" placeholder="0" value="${existing && existing.cost > 0 ? existing.cost : ''}"></div>
    </div>
    <p class="hint" style="margin:-4px 0 10px">填了花费会自动计入「预算」页的记餐开销，还能算蛋白质性价比。</p>
    <div style="display:flex;gap:10px">
      ${existing ? '<button class="btn btn-ghost" id="ms-del" style="flex:1;color:var(--brand)">删除</button>' : ''}
      <button class="btn btn-primary" id="ms-save" style="flex:1.6">${existing ? '保存修改' : '保存'}</button>
    </div>`;

  const chipsEl = body.querySelector('#ms-meals');
  const paintChips = () => {
    chipsEl.innerHTML = MEALS.map(m =>
      `<button class="chip ${m.key === meal ? 'selected' : ''}" data-m="${m.key}"><span class="dot" style="background:${m.color}"></span>${m.label}</button>`).join('');
  };
  paintChips();
  chipsEl.addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    meal = b.dataset.m;
    paintChips();
  });

  const textEl = body.querySelector('#ms-text');
  const previewEl = body.querySelector('#ms-preview');
  // 未识别条目的估算行状态（编辑已有记录时优先回填之前手估的值）
  let estRows = [];
  const existingManual = existing && existing.manualItems ? existing.manualItems : [];
  function syncEstRows(unmatched) {
    const next = [];
    for (const t of unmatched) {
      const prev = estRows.find(r => r.text === t);
      if (prev) { next.push(prev); continue; }
      const ex = existingManual.find(m => m.name === t);
      if (ex) {
        next.push({ text: t, catKey: ex.est || 'other', grams: ex.grams || 200, kcal: ex.kcal, p: ex.p, c: ex.c, f: ex.f, include: true });
      } else {
        const g = guessFor(t);
        next.push({ text: t, catKey: g.catKey, grams: g.grams, kcal: g.kcal, p: g.p, c: g.c, f: g.f, include: true });
      }
    }
    estRows = next;
  }
  const paintPreview = () => {
    const p = parseMealText(textEl.value, getState().customFoods);
    syncEstRows(p.unmatched);
    if (!p.items.length && !p.unmatched.length) { previewEl.innerHTML = ''; return; }
    const manual = estRows.filter(r => r.include);
    const t = entryTotals(p, manual);
    let h = '';
    if (p.items.length) {
      h += `<div class="chips" style="margin-bottom:6px">` + p.items.map(i =>
        `<span class="set-chip">${escapeHtml(i.label)}<span style="color:var(--muted)">${i.grams}g</span></span>`).join('') + `</div>`;
    }
    h += `<p class="hint" style="margin:0 0 6px">≈ ${fmtNum(t.kcal)} kcal · 蛋白质 ${t.p}g · 碳水 ${t.c}g · 脂肪 ${t.f}g${manual.length ? '（含 ' + manual.length + ' 项估算）' : ''}</p>`;
    const showAI = !!aiConfig(getState().settings);
    if (estRows.length) {
      h += estRows.map((r, i) => estRowHTML(r, i, showAI)).join('');
    }
    previewEl.innerHTML = h;
    // 绑定估算行事件
    previewEl.querySelectorAll('.est-row').forEach(rowEl => {
      const i = Number(rowEl.dataset.i);
      const row = estRows[i];
      const num = sel => Math.max(0, Number(rowEl.querySelector(sel).value) || 0);
      const recompute = () => {
        row.catKey = rowEl.querySelector('.est-cat').value;
        row.grams = Math.max(0, Number(rowEl.querySelector('.est-grams').value) || 0);
        const est = estimateFor(row.catKey, row.grams);
        Object.assign(row, est);
        rowEl.querySelector('.est-k').value = est.kcal;
        rowEl.querySelector('.est-p').value = est.p;
        rowEl.querySelector('.est-c').value = est.c;
        rowEl.querySelector('.est-f').value = est.f;
      };
      rowEl.querySelector('.est-cat').addEventListener('change', recompute);
      rowEl.querySelector('.est-grams').addEventListener('change', recompute);
      ['.est-k', '.est-p', '.est-c', '.est-f'].forEach((sel, j) => {
        rowEl.querySelector(sel).addEventListener('input', () => {
          const keys = ['kcal', 'p', 'c', 'f'];
          row[keys[j]] = num(sel);
        });
      });
      rowEl.querySelector('.est-skip').addEventListener('click', () => {
        row.include = !row.include;
        paintPreview();
      });
      const aiBtn = rowEl.querySelector('.est-ai');
      if (aiBtn) aiBtn.addEventListener('click', async () => {
        const cfg = aiConfig(getState().settings);
        if (!cfg) return;
        aiBtn.disabled = true;
        aiBtn.textContent = '🤖 估算中…';
        try {
          const grams = Math.max(0, Number(rowEl.querySelector('.est-grams').value) || row.grams);
          const est = await aiEstimateFood(row.text, grams, cfg);
          Object.assign(row, est, { grams, catKey: row.catKey });
          rowEl.querySelector('.est-k').value = est.kcal;
          rowEl.querySelector('.est-p').value = est.p;
          rowEl.querySelector('.est-c').value = est.c;
          rowEl.querySelector('.est-f').value = est.f;
          toast('AI 已估算，可继续手动微调');
          paintPreview();
        } catch (e2) {
          toast('AI 估算失败：' + (e2 && e2.message ? e2.message : '未知错误'), 4000);
        }
        aiBtn.disabled = false;
        aiBtn.textContent = '🤖 AI 估';
      });
    });
  };
  paintPreview();
  textEl.addEventListener('input', paintPreview);

  const { close } = openSheet(existing ? '编辑这一餐' : '记一餐', body, { sticky: true });
  body.querySelector('#ms-save').addEventListener('click', () => {
    const text = textEl.value.trim();
    if (!text) { toast('先写吃了什么'); return; }
    const ts = hmToTs(body.querySelector('#ms-date').value || dayKey(now), body.querySelector('#ms-time').value || '12:00');
    const p = parseMealText(text, getState().customFoods);
    const store = getState();
    const costRaw = body.querySelector('#ms-cost').value.trim();
    const cost = costRaw === '' ? 0 : Math.max(0, Number(costRaw) || 0);
    // 手估条目：勾选计入且热量>0 的纳入统计；其余保留为未计入文本
    const manualItems = estRows.filter(r => r.include && r.kcal > 0).map(r => ({
      name: r.text, est: r.catKey, grams: r.grams, kcal: r.kcal, p: r.p, c: r.c, f: r.f, manual: true,
    }));
    const keptUnmatched = estRows.filter(r => !r.include || !(r.kcal > 0)).map(r => r.text);
    const t = entryTotals(p, manualItems);
    const data = { ts, meal, text, items: p.items, manualItems, unmatched: keptUnmatched, kcal: t.kcal, p: t.p, c: t.c, f: t.f, cost };
    // 自动学习：手估过的食物进自定义库，下次直接识别
    if (!store.customFoods) store.customFoods = {};
    let learned = 0;
    for (const m of manualItems) {
      const lf = learnFood(m);
      if (lf && !store.customFoods[lf.name]) { store.customFoods[lf.name] = lf; learned++; }
    }
    if (existing) {
      Object.assign(existing, data);
      toast('已更新这一餐');
    } else {
      store.dietEntries.push(Object.assign({ id: uid() }, data));
      toast('已记录：' + mealOf(meal).label + ' ' + t.kcal + ' kcal' + (learned ? '，已记住 ' + learned + ' 个新食物' : ''));
    }
    commit();
    close();
  });
  const del = body.querySelector('#ms-del');
  if (del) del.addEventListener('click', async () => {
    if (await confirmD('删除这一餐记录？', { danger: true, yes: '删除' })) {
      const store = getState();
      store.dietEntries = store.dietEntries.filter(e => e.id !== editId);
      commit();
      close();
    }
  });
}

function myFoodsSheet() {
  const st = getState();
  const foods = st.customFoods || {};
  const names = Object.keys(foods);
  const body = document.createElement('div');
  if (!names.length) {
    body.innerHTML = '<p class="empty">还没有自定义食物。记餐时「帮你估一下」填过的食物会自动进这里，下次直接识别。</p>';
  } else {
    body.innerHTML = `<p class="hint" style="margin:0 0 10px">共 ${names.length} 个 · 记餐时优先于内置库匹配（数值为每 100g）</p>
      <div class="rows">` + names.map(n => {
        const f = foods[n];
        return `<div class="row" data-name="${escapeHtml(n)}">
          <div class="row-main"><div class="row-title">${escapeHtml(n)}</div>
          <div class="row-sub">${f.k} kcal · 蛋白${f.p}g · 碳水${f.c}g · 脂肪${f.f}g · 份量约${f.g}g</div></div>
          <button class="icon-btn mf-del" aria-label="删除">✕</button>
        </div>`;
      }).join('') + `</div>`;
  }
  openSheet('我的食物库', body);
  body.querySelectorAll('.mf-del').forEach(b => b.addEventListener('click', async e => {
    const name = e.target.closest('.row').dataset.name;
    if (await confirmD('从食物库删除「' + name + '」？', { danger: true, yes: '删除' })) {
      const store = getState();
      delete store.customFoods[name];
      commit();
      toast('已删除');
    }
  }));
}

function guessMeal(st) {
  const now = Date.now();
  const h = new Date(now).getHours();
  // 练后 2.5 小时内且没记过练后餐 → 默认练后餐
  const { start } = dayRange(now);
  const wos = st.workouts.filter(w => w.startedAt >= start && w.endAt);
  if (wos.length) {
    const last = wos[wos.length - 1];
    const postEaten = st.dietEntries.some(e => e.ts >= start && e.meal === 'postworkout' && e.ts >= last.startedAt);
    if (!postEaten && now - last.endAt < 2.5 * 3600000) return 'postworkout';
  }
  if (h < 10) return 'breakfast';
  if (h < 14) return 'lunch';
  if (h < 20) return 'dinner';
  return 'snack';
}

/* ---------- 阶段趋势 ---------- */

function paintPeriod(root) {
  const st = getState();
  root.querySelectorAll('#diet-seg button').forEach(b => b.classList.toggle('active', Number(b.dataset.p) === period));
  const box = root.querySelector('#diet-period');
  const pd = periodDiet(st.dietEntries, period, {
    bodyweight: st.settings.bodyweight, workouts: st.workouts, now: Date.now(),
  });

  if (!pd.daysTracked) {
    box.innerHTML = '<p class="empty">这个时间段还没有饮食记录</p>';
    return;
  }

  const title = period === 7 ? '本周' : '本月';
  let html = `
    <p class="brief-p">${title}共记录 ${pd.daysTracked} 天饮食，日均 ${fmtNum(pd.avg.kcal)} kcal、蛋白质 ${pd.avg.p}g、碳水 ${pd.avg.c}g、脂肪 ${pd.avg.f}g；蛋白质达标 ${pd.proteinHitDays}/${pd.daysTracked} 天。</p>
    <div class="stats">
      <div class="stat"><b>${fmtNum(pd.avg.kcal)}</b><span>日均kcal</span></div>
      <div class="stat"><b>${pd.avg.p}g</b><span>日均蛋白质</span></div>
      <div class="stat"><b>${pd.proteinHitDays}/${pd.daysTracked}</b><span>蛋白质达标</span></div>
      <div class="stat"><b>${pd.lateDays}</b><span>晚9点后加餐</span></div>
    </div>`;

  // 每日热量（按餐次堆叠）
  const days = pd.daySums.map(d => {
    const dt = new Date(d.key + 'T00:00:00');
    return {
      label: (dt.getMonth() + 1) + '/' + dt.getDate(),
      parts: MEALS.map(m => ({ value: d.sum.byMeal[m.key] ? d.sum.byMeal[m.key].kcal : 0, color: m.color, label: m.label })),
    };
  });
  html += `<div class="section-title">每日热量（kcal，按餐次）</div>${stackedBars(days, { format: v => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) })}`;

  // 训练×饮食联动
  if (pd.trainingLink.trainedDays > 0) {
    const link = pd.trainingLink;
    html += `<div class="section-title">训练 × 饮食</div>
      <p class="brief-p" style="font-weight:400">${title}训练 ${link.trainedDays} 天${link.trackedTrainedDays ? '，其中 ' + link.proteinHitOnTrainedDays + '/' + link.trackedTrainedDays + ' 个有记录的训练日蛋白质达标' : '，但训练日没有饮食记录——练了不记吃，恢复效果打折'}。</p>`;
  }

  if (pd.topFoods.length) {
    html += `<div class="section-title">最常吃的</div>` + hbars(pd.topFoods.map(f => ({
      label: f.name, value: f.count, color: '#3b82f6', text: f.count + ' 次',
    })));
  }

  html += `<div class="section-title">给你的建议</div>` + adviceHTML(pd.advice);
  box.innerHTML = html;
}
