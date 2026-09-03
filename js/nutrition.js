// 饮食分析引擎：文本解析 + 日/阶段总结 + 建议 + 训练联动（纯函数，可单测）
import { findFood } from './foods.js';
import { dayKey, dayRange, lastNDays } from './util.js';

export const MEALS = [
  { key: 'breakfast',   label: '早餐',   color: '#f59e0b' },
  { key: 'lunch',       label: '午餐',   color: '#f97316' },
  { key: 'dinner',      label: '晚餐',   color: '#6366f1' },
  { key: 'snack',       label: '加餐',   color: '#a855f7' },
  { key: 'preworkout',  label: '练前餐', color: '#14b8a6' },
  { key: 'postworkout', label: '练后餐', color: '#22c55e' },
];
export function mealOf(key) { return MEALS.find(m => m.key === key) || MEALS[3]; }

const CN_NUM = { '半': 0.5, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
// 中国市制单位：两 = 50g（「二两白酒」）
const UNIT_GRAMS = { '两': 50 };

/**
 * 解析一段食物描述，如 "2个鸡蛋"、"一杯牛奶"、"200g鸡胸肉"、"米饭300g"。
 * customFoods: 用户自定义食物库（优先于内置库）
 * 返回 { name, grams, kcal, p, c, f, matched } 或 { text, matched:false }
 */
function parseSegment(seg, customFoods) {
  const text = seg.trim();
  if (!text) return null;
  let qty = null, unit = '', rest = text;

  const lead = text.match(/^([0-9]+(?:\.[0-9]+)?|半|一|二|两|三|四|五|六|七|八|九|十)(kg|g|克|毫升|ml|升|l|个|只|杯|碗|份|根|片|块|勺|把|罐|瓶|包|盒|球|串|角|条|颗|粒|盘|屉|袋|套|餐|瓣|段|卷|听|两)?/i);
  if (lead) {
    qty = CN_NUM[lead[1]] != null ? CN_NUM[lead[1]] : parseFloat(lead[1]);
    unit = (lead[2] || '').toLowerCase();
    rest = text.slice(lead[0].length);
  } else {
    // 尾部数量："米饭300g"
    const tail = text.match(/(.+?)([0-9]+(?:\.[0-9]+)?)(kg|g|克|毫升|ml)$/i);
    if (tail) {
      qty = parseFloat(tail[2]);
      unit = tail[3].toLowerCase();
      rest = tail[1];
    }
  }

  const food = findFood(rest, customFoods);
  if (!food) return { text, matched: false };

  let grams;
  if (unit === 'g' || unit === '克') grams = qty;
  else if (unit === 'kg') grams = qty * 1000;
  else if (unit === 'ml' || unit === '毫升') grams = qty;      // 液体密度≈1
  else if (unit === 'l' || unit === '升') grams = qty * 1000;
  else if (UNIT_GRAMS[unit]) grams = qty * UNIT_GRAMS[unit];   // 两 → 50g
  else grams = (qty == null ? 1 : qty) * food.g;               // 按份数

  const r = grams / 100;
  return {
    name: food.n,
    label: (qty != null ? (lead ? lead[1] : String(qty)) + (lead && lead[2] ? lead[2] : unit ? unit : food.u) : '1' + food.u) + food.n,
    grams: Math.round(grams),
    kcal: Math.round(food.k * r),
    p: Math.round(food.p * r * 10) / 10,
    c: Math.round(food.c * r * 10) / 10,
    f: Math.round(food.f * r * 10) / 10,
    tags: food.t || [],
    matched: true,
  };
}

/**
 * 解析整段描述（顿号/逗号/加号/换行分隔）。
 * customFoods: 用户自定义食物库（优先于内置库）
 * 返回 { items: [...], unmatched: [...], kcal, p, c, f }
 */
export function parseMealText(text, customFoods) {
  const parts = String(text || '').split(/[，,、；;+\n]+/);
  const items = [], unmatched = [];
  for (const p of parts) {
    const r = parseSegment(p, customFoods);
    if (!r) continue;
    if (r.matched) items.push(r); else unmatched.push(r.text);
  }
  return {
    items, unmatched,
    kcal: items.reduce((a, i) => a + i.kcal, 0),
    p: Math.round(items.reduce((a, i) => a + i.p, 0) * 10) / 10,
    c: Math.round(items.reduce((a, i) => a + i.c, 0) * 10) / 10,
    f: Math.round(items.reduce((a, i) => a + i.f, 0) * 10) / 10,
  };
}

/* ---------- 未识别食物的估算助手 ---------- */

/** 粗类别均值（每 100g 的 kcal/蛋白/碳水/脂肪 + 默认份克数） */
export const ESTIMATE_CATS = [
  { key: 'meat',   label: '肉菜/荤菜',   per100: { k: 190, p: 17, c: 3,  f: 12 }, grams: 200 },
  { key: 'staple', label: '主食',        per100: { k: 150, p: 4,  c: 30, f: 1.5 }, grams: 250 },
  { key: 'veg',    label: '素菜/蔬菜',   per100: { k: 50,  p: 2.5,c: 6,  f: 2.5 }, grams: 200 },
  { key: 'soup',   label: '汤/羹',       per100: { k: 45,  p: 2.5,c: 5,  f: 1.5 }, grams: 300 },
  { key: 'snack',  label: '零食/甜点',   per100: { k: 420, p: 6,  c: 58, f: 18 }, grams: 100 },
  { key: 'drink',  label: '饮品',        per100: { k: 45,  p: 1,  c: 9,  f: 1.5 }, grams: 300 },
  { key: 'mixed',  label: '混合菜/盖饭', per100: { k: 150, p: 7,  c: 18, f: 6 }, grams: 350 },
  { key: 'other',  label: '其他',        per100: { k: 200, p: 8,  c: 20, f: 9 }, grams: 200 },
];
export function estCatOf(key) { return ESTIMATE_CATS.find(c => c.key === key) || ESTIMATE_CATS[ESTIMATE_CATS.length - 1]; }

const GUESS_RULES = [
  ['soup', /汤|羹/],
  ['drink', /奶茶|果汁|咖啡|可乐|雪碧|啤|红酒|白酒|豆浆|酸奶|鲜奶|柠檬茶|茶$|饮|汁$/],
  ['snack', /蛋糕|糖果|饼干|薯片|巧克力|冰淇淋|雪糕|甜甜圈|布丁|蛋挞|麻花|辣条|爆米花/],
  ['staple', /炒饭|炒面|饭|面条|米线|米粉|馒头|包子|饺|馄饨|馍|寿司|三明治|汉堡|意面|拉面|河粉|粥|饼(?!干)/],
  ['meat', /鸡|鸭|鹅|牛|羊|猪|鱼|虾|蟹|肉|排骨|肘|蹄|香肠|火腿|丸|翅|扒/],
  ['veg', /菜|沙拉|蔬|菌|菇|木耳|海带/],
];

/** 从文本里抠克数："佛跳墙300g" → 300；"1.5kg" → 1500 */
export function extractGrams(text) {
  const m = String(text || '').match(/([0-9]+(?:\.[0-9]+)?)\s*(kg|g|克|毫升|ml)/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return /kg/i.test(m[2]) ? Math.round(v * 1000) : Math.round(v);
}

/** 按关键词猜类别 */
export function guessCategory(text) {
  const t = String(text || '');
  for (const [key, re] of GUESS_RULES) {
    if (re.test(t)) return key;
  }
  return 'other';
}

/** 类别 + 克数 → 估算宏量营养素 */
export function estimateFor(catKey, grams) {
  const c = estCatOf(catKey);
  const r = (grams > 0 ? grams : c.grams) / 100;
  return {
    kcal: Math.round(c.per100.k * r),
    p: Math.round(c.per100.p * r * 10) / 10,
    c: Math.round(c.per100.c * r * 10) / 10,
    f: Math.round(c.per100.f * r * 10) / 10,
  };
}

/** 对一段未识别文本给出完整猜测：类别 + 克数 + 估算值 */
export function guessFor(text) {
  const catKey = guessCategory(text);
  const grams = extractGrams(text) || estCatOf(catKey).grams;
  return Object.assign({ catKey, grams }, estimateFor(catKey, grams));
}

/** 解析结果 + 手估条目 → 这一餐总宏量 */
export function entryTotals(parsed, manualItems) {
  const t = { kcal: parsed.kcal, p: parsed.p, c: parsed.c, f: parsed.f };
  for (const m of (manualItems || [])) {
    t.kcal += m.kcal || 0; t.p += m.p || 0; t.c += m.c || 0; t.f += m.f || 0;
  }
  t.p = Math.round(t.p * 10) / 10;
  t.c = Math.round(t.c * 10) / 10;
  t.f = Math.round(t.f * 10) / 10;
  return t;
}

/** 从原始文本提取干净食物名（去前导数量与尾部克数），用作自定义食物库键名 */
export function cleanFoodName(text) {
  let s = String(text || '').trim();
  s = s.replace(/^([0-9]+(?:\.[0-9]+)?|半|一|二|两|三|四|五|六|七|八|九|十)(kg|g|克|毫升|ml|升|l|个|只|杯|碗|份|根|片|块|勺|把|罐|瓶|包|盒|球|串|角|条|颗|粒|盘|屉|袋|套|餐|瓣|段|卷|听|两)?/i, '');
  s = s.replace(/([0-9]+(?:\.[0-9]+)?)(kg|g|克|毫升|ml)$/i, '');
  return s.trim() || String(text || '').trim();
}

/** 把一条手估条目学进自定义食物库（归一为每 100g）。返回入库条目或 null */
export function learnFood(manualItem) {
  if (!manualItem || !(manualItem.grams > 0) || !(manualItem.kcal > 0)) return null;
  const name = cleanFoodName(manualItem.name);
  if (!name || name.length > 20) return null;
  const r = 100 / manualItem.grams;
  const r1 = v => Math.round((v || 0) * r * 10) / 10;
  return { name, g: Math.round(manualItem.grams), u: '份', k: Math.round(manualItem.kcal * r), p: r1(manualItem.p), c: r1(manualItem.c), f: r1(manualItem.f) };
}

/** 营养目标（按体重；无体重用通用默认） */
export function targets(bodyweight, trainedToday) {
  const bw = bodyweight > 0 ? bodyweight : 0;
  const proteinLo = bw ? Math.round(bw * 1.6) : 80;
  const proteinHi = bw ? Math.round(bw * 2.2) : 110;
  const cal = bw ? Math.round(bw * 30) : 2000;
  return {
    cal, proteinLo, proteinHi,
    proteinTarget: Math.round((proteinLo + proteinHi) / 2),
    carbs: Math.round(cal * 0.5 / 4),
    fat: Math.round(cal * 0.27 / 9),
    trainedToday: !!trainedToday,
  };
}

/** 汇总某时间范围内的饮食记录 */
export function summarize(entries) {
  const t = { kcal: 0, p: 0, c: 0, f: 0, items: 0, unmatched: 0, byMeal: {}, tags: {} };
  for (const e of entries || []) {
    t.kcal += e.kcal || 0; t.p += e.p || 0; t.c += e.c || 0; t.f += e.f || 0;
    t.items += (e.items || []).length;
    t.unmatched += (e.unmatched || []).length;
    const mk = e.meal || 'snack';
    if (!t.byMeal[mk]) t.byMeal[mk] = { kcal: 0, count: 0 };
    t.byMeal[mk].kcal += e.kcal || 0;
    t.byMeal[mk].count++;
    for (const it of (e.items || [])) for (const tag of (it.tags || [])) {
      t.tags[tag] = (t.tags[tag] || 0) + 1;
    }
  }
  t.p = Math.round(t.p * 10) / 10;
  t.c = Math.round(t.c * 10) / 10;
  t.f = Math.round(t.f * 10) / 10;
  return t;
}

export function entriesOfDay(dietEntries, ts) {
  const { start, end } = dayRange(ts);
  return (dietEntries || []).filter(e => e.ts >= start && e.ts < end).sort((a, b) => a.ts - b.ts);
}

/**
 * 当日饮食建议。ctx: { bodyweight, now, workoutsToday: [{endAt, primaryLabels}] }
 */
export function dailyAdvice(entries, ctx) {
  ctx = ctx || {};
  const s = summarize(entries);
  const tg = targets(ctx.bodyweight, (ctx.workoutsToday || []).length > 0);
  const now = ctx.now || Date.now();
  const hour = new Date(now).getHours();
  const advice = [];
  if (!entries.length) return { summary: s, targets: tg, advice: ['今天还没记饮食，点「记一餐」开始。'] };

  // —— 训练联动 ——
  const wos = ctx.workoutsToday || [];
  if (wos.length) {
    const lastWo = wos[wos.length - 1];
    const sinceEnd = lastWo.endAt ? now - lastWo.endAt : Infinity;
    const postEaten = entries.some(e =>
      (e.meal === 'postworkout' && e.ts >= (lastWo.startedAt || 0)) ||
      (lastWo.endAt && e.ts >= lastWo.endAt - 10 * 60000 && e.ts <= lastWo.endAt + 2.5 * 3600000 && e.meal !== 'preworkout'));
    if (postEaten) {
      advice.push('练后餐已经吃上了 ✓ 蛋白质到位的话，今晚恢复会顺很多。');
    } else if (sinceEnd < 2.5 * 3600000) {
      advice.push('刚练完' + (lastWo.primaryLabels ? '（' + lastWo.primaryLabels + '）' : '') +
        '，练后 2 小时是补充窗口：来一餐 30–40g 蛋白质 + 碳水，比如蛋白粉+香蕉，或鸡胸+米饭。');
    }
    if (s.p < tg.proteinLo) {
      advice.push('今天练了' + (lastWo.primaryLabels ? lastWo.primaryLabels : '力量') +
        '，蛋白质目前约 ' + Math.round(s.p) + 'g，离目标 ' + tg.proteinLo + '–' + tg.proteinHi + 'g 还差不少，下一餐优先补蛋白。');
    }
  }

  // —— 目标进度 ——
  if (!wos.length && s.p < tg.proteinLo * 0.6 && hour >= 17) {
    advice.push('今天蛋白质偏少（约 ' + Math.round(s.p) + 'g / 目标 ' + tg.proteinLo + 'g 起），晚餐加个蛋、鸡胸或一杯希腊酸奶。');
  }
  if (s.kcal > 0 && s.kcal < tg.cal * 0.5 && hour >= 19) {
    advice.push('到今天晚上热量还不到目标一半，除非在刻意减脂，否则建议正常吃晚餐——吃太少会影响恢复和训练状态。');
  }
  if (s.kcal > tg.cal * 1.35) {
    advice.push('今天热量约为目标的 ' + Math.round(s.kcal / tg.cal * 100) + '%，如果近阶段目标是减脂，明天适当收一收；在增肌的话就安心吃。');
  }
  if (!s.tags.veg && !s.tags.fruit && hour >= 15) {
    advice.push('今天还没吃蔬菜水果，加一份西兰花/番茄或一个苹果，微量营养素和纤维对恢复同样重要。');
  }
  const late = entries.some(e => new Date(e.ts).getHours() >= 21 && (e.meal === 'snack'));
  if (late) advice.push('晚上 9 点后有加餐记录，偶尔无妨；如果经常睡前饿，可以把晚餐蛋白比例抬高一点。');
  const junkCount = (s.tags.junk || 0);
  if (junkCount >= 3) advice.push('今天高油糖食物有点多（' + junkCount + ' 项），明天让天然食物唱主角。');
  if (s.unmatched > 0) advice.push('有 ' + s.unmatched + ' 项食物没识别出来，热量为估算下限；可以改写成「2个鸡蛋」这种带数量的说法提高准确度。');

  if (!advice.length) advice.push('今天吃得不错，结构均衡，继续保持。');
  return { summary: s, targets: tg, advice: advice.slice(0, 4) };
}

/**
 * 阶段饮食总结（近 N 天）。ctx: { bodyweight, workouts }
 */
export function periodDiet(dietEntries, days, ctx) {
  ctx = ctx || {};
  const now = ctx.now || Date.now();
  const keys = lastNDays(days, now);
  const byDay = {};
  keys.forEach(k => { byDay[k] = []; });
  for (const e of (dietEntries || [])) {
    const k = dayKey(e.ts);
    if (byDay[k]) byDay[k].push(e);
  }
  const daySums = keys.map(k => ({ key: k, entries: byDay[k], sum: summarize(byDay[k]) }));
  const daysWithFood = daySums.filter(d => d.entries.length > 0);
  const n = daysWithFood.length || 1;
  const avg = {
    kcal: Math.round(daySums.reduce((a, d) => a + d.sum.kcal, 0) / n),
    p: Math.round(daySums.reduce((a, d) => a + d.sum.p, 0) / n * 10) / 10,
    c: Math.round(daySums.reduce((a, d) => a + d.sum.c, 0) / n * 10) / 10,
    f: Math.round(daySums.reduce((a, d) => a + d.sum.f, 0) / n * 10) / 10,
  };
  const tg = targets(ctx.bodyweight, false);
  const proteinHitDays = daysWithFood.filter(d => d.sum.p >= tg.proteinLo).length;

  // 食物频次
  const freq = {};
  for (const d of daysWithFood) for (const e of d.entries) for (const it of (e.items || [])) {
    freq[it.name] = (freq[it.name] || 0) + 1;
  }
  const topFoods = Object.keys(freq).map(k => ({ name: k, count: freq[k] })).sort((a, b) => b.count - a.count).slice(0, 5);

  // 训练×饮食联动：训练日蛋白质达标率
  const workouts = ctx.workouts || [];
  const trainedKeys = new Set();
  for (const w of workouts) {
    const k = dayKey(w.startedAt);
    if (byDay[k] !== undefined) trainedKeys.add(k);
  }
  const trainedWithFood = [...trainedKeys].filter(k => byDay[k] && byDay[k].length);
  const trainedHit = trainedWithFood.filter(k => summarize(byDay[k]).p >= tg.proteinLo);
  const trainingLink = {
    trainedDays: trainedKeys.size,
    proteinHitOnTrainedDays: trainedHit.length,
    trackedTrainedDays: trainedWithFood.length,
  };

  const lateDays = daysWithFood.filter(d => d.entries.some(e => new Date(e.ts).getHours() >= 21 && e.meal === 'snack')).length;

  // 建议
  const advice = [];
  if (!daysWithFood.length) {
    advice.push('这个时间段还没有饮食记录。');
  } else {
    if (proteinHitDays / daysWithFood.length < 0.5) {
      advice.push('近 ' + days + ' 天只有 ' + proteinHitDays + '/' + daysWithFood.length + ' 天蛋白质达标。最简单的做法：每餐先确定蛋白来源（蛋/奶/肉/豆制品/蛋白粉），再配主食和蔬菜。');
    }
    if (avg.kcal > tg.cal * 1.2) advice.push('日均热量约为目标的 ' + Math.round(avg.kcal / tg.cal * 100) + '%，如果近期训练量在涨可以保留，否则主食和零食各收一档。');
    if (avg.kcal > 0 && avg.kcal < tg.cal * 0.7) advice.push('日均热量只有目标的 ' + Math.round(avg.kcal / tg.cal * 100) + '%，长期吃太少训练状态会掉，留意是否有乏力、恢复变慢。');
    if (trainingLink.trainedDays >= 2 && trainingLink.trackedTrainedDays > 0) {
      const rate = Math.round(trainingLink.proteinHitOnTrainedDays / trainingLink.trackedTrainedDays * 100);
      if (rate < 60) advice.push('训练日蛋白质达标率只有 ' + rate + '%——训练日的恢复质量直接取决于这一天的吃，练后餐别省。');
      else advice.push('训练日蛋白质达标率 ' + rate + '%，饮食在支撑训练，节奏不错。');
    }
    if (lateDays >= 2) advice.push('有 ' + lateDays + ' 天在晚上 9 点后加餐，可以尝试把更多热量匀到白天。');
    if (!advice.length) advice.push('饮食结构稳定，继续保持当前的节奏。');
  }

  return {
    days, keys, daySums, daysTracked: daysWithFood.length,
    avg, proteinHitDays, topFoods, lateDays, trainingLink,
    targets: tg, advice,
  };
}
