// 设置页：单位/主题/体重、时间分类管理、数据导入导出、安装说明
import { getState, commit, replaceAll, defaults, CAN_PERSIST } from './store.js';
import { openSheet, confirmD, toast, applyTheme, deferredInstall, isStandalone, isIOS, APP_VERSION, APP_NAME, nav } from './app.js';
import { escapeHtml, safeColor } from './util.js';
import { aiConfig, callAI, AI_DEFAULTS } from './ai.js';

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
            value="${escapeHtml(st.settings.bodyweight || '')}">
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
      <h2>🤖 AI 简评（可选）</h2>
      <p class="hint" style="margin:0 0 12px">接入智谱 GLM 后，每次训练结束用大模型生成简评（不写 Key 则继续用内置规则版）。Key 只保存在本机，浏览器直连智谱；注意「导出备份」会包含 Key。</p>
      <div class="field">
        <label>智谱 API Key（GLM Coding Plan）</label>
        <input id="ai-key" type="password" autocomplete="off" placeholder="粘贴你的 API Key" value="${escapeHtml(st.settings.aiKey || '')}">
      </div>
      <div class="form-row">
        <div class="field">
          <label>模型</label>
          <input id="ai-model" placeholder="${AI_DEFAULTS.model}" value="${escapeHtml(st.settings.aiModel || '')}">
        </div>
        <div class="field">
          <label>思考强度</label>
          <select id="ai-effort">
            <option value="max" ${(st.settings.aiEffort || 'max') === 'max' ? 'selected' : ''}>max（深度）</option>
            <option value="high" ${st.settings.aiEffort === 'high' ? 'selected' : ''}>high（增强）</option>
            <option value="low" ${st.settings.aiEffort === 'low' ? 'selected' : ''}>low（轻量）</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label>接口地址（默认 Coding Plan 端点，跨域被拦可改自部署代理）</label>
        <input id="ai-baseurl" placeholder="${AI_DEFAULTS.baseUrl}" value="${escapeHtml(st.settings.aiBaseUrl || '')}">
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-primary" id="ai-save" style="flex:1.4">保存配置</button>
        <button class="btn" id="ai-test" style="flex:1">测试连接</button>
        <button class="btn btn-ghost" id="ai-clear" style="flex:1;color:var(--brand)">清除</button>
      </div>
      <p class="hint" id="ai-status" style="margin:8px 0 0">${st.settings.aiKey ? '✓ 已配置，训练结束将自动生成 AI 简评' : ''}</p>
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

  bindAI(root);

  root.querySelector('#data-export').addEventListener('click', doExport);
  root.querySelector('#data-import').addEventListener('click', () => root.querySelector('#import-file').click());
  root.querySelector('#import-file').addEventListener('change', doImport);
  root.querySelector('#data-clear').addEventListener('click', doClear);

  renderInstall(root);
}

function bindAI(root) {
  const statusEl = root.querySelector('#ai-status');
  root.querySelector('#ai-save').addEventListener('click', () => {
    const store = getState();
    const key = root.querySelector('#ai-key').value.trim();
    store.settings.aiKey = key || null;
    store.settings.aiModel = root.querySelector('#ai-model').value.trim() || null;
    store.settings.aiEffort = root.querySelector('#ai-effort').value || null;
    store.settings.aiBaseUrl = root.querySelector('#ai-baseurl').value.trim() || null;
    commit();
    statusEl.textContent = key ? '✓ 已配置，训练结束将自动生成 AI 简评' : '已清除 Key，继续使用内置规则版简评';
    toast(key ? 'AI 简评已开启' : '已保存');
  });
  root.querySelector('#ai-clear').addEventListener('click', async () => {
    if (!(await confirmD('清除 AI 配置（Key、模型、接口）？', { danger: true, yes: '清除' }))) return;
    const store = getState();
    store.settings.aiKey = null;
    store.settings.aiModel = null;
    store.settings.aiEffort = null;
    store.settings.aiBaseUrl = null;
    commit();
    root.querySelector('#ai-key').value = '';
    root.querySelector('#ai-model').value = '';
    root.querySelector('#ai-baseurl').value = '';
    statusEl.textContent = '';
    toast('已清除 AI 配置');
  });
  root.querySelector('#ai-test').addEventListener('click', async e => {
    // 直接用当前输入构造配置测试（不 commit，避免整页重渲染导致状态元素脱落）
    const cfg = aiConfig({
      aiKey: root.querySelector('#ai-key').value.trim() || null,
      aiModel: root.querySelector('#ai-model').value.trim() || null,
      aiEffort: root.querySelector('#ai-effort').value || null,
      aiBaseUrl: root.querySelector('#ai-baseurl').value.trim() || null,
    });
    if (!cfg) { statusEl.textContent = '先填 API Key'; return; }
    const btn = e.target;
    btn.disabled = true;
    statusEl.textContent = '测试中（模型思考需要一点时间）…';
    const t0 = Date.now();
    try {
      const text = await callAI(cfg, [{ role: 'user', content: '只回复两个字：正常' }]);
      statusEl.textContent = '✓ 连接成功（' + ((Date.now() - t0) / 1000).toFixed(1) + 's，模型 ' + cfg.model + '）：' + text.slice(0, 30);
    } catch (err) {
      statusEl.textContent = '✗ ' + (err && err.message ? err.message : '连接失败');
    }
    btn.disabled = false;
  });
}

function renderCats(root) {
  const st = getState();
  const el = root.querySelector('#cat-rows');
  el.innerHTML = st.categories.map((c, i) => `
    <div class="row" data-i="${i}">
      <span class="bar-mark" style="background:${safeColor(c.color)}"></span>
      <div class="row-main"><div class="row-title">${escapeHtml(c.label)}</div></div>
      <button class="icon-btn cat-del" data-key="${escapeHtml(c.key)}" aria-label="删除分类">✕</button>
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
  if (file.size > 50 * 1024 * 1024) { toast('导入失败：文件过大（超过 50MB）'); return; }
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
