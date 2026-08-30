// 通用工具（纯函数，无 DOM，浏览器与 Node 均可使用）
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function pad2(n) { return (n < 10 ? '0' : '') + n; }

/** 本地时区的 YYYY-MM-DD */
export function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** 本地时区某天的 00:00 与次日 00:00 时间戳 */
export function dayRange(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const start = d.getTime();
  return { start, end: start + 86400000 };
}

export function dayStart(ts) { return dayRange(ts).start; }

/** 本地时区 HH:MM */
export function fmtHM(ts) {
  const d = new Date(ts);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/** 毫秒 → "1小时23分" / "45分" / "12秒" */
export function fmtDur(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + '秒';
  const m = Math.floor(s / 60);
  if (m < 60) return m + '分';
  const h = Math.floor(m / 60);
  return h + '小时' + (m % 60 ? (m % 60) + '分' : '');
}

/** 毫秒 → "1:23:45" / "12:34" */
export function fmtClock(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h > 0 ? h + ':' + pad2(m) + ':' + pad2(ss) : pad2(m) + ':' + pad2(ss);
}

export function minutes(ms) { return Math.round(ms / 60000); }

/** 分钟 → "1h23m" / "45m"（图表用） */
export function fmtMin(m) {
  if (m < 60) return m + 'm';
  return Math.floor(m / 60) + 'h' + (m % 60 ? (m % 60) + 'm' : '');
}

/** M月D日 / 今天 / 昨天 */
export function fmtDateCN(ts, now) {
  now = now || Date.now();
  const k = dayKey(ts), nk = dayKey(now);
  if (k === nk) return '今天';
  if (dayKey(now - 86400000) === k) return '昨天';
  const d = new Date(ts);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

export function fmtWeekday(ts) {
  return '周' + '日一二三四五六'.charAt(new Date(ts).getDay());
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** 只允许十六进制颜色进入 style/SVG 上下文，其余回退到安全色 */
export function safeColor(v, fallback = '#94a3b8') {
  return (typeof v === 'string' && HEX_COLOR_RE.test(v)) ? v : fallback;
}

/** 重量显示：内部一律存 kg，按单位换算显示 */
export function kgToUnit(kg, unit) {
  if (unit === 'lb') return Math.round(kg * 2.20462 * 10) / 10;
  return Math.round(kg * 10) / 10;
}
export function fmtLoad(kg, unit) {
  if (kg == null || !(kg > 0)) return '自重';
  const v = kgToUnit(kg, unit);
  return (Math.round(v * 10) / 10) + (unit === 'lb' ? 'lb' : 'kg');
}
export function fmtNum(v) {
  if (v == null || !isFinite(v)) return '0';
  return Math.round(v).toLocaleString('zh-CN');
}
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** 把 "HH:MM" 当天时间转时间戳 */
export function hmToTs(dateKey, hm) {
  const [y, mo, d] = dateKey.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  return new Date(y, mo - 1, d, h || 0, mi || 0, 0, 0).getTime();
}

/** 近 n 天（含今天）的 dayKey 列表，旧→新 */
export function lastNDays(n, now) {
  const out = [];
  const base = dayStart(now == null ? Date.now() : now);
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(base - i * 86400000));
  return out;
}
