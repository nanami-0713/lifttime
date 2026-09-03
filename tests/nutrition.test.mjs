// 饮食引擎单元测试：node tests/nutrition.test.mjs
import { parseMealText, targets, summarize, dailyAdvice, periodDiet, mealOf, ESTIMATE_CATS, estCatOf, extractGrams, guessCategory, estimateFor, guessFor, entryTotals, cleanFoodName, learnFood } from '../js/nutrition.js';
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

console.log('— 未识别食物估算助手 —');
ok(ESTIMATE_CATS.length === 8, '8 个估算类别');
ok(extractGrams('佛跳墙300g') === 300, '抠克数 300g');
ok(extractGrams('大杯奶茶500毫升') === 500, '抠毫升 500ml');
ok(extractGrams('1.5kg西瓜') === 1500, '抠 kg');
ok(extractGrams('一碗不知道什么东西') === null, '无克数返回 null');
ok(guessCategory('排骨汤') === 'soup', '排骨汤 → 汤类');
ok(guessCategory('大杯奶茶') === 'drink', '奶茶 → 饮品');
ok(guessCategory('手打柠檬茶') === 'drink', '柠檬茶 → 饮品');
ok(guessCategory('红烧肉') === 'meat', '红烧肉 → 肉菜');
ok(guessCategory('扬州炒饭') === 'staple', '炒饭 → 主食');
ok(guessCategory('炒时蔬') === 'veg', '炒时蔬 → 素菜');
ok(guessCategory('辣条两包') === 'snack', '辣条 → 零食');
ok(guessCategory('神秘料理') === 'other', '猜不出 → 其他');
let est = estimateFor('meat', 200);
ok(est.kcal === 380 && est.p === 34, '肉菜200g → 380kcal/蛋白34: ' + est.kcal + '/' + est.p);
let g = guessFor('佛跳墙300g');
ok(g.catKey === 'other' && g.grams === 300 && g.kcal === 600, 'guessFor 组合: ' + JSON.stringify(g));
g = guessFor('酸辣汤');
ok(g.catKey === 'soup' && g.grams === 300, '酸辣汤默认 300g 汤');
const parsed = parseMealText('2个鸡蛋');
const totals = entryTotals(parsed, [{ name: '神秘菜', kcal: 400, p: 20, c: 10, f: 5 }]);
ok(totals.kcal === parsed.kcal + 400 && Math.abs(totals.p - (parsed.p + 20)) < 0.01, 'entryTotals 合并解析+手估');

console.log('— 扩充食物库 & 新单位 —');
ok(findFood('宫保鸡丁') && findFood('宫保鸡丁').k === 130, '家常菜「宫保鸡丁」命中');
ok(findFood('红烧肉') && findFood('红烧肉').k === 400, '「红烧肉」命中');
ok(findFood('鸡腿') && findFood('鸡腿').p === 16, '「鸡腿」命中');
ok(findFood('火龙果') && findFood('火龙果').t.includes('fruit'), '「火龙果」命中');
ok(findFood('手抓饼') && findFood('手抓饼').u === '个', '「手抓饼」命中');
ok(findFood('电解质水') && findFood('电解质水').k === 25, '「电解质水」命中');
ok(findFood('黄焖鸡米饭'), '「黄焖鸡米饭」命中');
let r2 = parseMealText('一袋鸡胸肉丸');
ok(r2.items.length === 1 && r2.items[0].grams === 100, '「一袋鸡胸肉丸」→ 100g（袋单位）');
r2 = parseMealText('二两白酒');
ok(r2.items[0].grams === 100, '「二两白酒」→ 100g（市制两）');
r2 = parseMealText('两碗米饭');
ok(r2.items[0].grams === 400, '「两碗米饭」仍按数量 2 解析');
r2 = parseMealText('一套煎饼果子');
ok(r2.items[0].grams === 250, '「一套煎饼果子」→ 250g（套单位）');
r2 = parseMealText('三瓣柚子');
ok(r2.items[0].grams === 300, '「三瓣柚子」→ 300g（瓣单位）');
r2 = parseMealText('一串葡萄、一份宫保鸡丁、一杯冰红茶');
ok(r2.items.length === 3 && r2.unmatched.length === 0, '混合新库三项全识别');

console.log('— 自定义食物库（自学习）—');
ok(cleanFoodName('一份佛跳墙300g') === '佛跳墙', 'cleanFoodName 去数量与克数');
ok(cleanFoodName('两碗自制酸奶') === '自制酸奶', 'cleanFoodName 中文数量');
const learned = learnFood({ name: '一份佛跳墙300g', grams: 300, kcal: 600, p: 24, c: 30, f: 40 });
ok(learned && learned.name === '佛跳墙' && learned.k === 200 && learned.g === 300, 'learnFood 归一每100g: ' + JSON.stringify(learned));
ok(learnFood({ name: 'x', grams: 0, kcal: 100 }) === null, 'learnFood 拒绝无克数');
ok(learnFood({ name: 'x', grams: 100, kcal: 0 }) === null, 'learnFood 拒绝无热量');
const custom = { 佛跳墙: { k: 200, p: 8, c: 10, f: 13.3, g: 300, u: '份' } };
r2 = parseMealText('一份佛跳墙', custom);
ok(r2.items.length === 1 && r2.items[0].grams === 300 && r2.items[0].kcal === 600, '自定义库命中: 1份=300g=600kcal');
r2 = parseMealText('佛跳墙150g', custom);
ok(r2.items[0].kcal === 300, '自定义库按克缩放: 150g=300kcal');
r2 = parseMealText('一个鸡蛋', custom);
ok(r2.items[0].name === '鸡蛋', '内置库不受自定义影响');

console.log('— mealOf —');
ok(mealOf('preworkout').label === '练前餐', '餐次映射');
ok(mealOf('???').label === '加餐', '未知餐次回退');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
