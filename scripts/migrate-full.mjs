#!/usr/bin/env node
// 全量迁移：把会话记录（训练/饮食/开销）生成 lifttime 可导入的完整备份 JSON
// 产出：
//   data/lifttime-full-import.json —— 设置页「导入备份」直接可用（replaceAll 全量格式）
//   data/sync.json                 —— 同步服务分发用（meals+expenses 全量）
// 用法：node scripts/migrate-full.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSession } from '../js/analysis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BILL = 'C:/Users/20931/Desktop/billing-manage';

/* ================= CSV 工具 ================= */

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

function hashId(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return 'x' + (h >>> 0).toString(36);
}

/** 开销分类（支付宝+微信通用关键词） */
function mapCat(note) {
  const n = note || '';
  if (/交租|房租|公寓|电费/.test(n)) return 'housing';
  if (/瑞幸|luckin|咖啡|MOC|茉酸奶|拿铁/.test(n)) return 'coffee';
  if (/鸣潮|游戏|礼包|充值|月相|ANOMALY|浮金|Kimi|深度求索|豆包/.test(n)) return 'game';
  if (/地铁|单车|打车|车费|高铁|铁路/.test(n)) return 'transport';
  if (/流量|话费|移动|联通|电信/.test(n)) return 'other';
  if (/健身房|健身/.test(n)) return 'other';
  if (/巴比馒头|订单付款|麻辣烫|麻辣香锅|麻辣拌|美团|肯德基|KFC|德克士|达美乐|张亮|鸡柳|打抛|外卖|饿了么|香博博|永和|唐福宇|杭景元|幸运卡|抽奖|外卖红包|转账备注/.test(n)) return 'food';
  if (/琵琶腿|五花肉|牛奶|豆浆|青菜|白菜|鸡蛋|吐司|食材|超市|便利店|罗森|全家|UGO|鸥鸟/.test(n)) return 'grocery';
  if (/碗|洗洁精|纸巾|日用|油壶|洗菜盆|螺丝|拆机|锡纸|硅油纸|创可贴|碘伏|鞋/.test(n)) return 'daily';
  return 'other';
}

/** 7 月合并流水（UTF-8）：时间,金额,对方,渠道,日期 —— 对方可能含逗号 */
function parseMergedCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(1).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const cols = parseCsvLine(line);
    if (cols.length < 5) continue;
    const amount = parseFloat(cols[1]);
    if (!(amount > 0)) continue;
    const date = cols[cols.length - 1], time = (cols[0].split(' ')[1] || '00:00').slice(0, 5);
    const note = cols.slice(2, cols.length - 2).join(',');
    out.push({
      id: hashId(cols[0] + amount + note),
      date, time, cat: mapCat(note),
      amount: Math.round(amount * 100) / 100,
      note: note.slice(0, 60),
    });
  }
  return out;
}

/** 支付宝记账本（UTF-8）：记录时间,分类,收支类型,金额,备注,... */
function parseAlipayCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  const hi = lines.findIndex(l => l.startsWith('记录时间'));
  const out = [];
  for (const line of lines.slice(hi + 1)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (cols.length < 5 || cols[2] !== '支出') continue;
    const amount = parseFloat(cols[3].replace(/[,，\s]/g, ''));
    if (!(amount > 0)) continue;
    // 兼容 2026-08-16 03:58:31 与 2026/8/10 21:29 两种格式
    const m = cols[0].match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (!m) continue;
    const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const time = m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : '00:00';
    const note = (cols[4] || '').replace(/-美团App.*$/, '').replace(/外卖订单$/, '');
    out.push({
      id: hashId(cols[0] + amount + note),
      date, time,
      cat: mapCat(note + ' ' + (cols[1] || '')),
      amount: Math.round(amount * 100) / 100,
      note: note.slice(0, 60) || undefined,
    });
  }
  return out;
}

/* ================= 训练数据（来自会话记录 7/7-8/19） ================= */

const T = (date, note, items) => ({ date, note, items });
// items: [ [动作名, [[重量,次数]...], 备选备注], ... ]

const TRAININGS = [
  T('2026-07-07', '第一轮 D1 推类（首次健身房）', [
    ['哑铃卧推', [[20, 10], [20, 10], [20, 10]]],
    ['哑铃推肩', [[20, 6], [20, 6], [20, 6]]],
    ['卧推', [[20, 10], [20, 10], [20, 10]]],
    ['卧推', [[30, 8], [30, 8], [30, 8]]],
  ]),
  T('2026-07-08', '第一轮 D2 拉类', [
    ['高位下拉', [[30, 8], [30, 8], [30, 8]]],
    ['坐姿划船', [[20, 10], [30, 10], [30, 10], [30, 10]]],
    ['高位划船', [[20, 10], [20, 10], [20, 10]]],
    ['机器夹胸', [[30, 8], [30, 8], [30, 8]]],
  ]),
  T('2026-07-09', '第一轮 D3 腿日', [
    ['腿屈伸', [[18.5, 10], [18.5, 10], [18.5, 10], [25, 10], [25, 10], [25, 10]]],
    ['腿弯举', [[23, 10], [23, 10], [23, 10]]],
    ['腿举', [[52, 10], [52, 10], [52, 10]]],
    ['大腿内收', [[31, 10], [31, 10], [31, 10]]],
  ]),
  T('2026-07-10', '主动恢复+轻量推技术', [
    ['卧推', [[30, 10], [35, 10], [35, 10], [35, 10]]],
  ]),
  T('2026-07-14', '第二轮 D5 推（感冒后轻量重启）', [
    ['哑铃卧推', [[18, 10], [18, 10], [18, 10]]],
    ['斜推举', [[20, 8], [20, 8], [20, 8]]],
    ['卧推', [[15, 10], [15, 10], [15, 10]]],
  ]),
  T('2026-07-15', '第二轮 D6 拉（混卧推）', [
    ['高位下拉', [[31.8, 10], [31.8, 10], [31.8, 10]]],
    ['坐姿划船', [[31.8, 10], [31.8, 10], [31.8, 10]]],
    ['卧推', [[35, 10], [35, 10], [35, 10], [35, 10]]],
  ]),
  T('2026-07-16', '第二轮 D7 腿日', [
    ['腿屈伸', [[31.8, 8], [31.8, 8], [31.8, 8]]],
    ['腿弯举', [[27, 8], [27, 8], [27, 8]]],
    ['大腿内收', [[25, 8], [25, 8], [25, 8]]],
    ['大腿外展', [[38.6, 40], [38.6, 40], [38.6, 40]]],
  ]),
  T('2026-07-21', '第三轮 D1 推（重启）', [
    ['哑铃卧推', [[18, 8], [18, 8], [18, 8]]],
    ['夹胸', [[30, 8], [30, 8], [30, 8]]],
    ['卧推', [[45, 10], [45, 10], [45, 10]]],
  ]),
  T('2026-07-22', '第三轮 D2 拉', [
    ['坐姿划船', [[30, 10], [30, 10], [30, 10], [37.5, 10], [37.5, 10]]],
    ['高位下拉', [[25, 10], [25, 10], [25, 10]]],
    ['大腿外展', [[22.5, 8], [22.5, 8], [22.5, 8]]],
  ]),
  T('2026-07-23', '第三轮 D3 腿（首次深蹲）', [
    ['腿举', [[74, 10], [52, 10], [63, 10], [63, 10]]],
    ['腿弯举', [[23, 10], [23, 10], [23, 10]]],
    ['深蹲', [[20, 5], [40, 6], [40, 6]]],
  ]),
  T('2026-07-27', '第三轮 D5 推（50kg里程碑）', [
    ['哑铃卧推', [[18, 10], [18, 10], [18, 10]]],
    ['夹胸', [[31.3, 10], [31.3, 10], [31.3, 10]]],
    ['卧推', [[30, 10], [50, 8], [50, 8]]],
  ]),
  T('2026-07-28', '第三轮 D6 拉（首次硬拉）', [
    ['高位下拉', [[31.8, 10], [31.8, 10], [31.8, 10]]],
    ['坐姿划船', [[30, 10], [30, 10], [30, 10]]],
    ['硬拉', [[35, 6], [35, 10], [35, 10]]],
  ]),
  T('2026-07-29', '第三轮 D7 腿日', [
    ['腿屈伸', [[31.8, 8], [25, 10], [25, 10], [25, 10]]],
    ['腿举', [[52, 10], [63, 10], [63, 10]]],
    ['腿弯举', [[23, 10], [23, 10], [23, 10]]],
    ['硬拉', [[40, 10], [40, 10]]],
  ]),
  T('2026-07-30', '主动恢复日', [
    ['大腿内收', [[25, 8], [25, 12], [25, 12]]],
    ['大腿外展', [[22.7, 10], [22.7, 8], [22.7, 8]]],
    ['高位下拉', [[25, 12], [25, 10], [25, 12]]],
  ]),
  T('2026-08-01', '第四轮 D1 推', [
    ['哑铃卧推', [[18, 10], [18, 10], [18, 10], [18, 10]]],
    ['卧推', [[70, 6], [70, 6], [70, 6]]],
    ['推胸', [[23, 15], [28, 15], [28, 15], [28, 15]]],
  ]),
  T('2026-08-02', '第四轮 D2 拉', [
    ['坐姿划船', [[37.5, 12], [37.5, 12], [37.5, 12]]],
    ['高位下拉', [[25, 15], [25, 15], [25, 10], [25, 10]]],
    ['上斜卧推', [[40, 10], [40, 10], [40, 10], [40, 10]]],
  ]),
  T('2026-08-03', '第四轮 D3 腿（伤口隔离版）', [
    ['腿屈伸', [[25, 10], [25, 10], [25, 10]]],
    ['腿弯举', [[23, 12], [23, 12], [23, 12]]],
    ['大腿内收', [[25, 10], [25, 12], [25, 12], [25, 12]]],
  ]),
  T('2026-08-06', '第五轮 D1 推（肩推入列）', [
    ['哑铃卧推', [[18, 10], [18, 10], [18, 10]]],
    ['哑铃上举', [[18, 8], [18, 8], [18, 5]]],
    ['卧推', [[50, 12], [60, 8], [60, 8]]],
  ]),
  T('2026-08-07', '第五轮 D2 拉', [
    ['高位下拉', [[25, 10], [25, 12], [25, 12]]],
    ['坐姿划船', [[30, 12], [30, 12], [30, 12]]],
    ['大腿外展', [[22.7, 10], [22.7, 10], [22.7, 8], [22.7, 8]]],
  ]),
  T('2026-08-08', '第五轮 D3 全身体能大考（三项PR）', [
    ['腿弯举', [[27, 12], [32, 10], [32, 10], [32, 10]]],
    ['腿屈伸', [[31, 12], [31, 12], [31, 12]]],
    ['深蹲', [[40, 10], [40, 10], [40, 10], [50, 10], [50, 10]]],
    ['硬拉', [[35, 8], [55, 8], [55, 6]]],
    ['卧推', [[60, 10]]],
  ]),
  T('2026-08-11', '第六轮 D1 推（早+晚双练）', [
    ['哑铃卧推', [[18, 10], [18, 10], [18, 10], [18, 12], [18, 12], [20, 10], [20, 10]]],
    ['卧推', [[60, 6], [60, 6], [60, 6], [40, 12], [40, 12], [70, 6], [70, 6]]],
    ['夹胸', [[40, 6]]],
    ['哑铃推肩', [[18, 8], [18, 6]]],
  ]),
  T('2026-08-12', '第六轮 D2 拉（下拉30kg）', [
    ['坐姿划船', [[25, 12], [25, 12], [30, 12], [30, 12]]],
    ['高位下拉', [[25, 12], [25, 12], [30, 8], [30, 8], [30, 8]]],
    ['上斜卧推', [[45, 6], [45, 6]]],
  ]),
  T('2026-08-13', '第六轮 D3 腿（深蹲45kg）', [
    ['深蹲', [[45, 8], [45, 8], [45, 8]]],
    ['腿屈伸', [[31.6, 10], [31.6, 10], [31.6, 10]]],
    ['腿弯举', [[27, 10], [27, 12], [27, 12]]],
  ]),
  T('2026-08-15', '全身体能日（卧推80kg PR）', [
    ['哑铃卧推', [[18, 10], [18, 10], [22, 8], [22, 8]]],
    ['哑铃上举', [[18, 8], [18, 8], [18, 8]]],
    ['弯举', [[20, 10], [20, 8], [20, 8]]],
    ['卧推', [[50, 12], [70, 8], [80, 3], [80, 2]]],
    ['深蹲', [[60, 8]]],
    ['硬拉', [[50, 8], [50, 8]]],
    ['哈克深蹲', [[47, 8]]],
    ['高位下拉', [[25, 12], [25, 15], [25, 16]]],
  ]),
  T('2026-08-16', '推拉混合日（80kg再触）', [
    ['坐姿划船', [[30, 15], [30, 15], [37.5, 10], [37.5, 10]]],
    ['卧推', [[40, 15], [60, 10], [80, 2], [60, 6], [60, 8], [60, 8]]],
  ]),
  T('2026-08-19', '腿日（容量新高4661kg）', [
    ['腿举', [[63, 12], [63, 12], [63, 12]]],
    ['腿屈伸', [[31.8, 8], [31.8, 8]]],
    ['大腿屈曲', [[31.8, 10], [31.8, 10]]],
    ['腿弯举', [[23, 12], [27, 12], [27, 12], [27, 12]]],
  ]),
];

/** 日志动作名 → lifttime 动作库规范名（别名匹配也行，这里直接换标准名） */
const NAME_MAP = {
  '大腿伸展': '腿屈伸', '卧式曲腿': '腿弯举', '大腿屈曲': '腿弯举',
  '坐卧式蹬腿': '腿举', '坐卧蹬腿': '腿举', '坐卧式腿蹬': '腿举',
  '机器夹胸': '夹胸', '双臂内收': '夹胸', '双臂外展': '大腿外展',
  '杠铃弯举': '弯举', '斜推举': '上斜卧推', '史密斯斜推': '上斜卧推', '杠铃斜推': '上斜卧推',
};

/** 自定义动作（动作库没有的）：名称 -> 肌群 */
const CUSTOM_EXERCISES = {
  '哑铃推肩': { p: ['shoulder'], s: ['triceps'] },
  '哑铃上举': { p: ['shoulder'], s: ['triceps'] },
  '高位划船': { p: ['back', 'shoulder'], s: [] },
  '大腿内收': { p: ['quad'], s: [] },
  '大腿外展': { p: ['glute'], s: [] },
  '推胸': { p: ['chest'], s: ['triceps'] },
};

function tsOf(date, hm) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  return new Date(y, mo - 1, d, h || 8, mi || 0).getTime();
}

function buildWorkouts() {
  const workouts = [];
  const history = [];
  for (const t of TRAININGS) {
    const startedAt = tsOf(t.date, '08:00');
    let ts = startedAt + 10 * 60000; // 热身后开始第一组
    const exMap = new Map();
    for (const [rawName, sets] of t.items) {
      const name = NAME_MAP[rawName] || rawName;
      if (!exMap.has(name)) exMap.set(name, []);
      for (const [w, r] of sets) {
        exMap.get(name).push({ w, r, ts });
        ts += 3 * 60000; // 组间 3 分钟
      }
      ts += 2 * 60000; // 换动作
    }
    const endAt = ts + 5 * 60000;
    const w = {
      id: 'w' + t.date.replace(/-/g, ''),
      startedAt, endAt,
      exercises: [...exMap.entries()].map(([name, sets]) => ({ name, sets })),
      feeling: null,
      notes: t.note,
    };
    w.analysis = analyzeSession(w, { history, bodyweight: null, unit: 'kg', custom: CUSTOM_EXERCISES });
    history.push(w);
    workouts.push(w);
  }
  return { workouts, customExercises: CUSTOM_EXERCISES };
}

/* ================= 饮食数据（7/3-8/10 会话记录；8/11+ 读 manual.json） ================= */

const M = (date, slot, name, kcal, protein, note) => ({
  id: 'm' + date.replace(/-/g, '').slice(5) + slot[0] + Math.abs(kcal) + name.length,
  date, slot, name, kcal, protein: protein || 0, note: note || undefined,
});

const MEALS = [
  // ---- 7 月 ----
  M('2026-07-03', 'breakfast', '菜包+肉包+豆浆+蛋×2+美式', 645, 0, '全天仅此一餐'),
  M('2026-07-06', 'breakfast', '炸酱拌面+茶叶蛋+半碗豆浆', 645, 0),
  M('2026-07-06', 'drink', '美式', 5, 0),
  M('2026-07-06', 'dinner', '骨汤麻辣烫（丸子+豆制品+粉丝）', 530, 0),
  M('2026-07-06', 'snack', '脱脂牛奶 250ml', 85, 8),
  M('2026-07-07', 'snack', '练前小餐（豆浆+半根香蕉）', 130, 0),
  M('2026-07-07', 'breakfast', '蛋×2+菜包+豆浆', 500, 0),
  M('2026-07-07', 'drink', '精粹澳瑞白', 130, 0),
  M('2026-07-07', 'drink', '葡萄美式', 50, 0),
  M('2026-07-07', 'dinner', '德克士四件套（加班犒劳）', 1440, 0),
  M('2026-07-08', 'breakfast', '蛋×2+豆浆+蛋白粉', 420, 44),
  M('2026-07-08', 'drink', '佳得乐 300ml', 72, 0),
  M('2026-07-08', 'dinner', '骨汤麻辣烫（骨汤+蒜泥+芝麻酱·12样）', 1215, 35),
  M('2026-07-09', 'snack', '练前豆奶', 100, 0),
  M('2026-07-09', 'breakfast', '蛋×2+菜包+豆浆', 550, 0),
  M('2026-07-09', 'dinner', 'KFC疯狂星期四·香骨鸡×15+低糖绿茶', 1735, 140),
  M('2026-07-10', 'breakfast', '蛋×2+菜包+豆浆', 500, 0),
  M('2026-07-10', 'drink', '加浓美式', 5, 0),
  M('2026-07-10', 'dinner', '室友烧烤局（13串+冰红茶800ml）', 1354, 80),
  M('2026-07-11', 'lunch', '麻辣烫（骨汤版·台风天主餐）', 753, 38),
  M('2026-07-11', 'drink', '雀巢速溶', 5, 0),
  M('2026-07-11', 'dinner', '自热腊肠拌饭', 550, 0),
  M('2026-07-12', 'breakfast', '肉包×2+咸豆花+豆浆', 700, 0),
  M('2026-07-12', 'drink', '雀巢速溶', 5, 0),
  M('2026-07-12', 'dinner', '土豆番茄炖牛肉盖饭', 610, 0),
  M('2026-07-13', 'breakfast', '肉包+菜包+蛋×2+豆浆', 700, 0),
  M('2026-07-13', 'dinner', '西红柿炒蛋盖码饭', 520, 0),
  M('2026-07-14', 'breakfast', '蛋×2+菜包+豆浆', 500, 0),
  M('2026-07-14', 'drink', '雀巢速溶', 5, 0),
  M('2026-07-14', 'dinner', '把子肉+狮子头+米饭', 930, 50),
  M('2026-07-15', 'breakfast', '牛肉包+蛋×2+豆浆', 550, 0),
  M('2026-07-15', 'dinner', '盖码饭（西红柿炒蛋+木耳炒鸡+包菜+狮子头）', 1080, 58),
  M('2026-07-16', 'breakfast', '牛肉包+菜包+蛋+豆浆', 675, 0),
  M('2026-07-16', 'drink', '雀巢速溶', 5, 0),
  M('2026-07-16', 'dinner', '麻辣烫（14样·丰盛）', 1445, 85),
  M('2026-07-17', 'breakfast', '牛肉包+香菇菜包+豆浆', 600, 0),
  M('2026-07-17', 'drink', '雀巢速溶', 5, 0),
  M('2026-07-17', 'dinner', '麻辣烫（27样·极丰盛）', 2215, 90),
  M('2026-07-18', 'breakfast', '牛肉包+香菇菜包+豆浆', 600, 0),
  M('2026-07-18', 'lunch', '豆花烤鱼（爸妈到访）', 650, 0),
  M('2026-07-18', 'dinner', '烤牛排', 500, 0),
  M('2026-07-19', 'lunch', '上海一日游·蟹黄包+小笼包+脊肉冻', 1190, 40),
  M('2026-07-20', 'breakfast', '蛋×2+菜包+豆浆', 500, 0),
  M('2026-07-20', 'lunch', '赛百味热烤牛肉', 350, 0),
  M('2026-07-20', 'dinner', '麻辣烫', 1250, 0),
  M('2026-07-21', 'breakfast', '牛肉包+豆浆', 400, 0),
  M('2026-07-21', 'lunch', '赛百味三明治', 350, 0),
  M('2026-07-21', 'dinner', '麻辣烫（骨汤+麻酱）', 1495, 0),
  M('2026-07-22', 'breakfast', '蛋黄烧麦+蛋+豆浆', 325, 0),
  M('2026-07-22', 'drink', '瑞幸乳酸菌美式', 5, 0),
  M('2026-07-22', 'dinner', '麻辣烫（绿灯版·无炸物五蔬）', 950, 35),
  M('2026-07-22', 'snack', '鲜奶500ml+香蕉', 425, 16),
  M('2026-07-23', 'breakfast', '牛肉包+菜包+鲜奶', 710, 30),
  M('2026-07-23', 'drink', '瑞幸', 5, 0),
  M('2026-07-23', 'lunch', '赛百味', 350, 0),
  M('2026-07-23', 'dinner', 'KFC疯四·香骨鸡×15+可乐', 1305, 130),
  M('2026-07-24', 'drink', '橙C美式', 5, 0),
  M('2026-07-24', 'dinner', '麻辣烫（18样·六蔬）', 1470, 0),
  M('2026-07-25', 'breakfast', '牛肉包+菜包+鲜奶', 645, 0),
  M('2026-07-25', 'drink', '橙C美式', 5, 0),
  M('2026-07-25', 'dinner', '麻辣烫（西红柿汤底）', 650, 0),
  M('2026-07-25', 'drink', '苹果茉莉冰奶', 220, 0),
  M('2026-07-26', 'drink', '瑞幸美式（半杯）', 2, 0),
  M('2026-07-26', 'lunch', '炸串三连（炸年糕+淀粉肠+香肠）', 660, 0),
  M('2026-07-27', 'drink', '绿豆沙拿铁', 200, 0),
  M('2026-07-27', 'dinner', '麻辣烫（七蔬·玉米面）', 1075, 0),
  M('2026-07-28', 'breakfast', '蛋黄烧麦+蛋×2+豆浆', 400, 22),
  M('2026-07-28', 'dinner', '麻辣烫（8蔬·茼蒿首秀）', 1485, 0),
  M('2026-07-29', 'snack', '练前豆奶 300ml', 150, 10),
  M('2026-07-29', 'breakfast', '蛋×2+牛肉包+豆浆', 550, 28),
  M('2026-07-29', 'dinner', '麻辣烫（煎蛋版·炸蛋戒断）', 1095, 35),
  M('2026-07-30', 'snack', '练前豆奶 300ml', 150, 10),
  M('2026-07-30', 'breakfast', '蛋+菜包+豆浆', 425, 22),
  M('2026-07-30', 'lunch', '炸鸡排+炸土豆', 660, 0),
  M('2026-07-30', 'snack', '晚间牛奶+豆奶', 275, 0),
  M('2026-07-31', 'dinner', '德克士犒劳餐（汉堡×2+香骨鸡+可乐）', 1630, 0, '第三轮PPL收官庆祝'),
  // ---- 8 月上半 ----
  M('2026-08-01', 'lunch', '达美乐披萨', 1000, 28, '8月披萨配额'),
  M('2026-08-01', 'dinner', '三文鱼（试吃不惯）+自煎蛋×1', 160, 17, '首个自煎蛋'),
  M('2026-08-01', 'supp', '蛋白粉 500ml', 220, 25),
  M('2026-08-02', 'breakfast', '自煎蛋×1（淋水盖盖法）', 100, 7),
  M('2026-08-02', 'lunch', '吐司×4', 400, 12),
  M('2026-08-02', 'snack', '练前豆奶400ml+吐司×2', 400, 18),
  M('2026-08-02', 'dinner', '肉酿青椒（自煮第2道）', 450, 30),
  M('2026-08-02', 'supp', '蛋白粉+牛奶400ml', 300, 32),
  M('2026-08-03', 'snack', '练前豆奶 300ml', 150, 10),
  M('2026-08-03', 'breakfast', '练后吐司+牛奶', 550, 18),
  M('2026-08-03', 'lunch', '麻辣烫', 900, 35),
  M('2026-08-03', 'drink', '香蕉拿铁', 200, 6),
  M('2026-08-03', 'drink', '草莓奶', 100, 3),
  M('2026-08-03', 'snack', '北海道吐司', 200, 6),
  M('2026-08-04', 'breakfast', '吐司×2+豆奶', 450, 18),
  M('2026-08-04', 'lunch', '麻辣烫', 900, 35),
  M('2026-08-04', 'dinner', '吐司+牛奶', 400, 14),
  M('2026-08-05', 'breakfast', '吐司×2', 320, 10),
  M('2026-08-05', 'lunch', '麻辣烫', 900, 35),
  M('2026-08-05', 'drink', '拿铁×2', 400, 12),
  M('2026-08-06', 'snack', '练前豆奶 300ml', 150, 10),
  M('2026-08-06', 'breakfast', '练后吐司+牛奶+蛋白粉', 550, 35),
  M('2026-08-06', 'drink', '瑞幸大菠萝冷萃拿铁', 220, 6),
  M('2026-08-07', 'snack', '练前豆奶 200ml', 100, 7),
  M('2026-08-07', 'breakfast', '吐司×3+牛奶+蛋白粉', 620, 40),
  M('2026-08-07', 'dinner', '徽菜（请客）', 1050, 45),
  M('2026-08-08', 'lunch', '五花肉炒杭白菜（首道自炒蔬菜）', 450, 25),
  M('2026-08-08', 'drink', '练前拿铁 200ml', 110, 5),
  M('2026-08-08', 'supp', '练后蛋白粉+牛奶300ml', 270, 30),
  M('2026-08-08', 'dinner', '五花+杭白菜+虾仁+蛋液（识图满分）', 600, 48),
  M('2026-08-09', 'breakfast', '吐司×2+豆奶+自煎蛋', 340, 19),
  M('2026-08-09', 'lunch', '抱蛋煎饺8个+煎蛋', 700, 28),
  M('2026-08-09', 'dinner', '照烧鸡肉串×3+虾仁饺子卧蛋', 950, 58, '第四道自煮菜'),
  M('2026-08-10', 'breakfast', '吐司×2+豆奶500ml+煎蛋', 425, 24),
  M('2026-08-10', 'snack', '肉松小贝×3', 495, 10),
  M('2026-08-10', 'dinner', '焖鸡肉串×4+煎蛋', 705, 43),
  M('2026-08-10', 'snack', '铁板蛋炒饭（外卖）', 750, 18),
];

/* ================= 开销数据 ================= */

function buildExpenses() {
  const out = [];
  const julyCsv = path.join(BILL, '7月账单', '7月合并流水_支付宝+微信.csv');
  if (fs.existsSync(julyCsv)) {
    const list = parseMergedCsv(julyCsv);
    console.log(`[7月合并CSV] ${list.length} 笔`);
    out.push(...list);
  }
  const augEarly = path.join(ROOT, 'data', 'alipay_0801_0810_utf8.csv');
  if (fs.existsSync(augEarly)) {
    const list = parseAlipayCsv(augEarly);
    console.log(`[8月上旬记账本] ${list.length} 笔`);
    out.push(...list);
  }
  const augMid = path.join(ROOT, 'data', 'alipay_0816_utf8.csv');
  if (fs.existsSync(augMid)) {
    const list = parseAlipayCsv(augMid);
    console.log(`[8月中旬记账本] ${list.length} 笔`);
    out.push(...list);
  }
  const manual = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manual.json'), 'utf8'));
  out.push(...(manual.expenses || []));
  // id 去重
  const seen = new Set();
  return out.filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}

/* ================= 组装 ================= */

function main() {
  const { workouts, customExercises } = buildWorkouts();
  const manual = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manual.json'), 'utf8'));
  const meals = [...MEALS, ...(manual.meals || [])]
    .filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i)
    .sort((a, b) => a.date.localeCompare(b.date));
  const expenses = buildExpenses();

  const state = {
    version: 1,
    settings: { unit: 'kg', bodyweight: null, theme: 'auto', syncUrl: '', syncToken: '' },
    categories: undefined, // undefined 字段 JSON.stringify 会丢弃 → 导入后 replaceAll 会用 defaults 补
    timer: null,
    timeBlocks: [],
    activeWorkout: null,
    workouts,
    customExercises,
    meals,
    expenses,
    lastSyncAt: null,
    outbox: [],
    _budget: [
      { month: '2026-07', rule: '非房租目标 ≤¥1,500｜实际 ¥5,263（AI充值¥1,046待报销另计）' },
      { month: '2026-08', rule: '非房租 ≤¥2,500 全月｜8/11-8/31 支付宝池 ¥1,500（日均 ¥80）' },
    ],
  };
  // categories 需要具体值（导入校验只查 workouts/timeBlocks，但 replaceAll 需要 categories 存在）
  state.categories = [
    { key: 'warmup', label: '热身激活', color: '#f59e0b' },
    { key: 'strength', label: '力量训练', color: '#ef4444' },
    { key: 'cardio', label: '有氧', color: '#f97316' },
    { key: 'stretch', label: '拉伸放松', color: '#22c55e' },
    { key: 'commute', label: '通勤往返', color: '#3b82f6' },
    { key: 'meal', label: '备餐加餐', color: '#a855f7' },
    { key: 'supplement', label: '补剂', color: '#14b8a6' },
    { key: 'shower', label: '洗漱整理', color: '#64748b' },
    { key: 'other', label: '其他', color: '#94a3b8' },
  ];

  const outFull = path.join(ROOT, 'data', 'lifttime-full-import.json');
  fs.writeFileSync(outFull, JSON.stringify(state, null, 1));

  // sync.json：meals + expenses 全量（供局域网同步）
  const outSync = path.join(ROOT, 'data', 'sync.json');
  fs.writeFileSync(outSync, JSON.stringify({ exportedAt: new Date().toISOString(), meals, expenses }, null, 1));

  /* 统计验证 */
  const julExp = expenses.filter(e => e.date.startsWith('2026-07'));
  const augExp = expenses.filter(e => e.date.startsWith('2026-08'));
  console.log('\n===== 迁移统计 =====');
  console.log(`训练: ${workouts.length} 次（${workouts[0].notes} ~ ${workouts[workouts.length - 1].notes}）`);
  const totalVol = workouts.reduce((s, w) => s + (w.analysis?.totals?.tonnage || 0), 0);
  console.log(`  总容量(自重除外): ${Math.round(totalVol)} kg`);
  console.log(`饮食: ${meals.length} 条（${meals[0].date} ~ ${meals[meals.length - 1].date}）`);
  console.log(`开销: ${expenses.length} 笔`);
  console.log(`  7月: ${julExp.length} 笔 ¥${julExp.reduce((s, e) => s + e.amount, 0).toFixed(2)}（对照账面 ¥7,963.26）`);
  console.log(`  8月: ${augExp.length} 笔 ¥${augExp.reduce((s, e) => s + e.amount, 0).toFixed(2)}（对照 8/1-10 ¥818.34 + 8/11-17 ¥382.33）`);
  console.log(`\n[done] ${outFull}`);
  console.log(`[done] ${outSync}`);
}

main();
