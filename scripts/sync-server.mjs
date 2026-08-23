#!/usr/bin/env node
// 练时 LiftTime 局域网同步服务（PC 端真相源）
// 用法：node scripts/sync-server.mjs [--port 8131] [--token XXX]
//   GET  /api/health        → {ok:true, counts:{meals,expenses}}
//   GET  /api/data?token=   → {serverTime, meals, expenses}
//   POST /api/push {token, meals[], expenses[]} → 写入 data/inbox.json，返回 {ok, accepted}
// 数据文件：data/sync.json（由 export 脚本生成/合并）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const SYNC_FILE = path.join(DATA_DIR, 'sync.json');
const INBOX_FILE = path.join(DATA_DIR, 'inbox.json');

const args = process.argv.slice(2);
function argOf(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const PORT = parseInt(argOf('port', '8131'), 10);

// token：--token 参数 > data/token.txt > 自动生成并写回
let TOKEN = argOf('token', '');
if (!TOKEN) {
  const tokenFile = path.join(DATA_DIR, 'token.txt');
  try { TOKEN = fs.readFileSync(tokenFile, 'utf8').trim(); } catch { }
  if (!TOKEN) {
    TOKEN = 'lt-' + Math.random().toString(36).slice(2, 10);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(tokenFile, TOKEN, { mode: 0o600 });
  }
}

function readJson(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}

function localIPs() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const it of ifs[name]) {
      if (it.family === 'IPv4' && !it.internal) out.push(it.address);
    }
  }
  return out;
}

function authorized(req, url) {
  const h = req.headers['x-lt-token'];
  if (h && h === TOKEN) return true;
  const t = url.searchParams.get('token');
  return t === TOKEN;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-LT-Token');
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    const sync = readJson(SYNC_FILE, { meals: [], expenses: [] });
    return json(res, 200, { ok: true, counts: { meals: sync.meals.length, expenses: sync.expenses.length } });
  }

  if (req.method === 'GET' && url.pathname === '/api/data') {
    if (!authorized(req, url)) return json(res, 403, { ok: false, error: 'token 不对' });
    const sync = readJson(SYNC_FILE, { meals: [], expenses: [] });
    return json(res, 200, { serverTime: Date.now(), meals: sync.meals, expenses: sync.expenses });
  }

  if (req.method === 'POST' && url.pathname === '/api/push') {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 2e6) req.destroy(); });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}');
        // 鉴权：header / query / body 任一
        const okAuth = authorized(req, url) || (typeof body.token === 'string' && body.token === TOKEN);
        if (!okAuth) return json(res, 403, { ok: false, error: 'token 不对' });
        const inbox = readJson(INBOX_FILE, { meals: [], expenses: [] });
        (body.meals || []).forEach(m => inbox.meals.push({ ...m, pushedAt: Date.now() }));
        (body.expenses || []).forEach(x => inbox.expenses.push({ ...x, pushedAt: Date.now() }));
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(INBOX_FILE, JSON.stringify(inbox, null, 1));
        console.log(`[inbox] +${(body.meals || []).length} 饮食 +${(body.expenses || []).length} 开销（累计待入档 ${inbox.meals.length + inbox.expenses.length} 条）`);
        json(res, 200, { ok: true, accepted: { meals: (body.meals || []).length, expenses: (body.expenses || []).length } });
      } catch (e) {
        json(res, 400, { ok: false, error: 'bad json' });
      }
    });
    return;
  }

  json(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  const sync = readJson(SYNC_FILE, { meals: [], expenses: [] });
  console.log('练时同步服务已启动');
  console.log(`  数据: ${SYNC_FILE}（${sync.meals.length} 饮食 / ${sync.expenses.length} 开销）`);
  console.log(`  token: ${TOKEN}`);
  console.log('  手机 app 里填以下任一地址：');
  localIPs().forEach(ip => console.log(`    http://${ip}:${PORT}`));
  if (!localIPs().length) console.log(`    http://127.0.0.1:${PORT}（仅本机）`);
});
