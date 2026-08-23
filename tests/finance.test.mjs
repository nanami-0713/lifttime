// 预算引擎单元测试：node tests/finance.test.mjs
import {
  weekRange, monthRange, allExpenses, summarizeSpend, proteinEconomy,
  budgetStatus, budgetAdvice, fmtMoney, catOfExp, planRange, planStatus, planAdvice,
} from '../js/finance.js';

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.error('  ✗ FAIL: ' + msg); }
}

// 2026-08-23 是周日（8-21 周五）
const SUN = new Date(2026, 7, 23, 18, 0, 0).getTime();
const MON = new Date(2026, 7, 17, 0, 0, 0).getTime();

console.log('— 区间 —');
let r = weekRange(SUN);
ok(r.start === MON && r.end === MON + 7 * 86400000, '周日所在周 = 周一 8/17 起');
r = weekRange(MON + 3600000);
ok(r.start === MON, '周一当天属于本周');
r = monthRange(SUN);
ok(new Date(r.start).getDate() === 1 && new Date(r.start).getMonth() === 7, '月区间 8/1 起');
ok(new Date(r.end).getMonth() === 8, '月区间 9/1 止');

console.log('— 合并记餐开销 —');
const expenses = [
  { id: 'e1', ts: MON + 3600000, amount: 120, cat: 'groceries', note: '买菜' },
  { id: 'e2', ts: MON + 7200000, amount: 45, cat: 'takeout', note: '黄焖鸡' },
];
const diet = [
  { id: 'm1', ts: MON + 8000000, meal: 'lunch', text: '一份鸡胸肉', cost: 15, p: 40 },
  { id: 'm2', ts: MON + 9000000, meal: 'dinner', text: '一碗米饭', cost: 0, p: 5 },
  { id: 'm3', ts: MON + 9500000, meal: 'postworkout', text: '一勺蛋白粉', cost: 8, p: 23 },
];
const all = allExpenses(expenses, diet);
ok(all.length === 4, '4 笔（2 手动 + 2 记餐带花费）');
ok(all.filter(e => e.auto).length === 2, '记餐花费标记 auto');
ok(all.find(e => e.id === 'meal-m3').note.includes('练后餐'), '记餐备注含餐次');
ok(!all.some(e => e.id === 'meal-m2'), '无花费的记餐不计入');

console.log('— 汇总 —');
const s = summarizeSpend(all);
ok(s.total === 188, '总额 120+45+15+8 = 188: ' + s.total);
ok(s.byCat.meals === 23 && s.byCat.groceries === 120, '按分类聚合');
ok(s.max.note === '买菜', '最大单笔识别');
ok(s.daysWithSpend === 1, '活跃天数');

console.log('— 蛋白质性价比 —');
const eco = proteinEconomy(diet, MON, MON + 86400000);
ok(eco.cost === 23 && eco.protein === 63, '花费/蛋白质聚合: ' + eco.cost + '/' + eco.protein);
ok(Math.abs(eco.per10g - 3.65) < 0.01, '¥/10g = 23/63*10 ≈ 3.65: ' + eco.per10g);
const eco3 = proteinEconomy(diet.concat([{ id: 'm4', ts: MON + 9600000, meal: 'breakfast', text: '两个鸡蛋', cost: 4, p: 13 }]), MON, MON + 86400000);
ok(eco3.meals === 3, '三餐带花费用于建议触发');
const ecoEmpty = proteinEconomy([], MON, MON + 86400000);
ok(ecoEmpty.per10g === null, '无数据 per10g 为 null');

console.log('— 预算状态 —');
// 周日 18:00，本周花了 188，预算 500
const wr = weekRange(SUN);
let bs = budgetStatus(188, 500, wr.start, wr.end, SUN);
ok(bs.pct === 38, '已用 38%');
ok(bs.remaining === 312 && bs.daysLeft === 1, '剩余/剩余天数');
ok(!bs.overProjected, '未超节奏');
// 花了 400 → 周日 18:00 已过 6.75/7 天 → projected ≈ 415 < 500 不超
bs = budgetStatus(495, 500, wr.start, wr.end, SUN);
ok(bs.overProjected, '接近全额即超节奏: projected=' + bs.projected);
ok(budgetStatus(100, 0, wr.start, wr.end, SUN) === null, '无预算返回 null');

console.log('— 建议 —');
let adv = budgetAdvice({ week: null, month: null, sumWeek: summarizeSpend([]), proteinEco: ecoEmpty, proteinHitRate: null });
ok(adv[0].includes('还没有设置预算'), '无预算提示');
adv = budgetAdvice({
  week: budgetStatus(495, 500, wr.start, wr.end, SUN),
  month: null,
  sumWeek: summarizeSpend(all.concat([{ ts: MON + 1000, amount: 307, cat: 'takeout', note: 'x' }])),
  proteinEco: eco3,
  proteinHitRate: 0.4,
});
ok(adv.some(a => a.includes('会超预算')), '超支预警: ' + (adv[0] || '').slice(0, 30));
ok(adv.some(a => a.includes('外卖') && a.includes('鸡胸')), '外卖占比高+蛋白不达标联动建议');
ok(adv.some(a => a.includes('折合')), '记餐性价比反馈');
// 补剂占比高
const suppSpend = summarizeSpend([{ ts: MON, amount: 200, cat: 'supplement', note: '' }, { ts: MON, amount: 100, cat: 'groceries', note: '' }]);
adv = budgetAdvice({ week: null, month: null, sumWeek: suppSpend, proteinEco: ecoEmpty, proteinHitRate: null });
ok(adv.some(a => a.includes('补剂')), '补剂占比提醒');

console.log('— 自定义周期计划 —');
const day0 = new Date(2026, 7, 23, 18, 0, 0).getTime(); // 周日 18:00
const plan14 = { id: 'p1', name: '两周冲刺', amount: 1000, days: 14, startTs: day0 };
let pr = planRange(plan14);
ok(new Date(pr.start).getHours() === 0, '计划起始归一到当天 0 点');
ok(pr.end - pr.start === 14 * 86400000, '14 天区间长度');
let pst = planStatus(plan14, 300, day0);
ok(!pst.notStarted && !pst.ended && pst.pct === 30, '进行中: 30%');
ok(pst.daysLeft === 14, '第 1 天剩 14 天: ' + pst.daysLeft);
// 未来计划
const future = { id: 'p2', amount: 500, days: 10, startTs: day0 + 3 * 86400000 };
pst = planStatus(future, 0, day0);
ok(pst.notStarted && !pst.ended, '未来计划 notStarted');
ok(planAdvice(future, pst) === null, '未开始不给建议');
// 已结束计划
const past = { id: 'p3', amount: 500, days: 10, startTs: day0 - 20 * 86400000 };
pst = planStatus(past, 480, day0);
ok(pst.ended && !pst.notStarted, '过期计划 ended');
ok(planAdvice(past, pst) === null, '已结束不给建议');
// 超节奏建议
pst = planStatus(plan14, 900, day0 + 6 * 86400000); // 第7天花900/1000
ok(pst.overProjected, '第7天90% -> 超节奏');
let pa = planAdvice(plan14, pst);
ok(pa && pa.includes('两周冲刺') && pa.includes('会超预算'), '超节奏建议文案: ' + (pa||'').slice(0,40));
// 临期高占比但未超节奏（第12.75天花了850/1000，projected≈933）
pst = planStatus(plan14, 850, day0 + 12 * 86400000);
pa = planAdvice(plan14, pst);
ok(!pst.overProjected && pst.pct === 85 && pa && pa.includes('85%'), '高占比提醒: ' + (pa||'').slice(0,40));
// 已超预算
pst = planStatus(plan14, 1100, day0 + 9 * 86400000);
pa = planAdvice(plan14, pst);
ok(pa && pa.includes('已超预算 ¥100'), '已超支文案: ' + (pa||'').slice(0,40));
// 健康节奏 → null
pst = planStatus(plan14, 300, day0 + 6 * 86400000);
ok(planAdvice(plan14, pst) === null, '健康节奏不打扰');

console.log('— 格式化 —');
ok(fmtMoney(1234.5) === '1,234.5' || fmtMoney(1234.5) === '1,234.50', '千分位: ' + fmtMoney(1234.5));
ok(fmtMoney(500) === '500', '整数无小数');
ok(catOfExp('meals').label === '记餐开销', '分类映射');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
