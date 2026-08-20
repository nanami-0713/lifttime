// 手写 SVG 图表：环形图 / 堆叠柱状图 / 24小时时间轴（零依赖，兼容性好）
import { escapeHtml } from './util.js';

function niceMax(v) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
  const f = v / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return step * exp;
}

/**
 * 环形图。parts: [{label, value, color}]
 * opts: {size, thickness, title, sub}
 */
export function donut(parts, opts) {
  opts = opts || {};
  const size = opts.size || 168, th = opts.thickness || 24;
  const r = (size - th) / 2 - 2;
  const c = 2 * Math.PI * r;
  const total = parts.reduce((a, p) => a + p.value, 0);
  const cx = size / 2, cy = size / 2;
  let acc = 0;
  let segs = '';
  if (total <= 0) {
    segs = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${th}" opacity="0.55"/>`;
  } else {
    for (const p of parts) {
      if (p.value <= 0) continue;
      const frac = p.value / total;
      const len = frac * c;
      const dash = len - 1.5 > 0 ? len - 1.5 : len;
      segs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${p.color}" stroke-width="${th}"
        stroke-dasharray="${dash.toFixed(2)} ${(c - dash).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}"
        transform="rotate(-90 ${cx} ${cy})" stroke-linecap="butt"><title>${escapeHtml(p.label)} ${Math.round(frac * 100)}%</title></circle>`;
      acc += len;
    }
  }
  const title = opts.title != null ? escapeHtml(opts.title) : '';
  const sub = opts.sub != null ? escapeHtml(opts.sub) : '';
  return `<svg class="donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${title}">
    ${segs}
    ${title ? `<text x="${cx}" y="${cy - (sub ? 5 : -4)}" text-anchor="middle" class="donut-title">${title}</text>` : ''}
    ${sub ? `<text x="${cx}" y="${cy + 14}" text-anchor="middle" class="donut-sub">${sub}</text>` : ''}
  </svg>`;
}

/**
 * 堆叠柱状图。days: [{label, parts:[{value,color}]}]
 * opts: {height, format(v)}
 */
export function stackedBars(days, opts) {
  opts = opts || {};
  const W = 340, H = opts.height || 150;
  const padL = 6, padR = 6, padT = 12, padB = 20;
  const n = days.length || 1;
  const totals = days.map(d => (d.parts || []).reduce((a, p) => a + p.value, 0));
  const maxV = niceMax(Math.max(1, ...totals));
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const slot = innerW / n;
  const bw = Math.max(4, Math.min(30, slot * 0.62));
  let out = '';
  // 网格线
  for (let i = 0; i <= 2; i++) {
    const y = padT + innerH - (innerH * i / 2);
    out += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--line)" stroke-width="1" ${i === 0 ? '' : 'stroke-dasharray="3 4" opacity="0.6"'}/>`;
    out += `<text x="${padL}" y="${y - 3}" class="bar-axis">${i === 0 ? '' : (opts.format ? opts.format(maxV * i / 2) : Math.round(maxV * i / 2))}</text>`;
  }
  days.forEach((d, i) => {
    const x = padL + slot * i + (slot - bw) / 2;
    let y = padT + innerH;
    let total = 0;
    (d.parts || []).forEach(p => {
      if (p.value <= 0) return;
      const h = innerH * (p.value / maxV);
      y -= h; total += p.value;
      out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="2" fill="${p.color}"><title>${escapeHtml(d.label)} ${escapeHtml(p.label || '')} ${(opts.format ? opts.format(p.value) : p.value)}</title></rect>`;
    });
    if (total <= 0) {
      out += `<rect x="${x.toFixed(1)}" y="${(padT + innerH - 2).toFixed(1)}" width="${bw.toFixed(1)}" height="2" rx="1" fill="var(--line)"/>`;
    }
    const showLabel = n <= 16 || i % Math.ceil(n / 10) === 0;
    if (showLabel) out += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="bar-label">${escapeHtml(d.label)}</text>`;
  });
  return `<svg class="bars" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img">${out}</svg>`;
}

/**
 * 24 小时时间轴。segments: [{startMs, endMs, color, label}]（当天内的毫秒时间戳）
 */
export function timeline24(segments, opts) {
  opts = opts || {};
  const W = 340, H = 40;
  const y = 12, bh = 14;
  let out = `<rect x="0" y="${y}" width="${W}" height="${bh}" rx="7" fill="var(--line)" opacity="0.5"/>`;
  const dayS = new Date(); dayS.setHours(0, 0, 0, 0);
  const dayMs = 86400000;
  for (const s of segments) {
    const x1 = Math.max(0, Math.min(W, (s.start - dayS.getTime()) / dayMs * W));
    const x2 = Math.max(0, Math.min(W, (s.end - dayS.getTime()) / dayMs * W));
    if (x2 - x1 < 1) continue;
    out += `<rect x="${x1.toFixed(1)}" y="${y}" width="${(x2 - x1).toFixed(1)}" height="${bh}" rx="3" fill="${s.color}"><title>${escapeHtml(s.label || '')}</title></rect>`;
  }
  [0, 6, 12, 18, 24].forEach(h => {
    const x = h / 24 * W;
    out += `<text x="${h === 0 ? 2 : h === 24 ? W - 2 : x}" y="${H - 2}" text-anchor="${h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}" class="bar-label">${h}点</text>`;
  });
  return `<svg class="tl" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img">${out}</svg>`;
}

/** 图例 rows: [{color,label,value}] → HTML */
export function legend(rows, fmt) {
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  return `<div class="legend">` + rows.filter(r => r.value > 0).map(r =>
    `<div class="legend-row"><span class="dot" style="background:${r.color}"></span>
     <span class="legend-label">${escapeHtml(r.label)}</span>
     <span class="legend-val">${fmt ? fmt(r.value) : r.value}</span>
     <span class="legend-pct">${Math.round(r.value / total * 100)}%</span></div>`
  ).join('') + `</div>`;
}

/** 横向占比条（部位分布）rows: [{color,label,value,text}] */
export function hbars(rows) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return `<div class="hbars">` + rows.map(r => `
    <div class="hbar-row">
      <span class="hbar-label">${escapeHtml(r.label)}</span>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(r.value / max * 100)}%;background:${r.color}"></div></div>
      <span class="hbar-val">${escapeHtml(r.text || '')}</span>
    </div>`).join('') + `</div>`;
}
