// 单次训练分析的展示（训练详情与日报共用）
import { GROUPS } from './exercises.js';
import { fmtLoad, escapeHtml } from './util.js';

export function domsBadge(level) {
  const cls = level === '强烈' ? 'badge-red' : level === '明显' ? 'badge-amber' : 'badge-green';
  return `<span class="badge ${cls}">次日酸痛：${escapeHtml(level)}</span>`;
}

export function renderAnalysisHTML(a) {
  if (!a) return '<p class="empty">暂无分析</p>';
  const unit = a.unit || 'kg';
  const h = [];

  h.push(`<div class="section-title">简评</div>`);
  a.brief.forEach(p => h.push(`<p class="brief-p">${escapeHtml(p)}</p>`));

  h.push(`<div class="stats">
    <div class="stat"><b>${a.totals.tonnage > 0 ? escapeHtml(fmtLoad(a.totals.tonnage, unit)) : a.totals.sets + ' 组'}</b><span>总容量</span></div>
    <div class="stat"><b>${a.totals.sets}</b><span>总组数</span></div>
    <div class="stat"><b>${a.totals.reps}</b><span>总次数</span></div>
    <div class="stat"><b>${escapeHtml(a.intensity)}${a.ratio != null ? ' <small>·' + a.ratio + '%</small>' : ''}</b><span>强度</span></div>
  </div>`);

  if (a.muscles && a.muscles.length) {
    h.push(`<div class="section-title">部位分布（主练：${escapeHtml(a.primaryLabels)}${a.secondaryLabels ? ' / 次重点：' + escapeHtml(a.secondaryLabels) : ''}）</div>`);
    const rows = a.muscles.slice(0, 6).map(m => ({
      color: GROUPS[m.group] ? GROUPS[m.group].color : '#94a3b8',
      label: m.label,
      value: m.vol,
      text: Math.round(m.share * 100) + '%' + (m.sets >= 1 ? ' · ' + (Math.round(m.sets * 10) / 10) + '组' : ''),
    }));
    h.push(require0(rows));
  }

  if (a.prs && a.prs.length) {
    h.push(`<div class="section-title">🏆 个人纪录</div>`);
    a.prs.forEach(p => {
      h.push(`<div class="pr-row"><span class="trophy">🏆</span><span style="flex:1">${escapeHtml(p.name)}</span>
        <b>${escapeHtml(fmtLoad(p.e1, unit))}</b>${p.prev ? `<span style="color:var(--muted);font-size:12px">此前 ${escapeHtml(fmtLoad(p.prev, unit))}</span>` : '<span style="color:var(--muted);font-size:12px">首次纪录</span>'}</div>`);
    });
  }

  if (a.postFeel && a.postFeel.length) {
    h.push(`<div class="section-title">练后身体感觉</div><ul class="advice-list">`);
    a.postFeel.forEach(s => h.push(`<li>${escapeHtml(s)}</li>`));
    h.push(`</ul>`);
  }

  h.push(`<div class="section-title">第二天会怎样</div>
    <p style="margin:6px 0 10px">${domsBadge(a.domsLevel)}</p>
    <p style="margin:0 0 4px;font-size:13.5px">${escapeHtml(a.nextDayText)}</p>`);

  h.push(`<div class="section-title">吃点什么帮助恢复</div><ul class="advice-list">`);
  a.diet.forEach(s => h.push(`<li>${escapeHtml(s)}</li>`));
  h.push(`</ul>`);

  h.push(`<div class="section-title">休息与放松建议</div><ul class="advice-list">`);
  a.rest.forEach(s => h.push(`<li>${escapeHtml(s)}</li>`));
  h.push(`</ul>`);

  return h.join('');
}

function require0(rows) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return `<div class="hbars">` + rows.map(r => `
    <div class="hbar-row">
      <span class="hbar-label">${escapeHtml(r.label)}</span>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(r.value / max * 100)}%;background:${r.color}"></div></div>
      <span class="hbar-val">${escapeHtml(r.text || '')}</span>
    </div>`).join('') + `</div>`;
}
