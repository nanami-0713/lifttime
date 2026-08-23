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

/**
 * 解析一段食物描述，如 "2个鸡蛋"、"一杯牛奶"、"200g鸡胸肉"、"米饭300g"。
 * 返回 { name, grams, kcal, p, c, f, matched } 或 { text, matched:false }
 */
function parseSegment(seg) {
  const text = seg.trim();
  if (!text) return null;
  let qty = null, unit = '', rest = text;

  const lead = text.match(/^([0-9]+(?:\.[0-9]+)?|半|一|二|两|三|四|五|六|七|八|九|十)(kg|g|克|毫升|ml|升|l|个|只|杯|碗|份|根|片|块|勺|把|罐|瓶|包|盒|球|串|角|条|颗|粒|盘|屉)?/i);
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

  const food = findFood(rest);
  if (!food) return { text, matched: false };

  let grams;
  if (unit === 'g' || unit === '克') grams = qty;
  else if (unit === 'kg') grams = qty * 1000;
  else if (unit === 'ml' || unit === '毫升') grams = qty;      // 液体密度≈1
  else if (unit === 'l' || unit === '升') grams = qty * 1000;
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
 * 返回 { items: [...], unmatched: [...], kcal, p, c, f }
 */
export function parseMealText(text) {
  const parts = String(text || '').split(/[，,、；;+\n]+/);
  const items = [], unmatched = [];
  for (const p of parts) {
    const r = parseSegment(p);
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
