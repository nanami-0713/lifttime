#!/usr/bin/env node
// 导出脚本：把支付宝记账本 CSV + 手工整理 JSON 合并成 data/sync.json（供 sync-server 分发）
// 用法：node scripts/export.mjs [--csv 路径] [--manual 路径] [--out 路径] [--since 2026-08-11]
//   --csv    支付宝记账本 CSV（GBK 编码），可多个：--csv a.csv --csv b.csv
//   --manual 手工整理的饮食/消费 JSON（默认 data/manual.json，格式 {meals:[], expenses:[]}）
//   --out    输出文件（默认 data/sync.json）
//   --since  只保留该日期（含）之后的记录
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
function argOf(name, def) { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : def; }
function argAll(name) { const out = []; for (let i = 0; i < args.length; i++) if (args[i] === '--' + name && args[i + 1]) out.push(args[++i]); return out; }

const csvFiles = argAll('csv');
const manualFile = argOf('manual', path.join(ROOT, 'data', 'manual.json'));
const outFile = argOf('out', path.join(ROOT, 'data', 'sync.json'));
const since = argOf('since', '');

/* ---------- GBK CSV 解析 ---------- */

function decodeCsv(buf, file) {
  // 顺序：BOM → 纯ASCII → 严格UTF-8（成功即UTF-8）→ GBK/GB18030
  const head = buf.subarray(0, 3);
  if (head[0] === 0xEF && head[1] === 0xBB && head[2] === 0xBF) return buf.toString('utf8');
  if (buf.every(b => b < 0x80)) return buf.toString('utf8');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { /* 非 UTF-8 */ }
  try { return new TextDecoder('gbk').decode(buf); } catch { }
  try { return new TextDecoder('gb18030').decode(buf); } catch { }
  // Windows PowerShell 一行转 UTF-8：
  //   [IO.File]::WriteAllText('out.csv',[IO.File]::ReadAllText('in.csv',[Text.Encoding]::GetEncoding(936)),[Text.UTF8Encoding]::new($false))
  throw new Error(`${file}: 含 GBK 中文但当前 Node 不带 gbk 解码器。请先转 UTF-8：
  pwsh> [IO.File]::WriteAllText('utf8.csv',[IO.File]::ReadAllText('${file}',[Text.Encoding]::GetEncoding(936)),[Text.UTF8Encoding]::new($false))`);
}

function parseCsvLine(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

/** 支付宝分类 → app 开销分类 */
function mapCat(cat, note) {
  const n = note || '';
  if (/交租|房租|公寓管家/.test(n)) return 'housing';
  if (/瑞幸|luckin|咖啡|MOC/.test(n)) return 'coffee';
  if (/鸣潮|游戏|礼包|充值|月相/.test(n)) return 'game';
  if (/地铁|单车|打车|车费/.test(n)) return 'transport';
  if (/麻辣烫|麻辣香锅|麻辣拌|外卖|美团|肯德基|KFC|德克士|达美乐|张亮|鸡柳|打抛饭|瑞幸/.test(n)) return 'food';
  if (cat === '购物' || /琵琶腿|五花肉|牛奶|豆浆|青菜|白菜|鸡蛋|吐司|食材|超市/.test(n)) return 'grocery';
  if (cat === '生活日用' || /碗|洗洁精|纸巾|日用品/.test(n)) return 'daily';
  return 'other';
}

function hashId(str) {
  // 稳定 id：同一天+同金额+同备注 → 同 id，重复导入可去重
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return 'x' + (h >>> 0).toString(36);
}

function parseAlipayCsv(file) {
  const text = decodeCsv(fs.readFileSync(file), file).replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  const hi = lines.findIndex(l => l.startsWith('记录时间'));
  if (hi < 0) throw new Error(file + ' 里找不到「记录时间」表头');
  const expenses = [];
  for (const line of lines.slice(hi + 1)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (cols.length < 5) continue;
    const [time, cat, type, amountRaw, note] = cols;
    if (type !== '支出') continue;
    const amount = parseFloat(String(amountRaw).replace(/[,，\s]/g, ''));
    if (!(amount > 0)) continue;
    const m = time.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T]?(\d{1,2})?:?(\d{2})?/);
    if (!m) continue;
    const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const hh = (m[4] || '0').padStart(2, '0');
    const mm = (m[5] || '00').padStart(2, '0');
    expenses.push({
      id: hashId(date + hh + mm + amount + (note || '')),
      date,
      time: `${hh}:${mm}`,
      cat: mapCat(cat, note),
      amount: Math.round(amount * 100) / 100,
      note: (note || '').replace(/-美团App.*$/, '').replace(/外卖订单$/, '').slice(0, 60) || undefined,
    });
  }
  return expenses;
}

/* ---------- 合并 ---------- */

function main() {
  let meals = [], expenses = [];

  for (const f of csvFiles) {
    const list = parseAlipayCsv(f);
    console.log(`[csv] ${path.basename(f)}: ${list.length} 笔支出`);
    expenses.push(...list);
  }

  if (fs.existsSync(manualFile)) {
    const m = JSON.parse(fs.readFileSync(manualFile, 'utf8'));
    meals.push(...(m.meals || []));
    expenses.push(...(m.expenses || []));
    console.log(`[manual] ${path.basename(manualFile)}: +${(m.meals || []).length} 饮食 +${(m.expenses || []).length} 开销`);
  } else {
    console.log(`[manual] ${manualFile} 不存在，跳过`);
  }

  if (since) {
    expenses = expenses.filter(e => e.date >= since);
    meals = meals.filter(m2 => m2.date >= since);
  }

  // 按 id 去重（manual 优先于 csv）
  const seen = new Set();
  expenses = expenses.filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  const seenM = new Set();
  meals = meals.filter(m2 => (seenM.has(m2.id) ? false : (seenM.add(m2.id), true)));

  expenses.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  meals.sort((a, b) => a.date.localeCompare(b.date));

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ exportedAt: new Date().toISOString(), meals, expenses }, null, 1));
  console.log(`\n[done] ${outFile}`);
  console.log(`  饮食 ${meals.length} 条（${meals[0]?.date || '-'} ~ ${meals[meals.length - 1]?.date || '-'}）`);
  console.log(`  开销 ${expenses.length} 笔（${expenses[0]?.date || '-'} ~ ${expenses[expenses.length - 1]?.date || '-'}）`);
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  console.log(`  开销合计 ¥${total.toFixed(2)}`);
}

main();
