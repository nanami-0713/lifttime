// 报告页：某天的日简报（时间+训练）+ 阶段训练状态分析
import { getState } from './store.js';
import { dayBrief, analyzeSession, analyzePeriod, dailySeries } from './analysis.js';
import { summarize, entriesOfDay } from './nutrition.js';
import { renderAnalysisHTML } from './analysisView.js';
import { donut, stackedBars, legend } from './charts.js';
import { dayStart, dayKey, dayRange, fmtDateCN, fmtWeekday, fmtDur, fmtHM, fmtLoad, escapeHtml } from './util.js';

let dayOffset = 0;   // 0 = 今天
let periodDays = 7;

export function render(root) {
  root.innerHTML = `
    <div class="card">
      <div class="date-nav">
        <button id="d-prev" aria-label="前一天">‹</button>
        <span class="date-label" id="d-label"></span>
        <button id="d-next" aria-label="后一天">›</button>
      </div>
      <div id="day-brief"></div>
    </div>
    <div id="day-sessions"></div>
    <div class="card">
      <h2>这段时间的训练状态</h2>
      <div class="seg" id="rp-seg">
        <button data-p="7">近7天</button>
        <button data-p="30">近30天</button>
        <button data-p="90">近90天</button>
      </div>
      <div id="period-box"></div>
    </div>`;

  root.querySelector('#d-prev').addEventListener('click', () => { dayOffset++; paintDay(root); });
  root.querySelector('#d-next').addEventListener('click', () => { if (dayOffset > 0) { dayOffset--; paintDay(root); } });
  root.querySelector('#rp-seg').addEventListener('click', e => {
    const b = e.target.closest('button[data-p]');
    if (!b) return;
    periodDays = Number(b.dataset.p);
    paintPeriod(root);
  });

  paintDay(root);
  paintPeriod(root);
}

function paintDay(root) {
  const st = getState();
  const ts = dayStart(Date.now()) - dayOffset * 86400000;
  const { start, end } = dayRange(ts);
  const label = root.querySelector('#d-label');
  label.textContent = (dayOffset === 0 ? '今天' : fmtDateCN(ts)) + ' ' + fmtWeekday(ts);
  root.querySelector('#d-next').disabled = dayOffset === 0;

  const blocks = st.timeBlocks.filter(b => b.start >= start && b.start < end);
  const wos = st.workouts.filter(w => w.startedAt >= start && w.startedAt < end).sort((a, b) => a.startedAt - b.startedAt);
  const brief = dayBrief(dayKey(ts), blocks, wos, st.categories);

  const box = root.querySelector('#day-brief');
  let html = `<p class="brief-p" style="margin-top:2px">${escapeHtml(brief.summary)}</p>`;
  if (brief.top.length) {
    html += `<div class="hbars">` + brief.top.slice(0, 4).map(t => {
      const cat = st.categories.find(c => c.label === t.label);
      return `<div class="hbar-row">
        <span class="hbar-label">${escapeHtml(t.label)}</span>
        <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(t.ms / (brief.totalMs || 1) * 100)}%;background:${cat ? cat.color : '#94a3b8'}"></div></div>
        <span class="hbar-val">${fmtDur(t.ms)}</span>
      </div>`;
    }).join('') + `</div>`;
  }
  if (!wos.length) {
    html += `<p class="empty" style="padding:6px 0 0">${dayOffset === 0 ? '今天还没训练，练完这里会出现当日简评。' : '这天没有训练记录。'}</p>`;
  }

  // 当日饮食 + 训练联动
  const dietEnt = entriesOfDay(st.dietEntries, ts);
  const dietSum = summarize(dietEnt);
  const pLo = st.settings.bodyweight > 0 ? Math.round(st.settings.bodyweight * 1.6) : 80;
  const pHi = st.settings.bodyweight > 0 ? Math.round(st.settings.bodyweight * 2.2) : 110;
  if (dietEnt.length) {
    const postEaten = wos.length && dietEnt.some(e => e.meal === 'postworkout' && e.ts >= wos[wos.length - 1].startedAt);
    html += `<p class="brief-p" style="font-weight:400;border-top:1px dashed var(--line);padding-top:10px;margin-top:10px">🍚 当日饮食：${dietSum.kcal} kcal · 蛋白质 ${Math.round(dietSum.p)}g（目标 ${pLo}–${pHi}g）· ${dietEnt.length} 餐` +
      (wos.length
        ? (postEaten ? ' · 练后餐已补 ✓' : (dietSum.p < pLo ? ' · <span style="color:var(--warn)">训练日蛋白质有缺口，练后餐别省</span>' : ''))
        : '') + `</p>`;
  } else if (wos.length && dayOffset === 0) {
    html += `<p class="brief-p" style="font-weight:400;border-top:1px dashed var(--line);padding-top:10px;margin-top:10px">🍚 今天练了但还没记饮食——恢复一半靠吃，去「饮食」页把练后餐记上。</p>`;
  }
  box.innerHTML = html;

  const sBox = root.querySelector('#day-sessions');
  if (!wos.length) { sBox.innerHTML = ''; return; }
  sBox.innerHTML = wos.map(w => {
    const a = w.analysis;
    return `<div class="card" data-wo="${w.id}">
      <h2>${fmtHM(w.startedAt)} 的训练 <span class="h2-sub">${a && a.primaryLabels ? escapeHtml(a.primaryLabels) : ''}</span></h2>
      ${w.notes ? `<p style="color:var(--muted);font-size:13px;margin:0 0 6px">${escapeHtml(w.notes)}</p>` : ''}
    </div>`;
  }).join('');
  // 逐个渲染完整分析（可能需要重算）
  wos.forEach(w => {
    const card = sBox.querySelector(`[data-wo="${w.id}"]`);
    if (!card) return;
    let a = w.analysis;
    if (!a) {
      const fitCats = ['warmup', 'strength', 'cardio', 'stretch', 'shower'];
      const dayTimeMs = st.timeBlocks
        .filter(b => b.start >= start && b.start < end && fitCats.indexOf(b.cat) >= 0)
        .reduce((acc, b) => acc + (b.end - b.start), 0);
      const dietEnt = entriesOfDay(st.dietEntries, w.startedAt);
      const dietSum = summarize(dietEnt);
      a = analyzeSession(w, {
        history: st.workouts.filter(x => x.startedAt < w.startedAt),
        bodyweight: st.settings.bodyweight, unit: st.settings.unit, custom: st.customExercises,
        dayTimeMs,
        dayIntake: { p: dietSum.p, cal: dietSum.kcal, items: dietSum.items,
          hasPostMeal: dietEnt.some(e => e.meal === 'postworkout' && e.ts >= w.startedAt) },
      });
      w.analysis = a;
    }
    card.insertAdjacentHTML('beforeend', renderAnalysisHTML(a));
  });
}

function paintPeriod(root) {
  const st = getState();
  const seg = root.querySelector('#rp-seg');
  seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', Number(b.dataset.p) === periodDays));
  const box = root.querySelector('#period-box');

  const p = analyzePeriod(st.workouts, periodDays, Date.now(), st.customExercises);
  const unit = st.settings.unit;

  let html = `<p class="brief-p">${escapeHtml(p.stateParts.join('，') + '。')}</p>
    <p class="brief-p">${escapeHtml(p.tone)}</p>
    <div class="stats">
      <div class="stat"><b>${p.sessions}</b><span>训练次数</span></div>
      <div class="stat"><b>${p.freqPerWeek}</b><span>次/周</span></div>
      <div class="stat"><b>${p.tonnage > 0 ? escapeHtml(fmtLoad(p.tonnage, unit)) : '—'}</b><span>总容量</span></div>
      <div class="stat"><b>${p.trendPct == null ? '—' : (p.trendPct >= 0 ? '+' : '') + p.trendPct + '%'}</b><span>容量趋势</span></div>
    </div>`;

  const series = dailySeries(st.workouts, Math.min(periodDays, 30), Date.now() + 86400000, st.customExercises);
  const days = series.map(d => {
    const dt = new Date(d.start);
    return {
      label: (dt.getMonth() + 1) + '/' + dt.getDate(),
      parts: [{ value: d.tonnage, color: '#e11d48', label: '容量' }],
    };
  });
  html += `<div class="section-title">每次训练容量（${escapeHtml(fmtLoad(1, unit).replace(/[\d.]+/, ''))}）</div>${stackedBars(days, { format: v => fmtLoad(v, unit) })}`;

  if (p.groups.length) {
    html += `<div class="section-title">部位分布</div>
      <div class="chart-wrap">
        ${donut(p.groups.map(g => ({ label: g.label, value: g.vol, color: g.color })), { title: p.sessions + '次', sub: '部位构成' })}
        ${legend(p.groups.map(g => ({ label: g.label, value: g.vol, color: g.color })), v => fmtLoad(v, unit))}
      </div>`;
  }

  if (p.balanceNotes.length) {
    html += `<div class="section-title">结构平衡</div><ul class="advice-list">`;
    p.balanceNotes.forEach(n => html += `<li>${escapeHtml(n)}</li>`);
    html += `</ul>`;
  }

  if (p.prs.length) {
    html += `<div class="section-title">🏆 期间个人纪录</div>`;
    p.prs.slice(0, 8).forEach(pr => {
      html += `<div class="pr-row"><span class="trophy">🏆</span><span style="flex:1">${escapeHtml(pr.name)}</span>
        <b>${escapeHtml(fmtLoad(pr.e1, unit))}</b>
        <span style="color:var(--muted);font-size:12px">${pr.prev ? '此前 ' + escapeHtml(fmtLoad(pr.prev, unit)) : '首次'}</span></div>`;
    });
  }

  if (p.advice.length) {
    html += `<div class="section-title">给你的建议</div><ul class="advice-list">`;
    p.advice.forEach(n => html += `<li>${escapeHtml(n)}</li>`);
    html += `</ul>`;
  }

  html += `<p class="hint" style="text-align:center">频率在 2–4 次/周、每次 10–20 个正式组，是多数自然训练者进步最稳的区间。</p>`;
  box.innerHTML = html;
}
