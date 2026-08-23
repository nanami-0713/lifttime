// 状态存储：localStorage 持久化 + 订阅刷新（无第三方依赖）
import { uid } from './util.js';

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

export const MEAL_SLOTS = [
  { key: 'breakfast', label: '早餐', icon: '🌅' },
  { key: 'lunch',     label: '午餐', icon: '☀️' },
  { key: 'dinner',    label: '晚餐', icon: '🌙' },
  { key: 'snack',     label: '加餐', icon: '🍪' },
  { key: 'drink',     label: '饮品', icon: '☕' },
  { key: 'supp',      label: '补剂', icon: '💊' },
];

export const EXPENSE_CATS = [
  { key: 'housing',  label: '住房房租', color: '#6366f1' },
  { key: 'food',     label: '餐饮外卖', color: '#ef4444' },
  { key: 'grocery',  label: '食材采购', color: '#22c55e' },
  { key: 'coffee',   label: '咖啡饮品', color: '#a855f7' },
  { key: 'transport',label: '交通',     color: '#3b82f6' },
  { key: 'game',     label: '游戏虚拟', color: '#f97316' },
  { key: 'daily',    label: '生活日用', color: '#14b8a6' },
  { key: 'other',    label: '其他',     color: '#94a3b8' },
];

export function defaults() {
  return {
    version: 1,
    settings: { unit: 'kg', bodyweight: null, theme: 'auto', syncUrl: '', syncToken: '' },
    categories: DEFAULT_CATEGORIES.slice(),
    timer: null,          // { startedAt } 正在进行的练前计时
    timeBlocks: [],       // {id, start, end, cat, note}
    activeWorkout: null,  // {id, startedAt, exercises:[{name, sets:[{w,r,ts}]}], notes}
    workouts: [],         // {id, startedAt, endAt, exercises, feeling, notes, analysis}
    customExercises: {},  // 名称 -> { p:[muscleKey], s:[muscleKey] }
    meals: [],            // {id, date:'YYYY-MM-DD', slot, name, kcal, protein, note}
    expenses: [],         // {id, date:'YYYY-MM-DD', time:'HH:MM', cat, amount, note}
    lastSyncAt: null,     // 上次从 PC 同步的时间戳
    outbox: [],           // 手机离线记录、待推回 PC 的条目 id 队列
  };
}

function load() {
  if (!CAN_PERSIST) return defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const s = JSON.parse(raw);
    const d = defaults();
    return Object.assign(d, s, {
      settings: Object.assign(d.settings, s.settings || {}),
    });
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
  state = Object.assign(defaults(), next, {
    settings: Object.assign(defaults().settings, next.settings || {}),
  });
  commit();
}

export { uid };
