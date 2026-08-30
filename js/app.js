// 应用外壳：路由 / 主题 / 弹层与提示等全局工具
import { getState, on, CAN_PERSIST } from './store.js';
import { fmtDateCN, fmtWeekday, escapeHtml } from './util.js';
import * as timeTab from './time.js';
import * as workoutTab from './workout.js';
import * as dietTab from './diet.js';
import * as budgetTab from './budget.js';
import * as reportTab from './report.js';
import * as settingsTab from './settings.js';

export const APP_VERSION = '1.3.0';
export const APP_NAME = '练时 LiftTime';

const TABS = {
  time: { label: '时间', mod: timeTab },
  workout: { label: '训练', mod: workoutTab },
  diet: { label: '饮食', mod: dietTab },
  budget: { label: '预算', mod: budgetTab },
  report: { label: '报告', mod: reportTab },
  settings: { label: '设置', mod: settingsTab },
};

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
let current = 'time';

export function nav(tab, opts) {
  if (!TABS[tab]) return;
  current = tab;
  if (opts && opts.keepScroll) renderTab(window.scrollY);
  else renderTab(0);
}

function renderTab(scrollTo) {
  scrollTo = scrollTo == null ? window.scrollY : scrollTo;
  tabbar.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tab === current));
  view.innerHTML = '';
  TABS[current].mod.render(view);
  window.scrollTo(0, scrollTo || 0);
}

// 数据变化 → 刷新当前页（弹层挂在 body 上不受影响）
on(() => renderTab(window.scrollY));

/* ---------- 全局 UI 工具 ---------- */

/** 底部弹层。body: HTMLElement 或 HTML 字符串 */
export function openSheet(title, body, opts) {
  opts = opts || {};
  const ov = document.createElement('div');
  ov.className = 'sheet-ov';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = `<div class="sheet-grip"></div>
    <div class="sheet-head"><h3>${escapeHtml(title)}</h3><button class="icon-btn" data-close aria-label="关闭">✕</button></div>
    <div class="sheet-body"></div>`;
  const bodyEl = sheet.querySelector('.sheet-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else bodyEl.appendChild(body);
  ov.appendChild(sheet);
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('open'));
  const close = () => {
    ov.classList.remove('open');
    setTimeout(() => ov.remove(), 210);
    if (opts.onClose) opts.onClose();
  };
  ov.addEventListener('click', e => { if (e.target === ov && !opts.sticky) close(); });
  sheet.querySelector('[data-close]').addEventListener('click', close);
  return { ov, sheet, body: bodyEl, close };
}

let toastTimer = null;
export function toast(msg, ms) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2200);
}

/** 确认弹层 → Promise<boolean> */
export function confirmD(msg, opts) {
  opts = opts || {};
  return new Promise(resolve => {
    const { close } = openSheet(opts.title || '确认', `
      <p style="font-size:14.5px;margin:4px 0 16px">${escapeHtml(msg)}</p>
      <div style="display:flex;gap:10px">
        <button class="btn btn-ghost" data-no style="flex:1">取消</button>
        <button class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}" data-yes style="flex:1">${escapeHtml(opts.yes || '确定')}</button>
      </div>`, { sticky: true });
    const ov = document.querySelector('.sheet-ov:last-child');
    ov.querySelector('[data-no]').onclick = () => { close(); resolve(false); };
    ov.querySelector('[data-yes]').onclick = () => { close(); resolve(true); };
  });
}

/* ---------- 主题 ---------- */

export function applyTheme() {
  const t = getState().settings.theme || 'auto';
  let resolved = t;
  if (t === 'auto') {
    resolved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', resolved);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0b0f14' : '#f3f4f6');
}
if (window.matchMedia) {
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme); } catch (e) { /* 旧浏览器 */ }
}
applyTheme();

/* ---------- PWA 安装 ---------- */

export let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstall = e;
});
export function isStandalone() {
  return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
}
export function isIOS() { return /iphone|ipad|ipod/i.test(window.navigator.userAgent); }

/* ---------- 启动 ---------- */

(function init() {
  const now = Date.now();
  document.getElementById('top-date').textContent =
    fmtDateCN(now) + ' ' + fmtWeekday(now) + (fmtDateCN(now) === '今天' ? '' : '');
  tabbar.addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (b) nav(b.dataset.tab);
  });
  renderTab(0);
  if (!CAN_PERSIST) {
    toast('当前浏览器无法持久保存数据（可能是隐私模式），数据仅本次有效，请尽早导出备份', 4200);
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      // 自动更新：新 SW 激活接管后自动刷新一次，让用户永远跑最新版
      const hadController = !!navigator.serviceWorker.controller;
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing || !hadController) return;
        refreshing = true;
        toast('已更新到最新版本');
        setTimeout(() => location.reload(), 600);
      });
      navigator.serviceWorker.register('./sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              toast('发现新版本，正在后台更新…');
            }
          });
        });
        reg.update().catch(() => { /* 忽略 */ });
      }).catch(() => { /* 离线能力降级，不影响使用 */ });
    });
  }
})();
