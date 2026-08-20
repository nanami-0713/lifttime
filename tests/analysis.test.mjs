// 分析引擎单元测试：node tests/analysis.test.mjs
import {
  est1RM, sessionStats, analyzeSession, analyzePeriod, dayBrief, dailySeries, bestE1History,
} from '../js/analysis.js';
import { searchExercises, resolveExercise, findInDB } from '../js/exercises.js';

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.error('  ✗ FAIL: ' + msg); }
}
function near(a, b, eps, msg) { ok(Math.abs(a - b) <= (eps || 0.01), msg + ` (${a} ≈ ${b})`); }

const NOW = new Date(2026, 7, 21, 20, 0, 0).getTime(); // 2026-08-21 20:00 本地
const mkEx = (name, sets) => ({ name, sets: sets.map(([w, r]) => ({ w, r })) });
const mkWo = (startTs, exercises, extra) => Object.assign({ id: 'w' + startTs, startedAt: startTs, endAt: startTs + 3600000, exercises, feeling: 3, notes: '' }, extra || {});

console.log('— est1RM —');
near(est1RM(100, 5), 116.667, 0.01, 'Epley 100kg×5');
near(est1RM(60, 1), 62, 0.001, 'Epley 60kg×1 = 62');
ok(est1RM(100, 20) === est1RM(100, 15), '超过15次封顶');
ok(est1RM(0, 10) === 0 && est1RM(60, 0) === 0, '空重量/空次数返回0');

console.log('— 动作库 —');
ok(findInDB('杠铃卧推') && findInDB('杠铃卧推').n === '卧推', '别名「杠铃卧推」→ 卧推');
ok(findInDB('RDL') && findInDB('RDL').n === '罗马尼亚硬拉', '别名 RDL');
ok(searchExercises('划船').length >= 3, '搜索「划船」≥3 个结果');
ok(resolveExercise('神秘动作').primary.length === 0, '未知动作 primary 为空');
ok(resolveExercise('我的独家动作', { 我的独家动作: { p: ['chest'] } }).primary[0] === 'chest', '自定义动作映射生效');

console.log('— sessionStats —');
const s1 = sessionStats(mkWo(NOW, [mkEx('卧推', [[60, 12], [60, 12], [60, 12]])]), {});
near(s1.tonnage, 2160, 0.01, '卧推 60×12×3 容量 2160');
ok(s1.sets === 3 && s1.reps === 36, '组数/次数统计');
const chestStat = s1.muscles.find(m => m.key === 'chest');
ok(chestStat && chestStat.share > 0.6, '胸为主导 (>60%)');
ok(s1.muscles.some(m => m.key === 'triceps'), '三头作为次要肌群被计入');
const s2 = sessionStats(mkWo(NOW, [mkEx('引体向上', [[null, 8], [null, 8]])]), {});
ok(s2.tonnage === 0 && s2.sets === 2, '自重动作容量为0但组数计入');

console.log('— analyzeSession 基础 —');
const chestDay = mkWo(NOW, [
  mkEx('卧推', [[60, 12], [60, 12], [65, 10], [65, 10]]),
  mkEx('上斜卧推', [[50, 10], [50, 10], [50, 10]]),
  mkEx('侧平举', [[7.5, 15], [7.5, 15], [7.5, 15]]),
]);
const a1 = analyzeSession(chestDay, { history: [], unit: 'kg' });
ok(a1.primaryLabels.includes('胸'), '主练识别出「胸」: ' + a1.primaryLabels);
ok(a1.brief.length >= 3 && a1.brief.every(s => typeof s === 'string' && s.length > 5), '简评 ≥3 段且非空');
ok(a1.diet.length >= 3 && a1.rest.length >= 3, '饮食/休息建议各 ≥3 条');
ok(['轻微', '中度', '明显', '强烈'].includes(a1.domsLevel), 'DOMS 等级合法: ' + a1.domsLevel);
ok(a1.postFeel.length >= 1, '练后感觉预测非空');
ok(a1.nextDayText.length > 10, '次日感觉文本非空');
ok(!JSON.stringify(a1).includes('NaN'), '输出无 NaN');

console.log('— PR 与强度 —');
const hist = [
  mkWo(NOW - 14 * 864e5, [mkEx('卧推', [[60, 8]])]),           // e1=76
  mkWo(NOW - 7 * 864e5, [mkEx('卧推', [[62, 8]]), mkEx('深蹲', [[100, 5]])]),
];
const prRun = analyzeSession(mkWo(NOW, [mkEx('卧推', [[65, 8]]), mkEx('深蹲', [[95, 5]])]), { history: hist });
ok(prRun.prs.length === 1 && prRun.prs[0].name === '卧推', '更重的卧推被识别为PR');
ok(prRun.prs[0].prev > 77 && prRun.prs[0].prev < 80, 'PR 此前最好值正确 (62x8 => ~78.5)');
ok(prRun.ratio != null && prRun.ratio >= 90, '强度比率计算: ' + prRun.ratio + '%');
const noPr = analyzeSession(mkWo(NOW, [mkEx('卧推', [[50, 8]])]), { history: hist });
ok(noPr.prs.length === 0, '重量下降不产生PR');

console.log('— 容量对比 & DOMS —');
const vols = [];
for (let i = 6; i >= 3; i--) vols.push(mkWo(NOW - i * 864e5, [mkEx('深蹲', [[80, 10], [80, 10], [80, 10]])]));
const squatSets = [[100, 12], [100, 12], [100, 12], [100, 12]];
const bigDayReal = mkWo(NOW, [mkEx('深蹲', squatSets), mkEx('保加利亚分腿蹲', [[40, 10], [40, 10]]), mkEx('腿弯举', [[35, 12]])]);
const aBig = analyzeSession(bigDayReal, { history: vols, bodyweight: 70 });
ok(aBig.volVsAvg != null && aBig.volVsAvg > 130, '容量显著高于均值: ' + aBig.volVsAvg + '%');
ok(aBig.primary.some(m => m.group === 'legs'), '主练落在腿臀');
ok(['明显', '强烈'].includes(aBig.domsLevel), '大容量腿日 DOMS 预测为明显/强烈: ' + aBig.domsLevel);
ok(aBig.diet[0].includes('112–154g') || /\d+–\d+g/.test(aBig.diet[0]), '按体重给出蛋白质克数: ' + aBig.diet[0].slice(0, 30) + '...');
const lightDay = mkWo(NOW, [mkEx('弯举', [[10, 12]])]);
const aLight = analyzeSession(lightDay, { history: vols.concat([mkWo(NOW - 864e5, [mkEx('弯举', [[10, 12]])])]) });

ok(aLight.domsLevel === '轻微' || aLight.domsLevel === '中度', '轻量熟悉动作 DOMS 偏轻: ' + aLight.domsLevel);

console.log('— 自重/有氧 —');
const cardio = analyzeSession(mkWo(NOW, [mkEx('跑步', [[null, 30]]), mkEx('平板支撑', [[null, 3]])]), { history: [] });
ok(cardio.totals.tonnage === 0 && cardio.totals.sets === 2, '有氧/自重容量计0、组数正确');
ok(cardio.primaryLabels.includes('全身') || cardio.primaryLabels.includes('核心'), '有氧日主练识别: ' + cardio.primaryLabels);

console.log('— 未知动作稳健性 —');
const unknown = analyzeSession(mkWo(NOW, [mkEx('自创推法', [[30, 10]])]), { history: [] });
ok(typeof unknown.primaryLabels === 'string', '未知动作不崩溃');

console.log('— analyzePeriod —');
const periodSeed = [];
// 本窗口：周一推、周三拉、周五腿 + 连续两天
periodSeed.push(mkWo(NOW - 5 * 864e5, [mkEx('卧推', [[60, 10], [60, 10], [60, 10]])]));
periodSeed.push(mkWo(NOW - 3 * 864e5, [mkEx('引体向上', [[null, 8], [null, 8]])]));
periodSeed.push(mkWo(NOW - 1 * 864e5, [mkEx('深蹲', [[80, 10], [80, 10]])]));
periodSeed.push(mkWo(NOW - 0 * 864e5, [mkEx('硬拉', [[100, 5], [100, 5]])]));
// 上一窗口：一次小容量
periodSeed.push(mkWo(NOW - 12 * 864e5, [mkEx('卧推', [[40, 8]])]));
const p7 = analyzePeriod(periodSeed, 7, NOW, {});
ok(p7.sessions === 4, '7天内4次训练: ' + p7.sessions);
near(p7.freqPerWeek, 4.0, 0.01, '频率 4次/周');
ok(p7.trendPct != null && p7.trendPct > 100, '容量较上一窗口大增: ' + p7.trendPct + '%');
ok(p7.groups.length >= 3, '部位分组 ≥3');
ok(p7.prs.length >= 1, '窗口内识别到PR: ' + p7.prs.map(p => p.name).join(','));
ok(typeof p7.tone === 'string' && p7.tone.length > 10, '状态评语非空: ' + p7.tone.slice(0, 24) + '...');
ok(dailySeries(periodSeed, 7, NOW + 864e5, {}).length === 7, 'dailySeries 返回7天');

// 推多拉少 → 平衡提示
const pushHeavy = [];
for (let i = 0; i < 3; i++) pushHeavy.push(mkWo(NOW - i * 2 * 864e5, [mkEx('卧推', [[80, 10] , [80, 10]]), mkEx('推举', [[40, 10], [40, 10]])]));
const pPush = analyzePeriod(pushHeavy, 7, NOW, {});
ok(pPush.balanceNotes.some(n => n.includes('拉类')), '推多拉少给出平衡提醒');

// 连续训练 streak
const daily = [];
for (let i = 0; i < 6; i++) daily.push(mkWo(NOW - i * 864e5, [mkEx('卧推', [[60, 10]])]));
const pStreak = analyzePeriod(daily, 7, NOW, {});
ok(pStreak.streak === 6, '连续6天训练 streak: ' + pStreak.streak);
ok(pStreak.tone.includes('休息') || pStreak.advice.some(a => a.includes('休息')), '连续训练给出休息提醒');

// 空窗口
const pEmpty = analyzePeriod([], 7, NOW, {});
ok(pEmpty.sessions === 0 && pEmpty.tone.length > 10, '空窗口不崩溃且给出重启建议');

console.log('— bestE1History / dayBrief —');
const bh = bestE1History(hist.concat([mkWo(NOW + 864e5, [mkEx('卧推', [[200, 1]])])]), NOW);
near(bh['卧推'], 78.533, 0.01, '截止时间过滤正确(62x8=78.5)');
const cats = [{ key: 'strength', label: '力量训练', color: '#ef4444' }, { key: 'warmup', label: '热身激活', color: '#f59e0b' }];
const db = dayBrief('2026-08-21', [
  { id: '1', start: NOW - 7200000, end: NOW - 6600000, cat: 'warmup', note: '' },
  { id: '2', start: NOW - 6600000, end: NOW - 3000000, cat: 'strength', note: '' },
], [chestDay], cats);
ok(db.totalMs === 4200000, '时间块求和 (10+60分钟)');
ok(db.summary.includes('1小时10分'), '简报文本包含总时长: ' + db.summary);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
