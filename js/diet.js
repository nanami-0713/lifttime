// 饮食页：记餐 + 当日概览 + 趋势总结 + 训练联动
import { getState, commit, uid } from './store.js';
import { openSheet, confirmD, toast } from './app.js';
import { donut, stackedBars, hbars } from './charts.js';
import {
  MEALS, mealOf, parseMealText, targets, summarize, dailyAdvice, periodDiet, entriesOfDay,
} from './nutrition.js';
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
    const desc = (e.items || []).map(i => i.label).join('、') +
      ((e.unmatched || []).length ? '；未识别：' + e.unmatched.join('、') : '');
    return `<div class="row" data-id="${e.id}" style="cursor:pointer">
      <span class="bar-mark" style="background:${m.color}"></span>
      <div class="row-main">
        <div class="row-title">${m.label} <span style="color:var(--muted);font-weight:400;font-size:12.5px">${fmtHM(e.ts)}</span></div>
        <div class="row-sub">${escapeHtml(desc || e.text || '')}</div>
      </div>
      <span class="row-val">${fmtNum(e.kcal || 0)}<small style="font-weight:400;color:var(--muted)"> kcal</small></span>
    </div>`;
  }).join('');
  el.querySelectorAll('.row').forEach(r => r.addEventListener('click', () => mealSheet(r.dataset.id)));
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
    </div>
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
  const paintPreview = () => {
    const p = parseMealText(textEl.value);
    if (!p.items.length && !p.unmatched.length) { previewEl.innerHTML = ''; return; }
    let h = '';
    if (p.items.length) {
      h += `<div class="chips" style="margin-bottom:6px">` + p.items.map(i =>
        `<span class="set-chip">${escapeHtml(i.label)}<span style="color:var(--muted)">${i.grams}g</span></span>`).join('') + `</div>
        <p class="hint" style="margin:0 0 4px">≈ ${fmtNum(p.kcal)} kcal · 蛋白质 ${p.p}g · 碳水 ${p.c}g · 脂肪 ${p.f}g</p>`;
    }
    if (p.unmatched.length) {
      h += `<p class="hint" style="margin:0;color:var(--warn)">未识别：${escapeHtml(p.unmatched.join('、'))}（会保留文字，不计入热量）</p>`;
    }
    previewEl.innerHTML = h;
  };
  paintPreview();
  textEl.addEventListener('input', paintPreview);

  const { close } = openSheet(existing ? '编辑这一餐' : '记一餐', body, { sticky: true });
  body.querySelector('#ms-save').addEventListener('click', () => {
    const text = textEl.value.trim();
    if (!text) { toast('先写吃了什么'); return; }
    const ts = hmToTs(body.querySelector('#ms-date').value || dayKey(now), body.querySelector('#ms-time').value || '12:00');
    const p = parseMealText(text);
    const store = getState();
    const data = { ts, meal, text, items: p.items, unmatched: p.unmatched, kcal: p.kcal, p: p.p, c: p.c, f: p.f };
    if (existing) {
      Object.assign(existing, data);
      toast('已更新这一餐');
    } else {
      store.dietEntries.push(Object.assign({ id: uid() }, data));
      toast('已记录：' + mealOf(meal).label + ' ' + p.kcal + ' kcal');
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
