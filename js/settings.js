// 设置页：单位/主题/体重、时间分类管理、数据导入导出、安装说明
import { getState, commit, replaceAll, defaults, CAN_PERSIST } from './store.js';
import { openSheet, confirmD, toast, applyTheme, deferredInstall, isStandalone, isIOS, APP_VERSION, APP_NAME, nav } from './app.js';
import { escapeHtml } from './util.js';

const PALETTE = ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#64748b'];

export function render(root) {
  const st = getState();
  root.innerHTML = `
    <div class="card">
      <h2>个人</h2>
      <div class="form-row">
        <div class="field">
          <label>体重（用于蛋白质建议，kg）</label>
          <input id="st-bw" type="number" inputmode="decimal" min="0" step="0.1" placeholder="如 70"
            value="${st.settings.bodyweight || ''}">
        </div>
        <div class="field">
          <label>重量单位</label>
          <select id="st-unit">
            <option value="kg" ${st.settings.unit === 'kg' ? 'selected' : ''}>kg（公斤）</option>
            <option value="lb" ${st.settings.unit === 'lb' ? 'selected' : ''}>lb（磅）</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label>外观</label>
        <select id="st-theme">
          <option value="auto" ${st.settings.theme === 'auto' ? 'selected' : ''}>跟随系统</option>
          <option value="light" ${st.settings.theme === 'light' ? 'selected' : ''}>浅色</option>
          <option value="dark" ${st.settings.theme === 'dark' ? 'selected' : ''}>深色</option>
        </select>
      </div>
      <p class="hint" style="margin-top:0">体重只存在你手机本地，用于把「每公斤 1.6–2.2g 蛋白质」换算成具体克数。</p>
    </div>

    <div class="card">
      <h2>时间分类</h2>
      <div class="rows" id="cat-rows"></div>
      <button class="btn btn-ghost btn-small" id="cat-add" style="margin-top:10px">＋ 新增分类</button>
    </div>

    <div class="card">
      <h2>数据</h2>
      <p class="hint" style="margin:0 0 12px">所有数据仅保存在本机浏览器里${CAN_PERSIST ? '' : '（注意：当前环境无法持久保存，请尽快导出）'}，换手机/清缓存前记得导出备份。</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" id="data-export" style="flex:1">导出备份</button>
        <button class="btn" id="data-import" style="flex:1">导入备份</button>
        <button class="btn btn-ghost" id="data-clear" style="flex:1;color:var(--brand)">清空数据</button>
      </div>
      <input type="file" id="import-file" accept=".json,application/json" style="display:none">
    </div>

    <div class="card">
      <h2>局域网同步</h2>
      <p class="hint" style="margin:0 0 12px">和电脑同一 WiFi 时，把 PC 上整理的饮食/开销记录拉到手机，手机离线记的也会推回 PC。地址形如 <code>http://192.168.1.5:8131</code>。</p>
      <div class="field"><label>PC 同步地址</label>
        <input id="st-sync-url" placeholder="http://192.168.x.x:8131" inputmode="url" value="${escapeHtml(st.settings.syncUrl || '')}">
      </div>
      <div class="field"><label>配对 token（PC 启动服务时显示）</label>
        <input id="st-sync-token" placeholder="lt-xxxxxxxx" value="${escapeHtml(st.settings.syncToken || '')}">
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-ghost" id="sync-test" style="flex:1">测试连接</button>
        <button class="btn btn-primary" id="sync-now" style="flex:1">立即同步</button>
      </div>
      ${st.lastSyncAt ? `<p class="hint" style="margin:10px 0 0">上次同步：${new Date(st.lastSyncAt).toLocaleString('zh-CN')}</p>` : ''}
    </div>

    <div class="card">
      <h2>安装到手机</h2>
      <div id="install-box"></div>
    </div>

    <div class="card">
      <h2>关于</h2>
      <p style="font-size:13.5px;margin:4px 0">${APP_NAME} v${APP_VERSION} · 离线优先 · 数据不出本机</p>
      <p class="hint" style="margin:0">时间分配 · 训练记录 · 部位分析 · 恢复建议。后续会加入更多生活板块（睡眠、饮食、学习…）。
      源码与更新说明见 <a href="https://github.com/nanami-0713/lifttime" target="_blank" rel="noopener">GitHub 仓库</a>。</p>
    </div>`;

  root.querySelector('#st-bw').addEventListener('change', e => {
    const v = parseFloat(e.target.value);
    getState().settings.bodyweight = v > 0 ? v : null;
    commit();
    toast(v > 0 ? '已保存体重 ' + v + 'kg' : '已清除体重');
  });
  root.querySelector('#st-unit').addEventListener('change', e => {
    getState().settings.unit = e.target.value;
    commit();
  });
  root.querySelector('#st-theme').addEventListener('change', e => {
    getState().settings.theme = e.target.value;
    commit();
    applyTheme();
  });

  renderCats(root);
  root.querySelector('#cat-add').addEventListener('click', catAddSheet);

  root.querySelector('#data-export').addEventListener('click', doExport);
  root.querySelector('#data-import').addEventListener('click', () => root.querySelector('#import-file').click());
  root.querySelector('#import-file').addEventListener('change', doImport);
  root.querySelector('#data-clear').addEventListener('click', doClear);

  root.querySelector('#st-sync-url').addEventListener('change', e => {
    getState().settings.syncUrl = e.target.value.trim();
    commit();
  });
  root.querySelector('#st-sync-token').addEventListener('change', e => {
    getState().settings.syncToken = e.target.value.trim();
    commit();
  });
  root.querySelector('#sync-test').addEventListener('click', async () => {
    const url = (getState().settings.syncUrl || '').replace(/\/+$/, '');
    if (!url) { toast('先填 PC 同步地址'); return; }
    try {
      const r = await fetch(url + '/api/health');
      const j = await r.json();
      toast(j.ok ? `连接成功：${j.counts.meals} 饮食 / ${j.counts.expenses} 开销待同步` : '服务在线但返回异常');
    } catch { toast('连不上 PC：检查同一 WiFi、地址端口、防火墙'); }
  });
  root.querySelector('#sync-now').addEventListener('click', async () => {
    const { doSync } = await import('./diet.js');
    await doSync(false);
  });

  renderInstall(root);
}

function renderCats(root) {
  const st = getState();
  const el = root.querySelector('#cat-rows');
  el.innerHTML = st.categories.map((c, i) => `
    <div class="row" data-i="${i}">
      <span class="bar-mark" style="background:${c.color}"></span>
      <div class="row-main"><div class="row-title">${escapeHtml(c.label)}</div></div>
      <button class="icon-btn cat-del" data-key="${c.key}" aria-label="删除分类">✕</button>
    </div>`).join('');
  el.querySelectorAll('.cat-del').forEach(b => b.addEventListener('click', async () => {
    const st2 = getState();
    if (st2.categories.length <= 1) { toast('至少保留一个分类'); return; }
    const key = b.dataset.key;
    const c = st2.categories.find(x => x.key === key);
    if (await confirmD('删除分类「' + c.label + '」？已有记录会归入最后一个分类。', { danger: true, yes: '删除' })) {
      const store = getState();
      store.categories = store.categories.filter(x => x.key !== key);
      commit();
    }
  }));
}

function catAddSheet() {
  const st = getState();
  let color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field"><label>分类名称</label><input id="ca-label" maxlength="8" placeholder="如：冥想 / 遛狗 / 加班"></div>
    <div class="field"><label>颜色</label><div class="chips" id="ca-colors"></div></div>
    <button class="btn btn-primary btn-xl" id="ca-save">保存</button>`;
  const chips = body.querySelector('#ca-colors');
  const paint = () => {
    chips.innerHTML = PALETTE.map(c =>
      `<button class="chip ${c === color ? 'selected' : ''}" data-c="${c}" style="padding:6px 10px"><span class="dot" style="background:${c};width:16px;height:16px"></span></button>`).join('');
  };
  paint();
  chips.addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    color = b.dataset.c;
    paint();
  });
  const { close } = openSheet('新增时间分类', body, { sticky: true });
  body.querySelector('#ca-save').addEventListener('click', () => {
    const label = body.querySelector('#ca-label').value.trim();
    if (!label) { toast('先填名称'); return; }
    const store = getState();
    if (store.categories.some(c => c.label === label)) { toast('已有同名分类'); return; }
    store.categories.push({ key: 'c' + Date.now().toString(36), label, color });
    commit();
    close();
    toast('已新增分类「' + label + '」');
  });
}

function doExport() {
  const st = getState();
  const data = JSON.stringify(st, null, 2);
  const d = new Date();
  const name = 'lifttime-' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '.json';
  try {
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 400);
    toast('已导出 ' + name);
  } catch (e) {
    toast('导出失败：' + (e && e.message ? e.message : '浏览器不支持'));
  }
}

function doImport(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const obj = JSON.parse(String(reader.result));
      if (!obj || typeof obj !== 'object' || !Array.isArray(obj.workouts) || !Array.isArray(obj.timeBlocks)) {
        throw new Error('文件格式不像练时备份');
      }
      const okBtn = await confirmD('导入会覆盖当前全部数据（' + obj.workouts.length + ' 次训练、' + obj.timeBlocks.length + ' 段时间记录），确定？', { danger: true, yes: '覆盖导入' });
      if (!okBtn) return;
      replaceAll(obj);
      toast('导入完成');
      nav('time');
    } catch (err) {
      toast('导入失败：' + (err && err.message ? err.message : '文件无法解析'));
    }
  };
  reader.readAsText(file);
}

async function doClear() {
  if (!(await confirmD('清空全部数据（时间记录、训练、自定义动作）？此操作不可恢复。', { danger: true, yes: '继续' }))) return;
  if (!(await confirmD('再确认一次：真的要清空所有数据？建议先导出备份。', { danger: true, yes: '全部清空' }))) return;
  replaceAll(defaults());
  toast('已清空');
  nav('time');
}

function renderInstall(root) {
  const box = root.querySelector('#install-box');
  if (isStandalone()) {
    box.innerHTML = '<p class="hint" style="margin:0">✓ 已经作为独立 App 运行，可离线使用。</p>';
    return;
  }
  let html = '';
  if (deferredInstall) {
    html += `<button class="btn btn-primary btn-xl" id="btn-install">安装到主屏幕</button>`;
  }
  if (isIOS()) {
    html += `<p class="hint" style="margin:10px 0 0">iPhone/iPad：点浏览器底部「分享」按钮 → 「添加到主屏幕」，即可像原生 App 一样全屏离线使用。</p>`;
  } else {
    html += `<p class="hint" style="margin:10px 0 0">Android/Chrome：浏览器菜单 →「安装应用」/「添加到主屏幕」。电脑 Chrome/Edge 地址栏右侧也有安装图标。</p>`;
  }
  box.innerHTML = html;
  const btn = box.querySelector('#btn-install');
  if (btn) btn.addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    try { await deferredInstall.userChoice; } catch (e) { /* 忽略 */ }
    toast('如果没弹出安装窗口，可用浏览器菜单里的「添加到主屏幕」');
  });
}
