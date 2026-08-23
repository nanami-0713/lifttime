// 饮食引擎单元测试：node tests/nutrition.test.mjs
import { parseMealText, targets, summarize, dailyAdvice, periodDiet, mealOf } from '../js/nutrition.js';
import { findFood } from '../js/foods.js';

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.error('  ✗ FAIL: ' + msg); }
}
const NOW = new Date(2026, 7, 21, 20, 0, 0).getTime();
const day = (n, h) => { const d = new Date(NOW - n * 86400000); d.setHours(h, 0, 0, 0); return d.getTime(); };
const entry = (ts, meal, text) => {
  const p = parseMealText(text);
  return { id: 'e' + ts + meal, ts, meal, text, items: p.items, unmatched: p.unmatched, kcal: p.kcal, p: p.p, c: p.c, f: p.f };
};

console.log('— 食物库 —');
ok(findFood('鸡胸') && findFood('鸡胸').n === '鸡胸肉', '别名「鸡胸」→ 鸡胸肉');
ok(findFood('无糖希腊酸奶杯') && findFood('无糖希腊酸奶杯').n === '希腊酸奶', '长名优先匹配');
ok(findFood('佛跳墙') === null, '未知食物返回 null');

console.log('— 文本解析 —');
let r = parseMealText('2个鸡蛋');
ok(r.items.length === 1 && r.items[0].grams === 110, '「2个鸡蛋」→ 110g');
ok(r.kcal === Math.round(143 * 1.1), '热量按克数换算: ' + r.kcal);
r = parseMealText('一杯牛奶');
ok(r.items[0].grams === 250, '「一杯牛奶」→ 250g（中文数字）');
r = parseMealText('200g鸡胸肉');
ok(r.items[0].grams === 200 && Math.abs(r.p - 62) < 0.5, '「200g鸡胸肉」→ 蛋白质62g: ' + r.p);
r = parseMealText('30g蛋白粉+一根香蕉');
ok(r.items.length === 2 && r.p > 20 && r.c > 20, '加号分隔多食物: ' + JSON.stringify({ p: r.p, c: r.c }));
r = parseMealText('半块巧克力');
ok(r.items[0].grams === 10, '「半块巧克力」→ 10g');
r = parseMealText('米饭300g');
ok(r.items[0].grams === 300 && r.items[0].name === '米饭', '尾部克数「米饭300g」→ 300g');
r = parseMealText('两碗米饭');
ok(r.items[0].grams === 400, '「两碗米饭」→ 400g');
r = parseMealText('一个鸡蛋，一份鸡胸肉、一把坚果');
ok(r.items.length === 3, '顿号/逗号分隔 → 3 项');
r = parseMealText('2个鸡蛋+佛跳墙');
ok(r.items.length === 1 && r.unmatched.length === 1 && r.unmatched[0] === '佛跳墙', '未识别食物进入 unmatched');
r = parseMealText('');
ok(r.items.length === 0 && r.kcal === 0, '空文本不崩溃');

console.log('— 目标 —');
let tg = targets(70, false);
ok(tg.proteinLo === 112 && tg.proteinHi === 154, '70kg 蛋白质目标 112–154');
ok(tg.cal === 2100, '70kg 热量目标 2100');
tg = targets(null, false);
ok(tg.cal === 2000 && tg.proteinLo === 80, '无体重默认值');

console.log('— 汇总 —');
const entries = [
  entry(day(0, 8), 'breakfast', '2个鸡蛋+一杯牛奶+一份燕麦'),
  entry(day(0, 12), 'lunch', '一份鸡胸肉+一碗米饭+一份西兰花'),
  entry(day(0, 19), 'dinner', '150g牛肉+半碗米饭'),
];
const s = summarize(entries);
ok(s.kcal > 1200 && s.kcal < 2000, '当日总热量合理: ' + s.kcal);
ok(s.p > 100, '当日蛋白质: ' + s.p);
ok(s.byMeal.lunch.count === 1 && s.byMeal.breakfast.kcal > 0, '按餐次聚合');
ok(s.tags.veg === 1 && s.tags.protein >= 3, '标签统计');

console.log('— 当日建议 + 训练联动 —');
const wo = { startedAt: day(0, 18), endAt: day(0, 19) + 30 * 60000, primaryLabels: '胸、肩' };
let d = dailyAdvice(entries, { bodyweight: 70, now: NOW, workoutsToday: [wo] });
ok(d.advice.some(a => a.includes('练后')), '有未吃练后餐提醒: ' + d.advice[0].slice(0, 30));
const withPost = entries.concat([entry(day(0, 20) - 30 * 60000, 'postworkout', '一勺蛋白粉+一根香蕉')]);
d = dailyAdvice(withPost, { bodyweight: 70, now: NOW, workoutsToday: [wo] });
ok(d.advice.some(a => a.includes('练后餐已经吃上')), '练后餐已吃 → 打勾文案');
const lightDay = [entry(day(0, 8), 'breakfast', '一碗白粥+一个包子')];
d = dailyAdvice(lightDay, { bodyweight: 70, now: NOW, workoutsToday: [wo] });
ok(d.advice.some(a => a.includes('蛋白质') && a.includes('目标')), '蛋白质不足提醒: ' + (d.advice.find(a=>a.includes('蛋白质'))||'').slice(0,30));
d = dailyAdvice([], { bodyweight: 70, now: NOW, workoutsToday: [] });
ok(d.advice[0].includes('还没记'), '空日提示');
// 晚加餐提醒
const late = entries.concat([entry(day(0, 22), 'snack', '一包饼干')]);
d = dailyAdvice(late, { bodyweight: 70, now: NOW, workoutsToday: [] });
ok(d.advice.some(a => a.includes('9 点后')), '晚加餐提醒');

console.log('— 阶段总结 —');
const dietEntries = [];
for (let i = 0; i < 7; i++) {
  dietEntries.push(entry(day(i, 8), 'breakfast', '2个鸡蛋+一杯牛奶'));
  dietEntries.push(entry(day(i, 12), 'lunch', '一份鸡胸肉+一碗米饭+一份炒青菜'));
  dietEntries.push(entry(day(i, 19), 'dinner', '200g牛肉+一碗米饭'));
}
dietEntries.push(entry(day(1, 22), 'snack', '一罐可乐'));
dietEntries.push(entry(day(3, 22), 'snack', '一块蛋糕'));
const workouts = [
  { startedAt: day(1, 19), endAt: day(1, 20) },
  { startedAt: day(3, 19), endAt: day(3, 20) },
  { startedAt: day(5, 19), endAt: day(5, 20) },
];
const pd = periodDiet(dietEntries, 7, { bodyweight: 70, workouts, now: NOW });
ok(pd.daysTracked === 7, '7 天都有记录: ' + pd.daysTracked);
ok(pd.avg.kcal > 1200, '日均热量: ' + pd.avg.kcal);
ok(pd.topFoods.length > 0 && pd.topFoods[0].count >= 7, '高频食物Top1: ' + pd.topFoods[0].name + '×' + pd.topFoods[0].count);
ok(pd.lateDays === 2, '晚加餐天数: ' + pd.lateDays);
ok(pd.trainingLink.trainedDays === 3, '训练日 3 天');
ok(pd.trainingLink.proteinHitOnTrainedDays === 3, '训练日蛋白质全达标: ' + pd.trainingLink.proteinHitOnTrainedDays);
ok(pd.daySums.length === 7 && pd.daySums[6].key, '按天序列长度 7');
const pdEmpty = periodDiet([], 7, { bodyweight: 70, workouts: [], now: NOW });
ok(pdEmpty.advice[0].includes('没有'), '空窗口建议');

console.log('— mealOf —');
ok(mealOf('preworkout').label === '练前餐', '餐次映射');
ok(mealOf('???').label === '加餐', '未知餐次回退');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
