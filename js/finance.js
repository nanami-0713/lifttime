// 预算引擎：周/月预算、开销汇总、饮食联动分析（纯函数，可单测）
import { dayKey } from './util.js';
import { mealOf } from './nutrition.js';

export const EXP_CATS = [
  { key: 'meals',      label: '记餐开销', color: '#22c55e', auto: true },
  { key: 'groceries',  label: '食材采购', color: '#f59e0b' },
  { key: 'takeout',    label: '外卖外食', color: '#f97316' },
  { key: 'social',     label: '聚餐',     color: '#a855f7' },
  { key: 'supplement', label: '补剂',     color: '#14b8a6' },
  { key: 'fitness',    label: '健身相关', color: '#ef4444' },
  { key: 'other',      label: '其他',     color: '#94a3b8' },
];
export function catOfExp(key) { return EXP_CATS.find(c => c.key === key) || EXP_CATS[EXP_CATS.length - 1]; }
export const MANUAL_CATS = EXP_CATS.filter(c => !c.auto);

/** 常见蛋白来源的参考成本（¥/10g 蛋白质，估算值，用于建议文案） */
export const PROTEIN_PRICE_REF = [
  { name: '鸡胸肉', per10g: 0.8 },
  { name: '鸡蛋', per10g: 1.6 },
  { name: '蛋白粉', per10g: 2.2 },
  { name: '牛肉', per10g: 2.5 },
];

/** 自然周（周一 00:00 起） */
export function weekRange(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7;
  const start = d.getTime() - dow * 86400000;
  return { start, end: start + 7 * 86400000 };
}
/** 自然月 */
export function monthRange(ts) {
  const d = new Date(ts);
  return {
    start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
    end: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(),
  };
}

/** 合并手动开销与记餐花费（dietEntries 带 cost 的自动计入「记餐开销」） */
export function allExpenses(expenses, dietEntries) {
  const out = [];
  for (const e of (expenses || [])) {
    out.push({ id: e.id, ts: e.ts, amount: e.amount, cat: e.cat, note: e.note || '', auto: false });
  }
  for (const m of (dietEntries || [])) {
    if (m.cost > 0) {
      out.push({
        id: 'meal-' + m.id, ts: m.ts, amount: m.cost, cat: 'meals', auto: true,
        note: mealOf(m.meal).label + (m.text ? '：' + m.text : ''),
        mealId: m.id,
      });
    }
  }
  return out.sort((a, b) => b.ts - a.ts);
}

export function inRange(items, start, end) {
  return items.filter(e => e.ts >= start && e.ts < end);
}

/** 汇总：总额、按分类、天数、日均、最大单笔 */
export function summarizeSpend(items) {
  const t = { total: 0, count: 0, byCat: {}, max: null, byDay: {} };
  for (const e of items) {
    const amt = e.amount || 0;
    t.total += amt; t.count++;
    if (!t.byCat[e.cat]) t.byCat[e.cat] = 0;
    t.byCat[e.cat] += amt;
    const k = dayKey(e.ts);
    t.byDay[k] = (t.byDay[k] || 0) + amt;
    if (!t.max || amt > t.max.amount) t.max = e;
  }
  t.total = Math.round(t.total * 100) / 100;
  t.daysWithSpend = Object.keys(t.byDay).length;
  t.avgPerActiveDay = t.daysWithSpend ? Math.round(t.total / t.daysWithSpend * 100) / 100 : 0;
  return t;
}

/** 记餐的蛋白质性价比（仅统计带 cost 的饮食记录） */
export function proteinEconomy(dietEntries, start, end) {
  let cost = 0, protein = 0, meals = 0;
  for (const m of (dietEntries || [])) {
    if (m.ts >= start && m.ts < end && m.cost > 0) {
      cost += m.cost; protein += m.p || 0; meals++;
    }
  }
  return {
    cost: Math.round(cost * 100) / 100,
    protein: Math.round(protein * 10) / 10,
    meals,
    per10g: protein > 0 ? Math.round(cost / protein * 10 * 100) / 100 : null,
  };
}

/** 自定义周期计划区间：{days, startTs} → 起始日 00:00 起 N 天 */
export function planRange(plan) {
  const d = new Date(plan.startTs); d.setHours(0, 0, 0, 0);
  const start = d.getTime();
  return { start, end: start + plan.days * 86400000 };
}

/** 自定义计划状态 = budgetStatus + notStarted/ended 标记 */
export function planStatus(plan, spent, now) {
  const { start, end } = planRange(plan);
  const st = budgetStatus(spent, plan.amount, start, end, now);
  if (!st) return { start, end, notStarted: now < start, ended: now >= end, invalid: true };
  return Object.assign(st, { start, end, notStarted: now < start, ended: now >= end });
}

/** 自定义计划建议（进行中且需要提醒时返回文案） */
export function planAdvice(plan, st) {
  if (!st || st.invalid || st.notStarted || st.ended) return null;
  const name = plan.name || plan.days + '天计划';
  if (st.overProjected) {
    if (st.remaining < 0) {
      return '「' + name + '」已超预算 ¥' + fmtMoney(-st.remaining) + '，剩余 ' + st.daysLeft + ' 天尽量零额外开销。';
    }
    return '「' + name + '」按目前节奏预计花 ¥' + fmtMoney(st.projected) + '，会超预算 ¥' + fmtMoney(st.projected - st.budget) +
      '；剩 ' + st.daysLeft + ' 天每天控制在 ¥' + fmtMoney(Math.max(0, st.perDayLeft)) + ' 内可以拉回。';
  }
  if (st.pct >= 85 && st.daysLeft > 1) {
    return '「' + name + '」预算已用 ' + st.pct + '%，还剩 ' + st.daysLeft + ' 天，后面留意节奏。';
  }
  return null;
}

/** 预算进度（含节奏预测） */
export function budgetStatus(spent, budget, rangeStart, rangeEnd, now) {
  if (!budget || budget <= 0) return null;
  const total = rangeEnd - rangeStart;
  const elapsed = Math.max(1, Math.min(now, rangeEnd) - rangeStart);
  const projected = spent / (elapsed / total);
  const daysLeft = Math.max(1, Math.ceil((rangeEnd - now) / 86400000));
  const remaining = budget - spent;
  return {
    spent: Math.round(spent * 100) / 100,
    budget,
    pct: Math.round(spent / budget * 100),
    remaining: Math.round(remaining * 100) / 100,
    daysLeft,
    perDayLeft: Math.round(remaining / daysLeft * 100) / 100,
    projected: Math.round(projected * 100) / 100,
    overProjected: projected > budget,
  };
}

/**
 * 预算建议。ctx: {
 *   week: budgetStatus|null, month: budgetStatus|null,
 *   sumWeek: summarizeSpend, proteinEco: proteinEconomy,
 *   proteinHitRate: 0-1|null（该周饮食蛋白质达标率）,
 * }
 */
export function budgetAdvice(ctx) {
  const advice = [];
  const { week, month, sumWeek, proteinEco, proteinHitRate } = ctx;

  if (!week && !month) {
    advice.push('还没有设置预算，点「编辑预算」填一个周预算或月预算，这里就能帮你盯节奏了。');
  }
  if (week && week.overProjected) {
    if (week.remaining < 0) {
      advice.push('本周已经超预算 ¥' + fmtMoney(-week.remaining) + '，剩下的日子尽量零额外开销，下周重新回到节奏里就好。');
    } else {
      advice.push('按目前节奏，本周预计花 ¥' + fmtMoney(week.projected) + '，会超预算 ¥' + fmtMoney(week.projected - week.budget) +
        '。剩下 ' + week.daysLeft + ' 天每天控制在 ¥' + fmtMoney(Math.max(0, week.perDayLeft)) + ' 内可以拉回来。');
    }
  } else if (week && week.pct >= 85 && week.daysLeft > 1) {
    advice.push('本周预算已用 ' + week.pct + '%，还剩 ' + week.daysLeft + ' 天——后面几天悠着点。');
  }
  if (month && month.overProjected) {
    advice.push('本月按节奏预计花 ¥' + fmtMoney(month.projected) + '（预算 ¥' + fmtMoney(month.budget) + '），建议在月底前把大额开销缓一缓。');
  }

  // —— 饮食联动 ——
  const foodSpend = sumWeek ? (sumWeek.byCat.meals || 0) + (sumWeek.byCat.groceries || 0) + (sumWeek.byCat.takeout || 0) + (sumWeek.byCat.social || 0) : 0;
  const takeoutShare = foodSpend > 0 ? ((sumWeek.byCat.takeout || 0) + (sumWeek.byCat.social || 0)) / foodSpend : 0;
  if (sumWeek && foodSpend > 0 && takeoutShare > 0.5 && proteinHitRate != null && proteinHitRate < 0.6) {
    advice.push('本周餐饮花费里外卖/聚餐占 ' + Math.round(takeoutShare * 100) + '%，但蛋白质达标率只有 ' + Math.round(proteinHitRate * 100) +
      '%——钱花出去了营养没跟上。同样的预算，鸡胸(约¥0.8/10g蛋白)、鸡蛋(约¥1.6)、蛋白粉(约¥2.2)的效率高得多。');
  }
  if (proteinEco && proteinEco.per10g != null && proteinEco.meals >= 3) {
    const ref = PROTEIN_PRICE_REF[0];
    let s = '本周记餐花费 ¥' + fmtMoney(proteinEco.cost) + '，换来蛋白质约 ' + Math.round(proteinEco.protein) + 'g（折合 ¥' + fmtMoney(proteinEco.per10g) + '/10g）。';
    if (proteinEco.per10g > ref.per10g * 3) {
      s += '这个成本偏高，如果一部分换成' + ref.name + '（约¥' + ref.per10g + '/10g），同样的钱能吃到两倍以上的蛋白质。';
    } else {
      s += '性价比不错，继续保持。';
    }
    advice.push(s);
  }
  const suppShare = sumWeek && sumWeek.total > 0 ? (sumWeek.byCat.supplement || 0) / sumWeek.total : 0;
  if (suppShare > 0.3) {
    advice.push('补剂占了本周开销的 ' + Math.round(suppShare * 100) + '%，补剂是锦上添花——先把基础饮食的钱花到位再考虑它。');
  }

  if (!advice.length) advice.push('花销节奏健康，继续保持。');
  return advice.slice(0, 4);
}

export function fmtMoney(v) {
  if (v == null || !isFinite(v)) return '0';
  const r = Math.round(v * 100) / 100;
  return (r % 1 === 0 ? String(r) : r.toFixed(2)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
