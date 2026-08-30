// 状态存储：localStorage 持久化 + 订阅刷新（无第三方依赖）
import { uid, safeColor } from './util.js';

const KEY = 'lifttime.v1';

function storageUsable() {
  try {
    const k = '__lt_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch (e) { return false; }
}
export const CAN_PERSIST = storageUsable();

export const DEFAULT_CATEGORIES = [
  { key: 'warmup',     label: '热身激活', color: '#f59e0b' },
  { key: 'strength',   label: '力量训练', color: '#ef4444' },
  { key: 'cardio',     label: '有氧',     color: '#f97316' },
  { key: 'stretch',    label: '拉伸放松', color: '#22c55e' },
  { key: 'commute',    label: '通勤往返', color: '#3b82f6' },
  { key: 'meal',       label: '备餐加餐', color: '#a855f7' },
  { key: 'supplement', label: '补剂',     color: '#14b8a6' },
  { key: 'shower',     label: '洗漱整理', color: '#64748b' },
  { key: 'other',      label: '其他',     color: '#94a3b8' },
];

export function defaults() {
  return {
    version: 1,
    settings: { unit: 'kg', bodyweight: null, theme: 'auto', weeklyBudget: null, monthlyBudget: null, customBudgets: [], aiKey: null, aiBaseUrl: null, aiModel: null, aiEffort: null },
    categories: DEFAULT_CATEGORIES.slice(),
    timer: null,          // { startedAt } 正在进行的练前计时
    timeBlocks: [],       // {id, start, end, cat, note}
    activeWorkout: null,  // {id, startedAt, exercises:[{name, sets:[{w,r,ts}]}], notes}
    workouts: [],         // {id, startedAt, endAt, exercises, feeling, notes, analysis}
    customExercises: {},  // 名称 -> { p:[muscleKey], s:[muscleKey] }
    dietEntries: [],      // {id, ts, meal, text, items, unmatched, kcal, p, c, f, cost?}
    expenses: [],         // {id, ts, amount, cat, note}
  };
}

/* ---------- 导入/本地状态净化：构建有边界的规范状态，防恶意备份注入 ---------- */

const MAX_STR = 2000;        // 单字符串长度上限
const MAX_ARR = 1000;        // 嵌套数组长度上限
const MAX_ENTRIES = 100000;  // 记录集合条数上限
const MAX_KEYS = 100;        // 单对象键数上限
const SAFE_KEY = /^[A-Za-z0-9_-]{1,40}$/;
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function cleanNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 有界深净化：只保留 JSON 安全的标量/数组/纯对象，剔除原型敏感键 */
function cleanVal(v, depth) {
  if (v == null) return v;
  const t = typeof v;
  if (t === 'number') return Number.isFinite(v) ? v : null;
  if (t === 'boolean') return v;
  if (t === 'string') return v.length > MAX_STR ? v.slice(0, MAX_STR) : v;
  if (t !== 'object' || depth <= 0) return null;
  if (Array.isArray(v)) {
    return v.slice(0, MAX_ARR).map(x => cleanVal(x, depth - 1));
  }
  const out = {};
  for (const k of Object.keys(v)) {
    if (BAD_KEYS.has(k)) continue;
    if (Object.keys(out).length >= MAX_KEYS) break;
    out[k] = cleanVal(v[k], depth - 1);
  }
  return out;
}

function cleanCategories(v) {
  if (!Array.isArray(v)) return null;
  const seen = new Set();
  const out = [];
  for (const c of v.slice(0, MAX_ARR)) {
    if (!c || typeof c !== 'object') continue;
    let key = typeof c.key === 'string' && SAFE_KEY.test(c.key) ? c.key : null;
    if (!key || seen.has(key)) key = uid();
    seen.add(key);
    const label = (typeof c.label === 'string' && c.label.trim()) ? c.label.slice(0, 64) : '未命名';
    out.push({ key, label, color: safeColor(c.color) });
  }
  return out.length ? out : null;
}

function cleanSettings(s) {
  const d = defaults().settings;
  if (!s || typeof s !== 'object') return d;
  const bw = cleanNum(s.bodyweight);
  const wb = cleanNum(s.weeklyBudget);
  const mb = cleanNum(s.monthlyBudget);
  return {
    unit: s.unit === 'lb' ? 'lb' : 'kg',
    bodyweight: bw != null && bw > 0 && bw < 2000 ? bw : null,
    theme: ['auto', 'light', 'dark'].includes(s.theme) ? s.theme : 'auto',
    weeklyBudget: wb != null && wb >= 0 ? wb : null,
    monthlyBudget: mb != null && mb >= 0 ? mb : null,
    customBudgets: (Array.isArray(s.customBudgets) ? s.customBudgets : []).slice(0, MAX_ARR).map(p => {
      if (!p || typeof p !== 'object') return null;
      const amount = cleanNum(p.amount), days = cleanNum(p.days), startTs = cleanNum(p.startTs);
      if (amount == null || amount < 0 || days == null || days <= 0 || startTs == null) return null;
      return { id: typeof p.id === 'string' && SAFE_KEY.test(p.id) ? p.id : uid(), name: String(p.name == null ? '' : p.name).slice(0, 64), amount, days, startTs };
    }).filter(Boolean),
  };
}

function cleanRecords(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, MAX_ENTRIES)
    .map(x => cleanVal(x, 6))
    .filter(x => x && typeof x === 'object' && !Array.isArray(x))
    .map(x => (typeof x.id === 'string' && x.id ? x : Object.assign({ id: uid() }, x)));
}

function cleanCustomExercises(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  for (const k of Object.keys(v).slice(0, MAX_ARR)) {
    if (BAD_KEYS.has(k)) continue;
    const e = v[k];
    if (!e || typeof e !== 'object') continue;
    const pick = a => (Array.isArray(a) ? a.slice(0, 20).filter(x => typeof x === 'string' && x.length <= 40) : []);
    out[String(k).slice(0, 100)] = { p: pick(e.p), s: pick(e.s) };
  }
  return out;
}

/**
 * 把不可信的对象（导入的备份 / 本地持久化数据）净化为规范状态：
 * 只保留已知字段，字符串/数组/集合有界，分类与设置结构化校验。
 */
export function sanitizeState(next) {
  const d = defaults();
  if (!next || typeof next !== 'object' || Array.isArray(next)) return d;
  return {
    version: d.version,
    settings: cleanSettings(next.settings),
    categories: cleanCategories(next.categories) || d.categories,
    timer: next.timer && typeof next.timer === 'object' ? { startedAt: cleanNum(next.timer.startedAt) || Date.now() } : null,
    timeBlocks: cleanRecords(next.timeBlocks),
    activeWorkout: cleanVal(next.activeWorkout, 6),
    workouts: cleanRecords(next.workouts),
    customExercises: cleanCustomExercises(next.customExercises),
    dietEntries: cleanRecords(next.dietEntries),
    expenses: cleanRecords(next.expenses),
  };
}

function load() {
  if (!CAN_PERSIST) return defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    // 本地持久化数据同样过一遍净化，清掉历史版本可能写入的异常字段
    return sanitizeState(JSON.parse(raw));
  } catch (e) { return defaults(); }
}

let state = load();
const subs = new Set();
let saveTimer = null;

function persistNow() {
  if (!CAN_PERSIST) return;
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { /* 隐私模式/空间不足：静默降级为内存态 */ }
}

/** 任何状态修改后调用：防抖持久化 + 通知订阅者 */
export function commit() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; persistNow(); }, 120);
  persistNow(); // 立即也写一次，防抖只是避免高频 JSON 化
  subs.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } });
}

export function getState() { return state; }
export function on(fn) { subs.add(fn); return () => subs.delete(fn); }

export function catOf(key) {
  return state.categories.find(c => c.key === key) || state.categories[state.categories.length - 1];
}

export function replaceAll(next) {
  state = sanitizeState(next);
  commit();
}

export { uid };
