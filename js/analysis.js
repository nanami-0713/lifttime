// 训练分析引擎：纯函数，无 DOM（可被 Node 单测直接 import）
import { MUSCLES, GROUPS, resolveExercise, muscleLabel, groupOfMuscle } from './exercises.js';
import { fmtLoad, fmtNum, dayKey, dayStart, fmtDur } from './util.js';

/** Epley 估算 1RM */
export function est1RM(w, r) {
  if (!w || w <= 0 || !r || r <= 0) return 0;
  return w * (1 + Math.min(r, 15) / 30);
}

/**
 * 一次训练的肌群/容量统计。
 * 组容量 = 重量×次数（自重动作重量为空时只计组数与次数）。
 * 主要肌群按 1/主要数 系数分摊，次要肌群 0.5/次要数。
 */
export function sessionStats(workout, custom) {
  const muscle = {};   // key -> {vol, sets, reps}
  const group = {};    // groupKey -> {vol, sets}
  let tonnage = 0, sets = 0, reps = 0;
  const topSets = [];  // 每个动作的最好一组
  const byEx = {};
  let eccCount = 0, cardioSets = 0, bwSets = 0;

  for (const ex of (workout.exercises || [])) {
    const res = resolveExercise(ex.name, custom);
    let exTonnage = 0, exSets = 0, exReps = 0, best = null;
    for (const s of (ex.sets || [])) {
      const w = s.w > 0 ? s.w : 0;
      const r = s.r > 0 ? s.r : 0;
      const vol = w * r;
      tonnage += vol; exTonnage += vol;
      sets++; exSets++;
      reps += r; exReps += r;
      const e1 = est1RM(w, r);
      if (!best || e1 > best.e1) best = { w, r, e1 };
      const credit = vol > 0 ? vol : 1; // 自重动作按组计
      if (res.primary.length) {
        const c = 1 / res.primary.length;
        res.primary.forEach(k => addKv(muscle, k, credit * c, 1 * c, r));
      }
      if (res.secondary.length) {
        const c = 0.5 / res.secondary.length;
        res.secondary.forEach(k => addKv(muscle, k, credit * c, 1 * c, r));
      }
      if (res.flags.ecc) eccCount++;
      if (res.flags.cardio) cardioSets++;
      if (!w) bwSets++;
    }
    res.primary.forEach(k => addKv(group, groupOfMuscle(k), exTonnage, exSets));
    topSets.push({ name: ex.name, best, tonnage: exTonnage, sets: exSets, reps: exReps, primary: res.primary, flags: res.flags });
  }

  const totalVol = Object.values(muscle).reduce((a, m) => a + m.vol, 0) || 1;
  const muscles = Object.keys(muscle).map(k => ({
    key: k,
    label: muscleLabel(k),
    group: groupOfMuscle(k),
    vol: muscle[k].vol,
    sets: muscle[k].sets,
    reps: muscle[k].reps,
    share: muscle[k].vol / totalVol,
  })).sort((a, b) => b.vol - a.vol);

  const groups = Object.keys(group).map(k => ({
    key: k, label: GROUPS[k].label, color: GROUPS[k].color,
    vol: group[k].vol, sets: group[k].sets,
    share: group[k].vol / (Object.values(group).reduce((a, g) => a + g.vol, 0) || 1),
  })).sort((a, b) => b.vol - a.vol);

  return { tonnage, sets, reps, muscles, groups, topSets, eccCount, cardioSets, bwSets };
}

function addKv(map, key, vol, sets, reps) {
  if (!map[key]) map[key] = { vol: 0, sets: 0, reps: 0 };
  map[key].vol += vol; map[key].sets += sets; map[key].reps += reps || 0;
}

/** 历史中每个动作的估算1RM最好成绩（不含某时间点之后） */
export function bestE1History(workouts, beforeTs) {
  const best = {};
  for (const w of (workouts || [])) {
    if (beforeTs != null && w.startedAt >= beforeTs) continue;
    for (const ex of (w.exercises || [])) {
      for (const s of (ex.sets || [])) {
        const e1 = est1RM(s.w, s.r);
        if (e1 > 0 && e1 > (best[ex.name] || 0)) best[ex.name] = e1;
      }
    }
  }
  return best;
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

/**
 * 单次训练完整分析。
 * ctx: { history: [workout], bodyweight: kg|null, unit:'kg'|'lb', dayTimeMs: 当日健身相关时间块总毫秒 }
 */
export function analyzeSession(workout, ctx) {
  ctx = ctx || {};
  const unit = ctx.unit || 'kg';
  const st = sessionStats(workout, ctx.custom || {});
  const prior = (ctx.history || []).filter(w => w.startedAt < workout.startedAt);
  const bestBefore = bestE1History(prior, null);

  // —— 主练 / 次重点 ——
  const primaries = st.muscles.filter(m => m.share >= 0.25).slice(0, 3);
  const primary = primaries.length ? primaries : st.muscles.slice(0, 1);
  const secondary = st.muscles.filter(m => !primary.includes(m) && m.share >= 0.12).slice(0, 3);
  const primaryLabels = primary.map(m => m.label).join('、');
  const secondaryLabels = secondary.map(m => m.label).join('、');

  // —— 强度：本次每组估算1RM vs 历史最好 ——
  let ratioSum = 0, ratioN = 0;
  const prs = [];
  for (const t of st.topSets) {
    if (!t.best || !t.best.e1) continue;
    const hist = bestBefore[t.name];
    if (hist > 0) { ratioSum += t.best.e1 / hist; ratioN++; }
    if (!hist || t.best.e1 > hist) {
      prs.push({ name: t.name, e1: t.best.e1, prev: hist || 0 });
    }
  }
  const ratio = ratioN ? ratioSum / ratioN : null;
  let intensity;
  if (ratio != null) {
    intensity = ratio >= 0.95 ? '高' : ratio >= 0.85 ? '中高' : ratio >= 0.7 ? '中等' : '轻';
  } else {
    intensity = st.sets >= 20 ? '中高' : st.sets >= 10 ? '中等' : '轻';
  }

  // —— 容量 vs 近期均值 ——
  const prevTons = prior.slice(-5).map(w => sessionStats(w, ctx.custom || {}).tonnage).filter(v => v > 0);
  let volVsAvg = null;
  if (prevTons.length >= 2) {
    volVsAvg = st.tonnage / avg(prevTons);
  }

  // —— 新动作比例（近 14 天没做过的） ——
  const cut = workout.startedAt - 14 * 86400000;
  const recentNames = new Set();
  prior.forEach(w => { if (w.startedAt >= cut) (w.exercises || []).forEach(e => recentNames.add(e.name)); });
  const newEx = (workout.exercises || []).filter(e => !recentNames.has(e.name));
  const newRatio = (workout.exercises || []).length ? newEx.length / workout.exercises.length : 0;

  // —— 次日酸痛(DOMS)等级预估 ——
  const legsHeavy = primary.some(m => m.group === 'legs') || (st.groups[0] && st.groups[0].key === 'legs' && st.groups[0].share > 0.4);
  let domsScore = 1;
  if (volVsAvg != null) domsScore += volVsAvg > 1.5 ? 3 : volVsAvg > 1.15 ? 2 : volVsAvg < 0.7 ? 0 : 1;
  else domsScore += st.sets >= 20 ? 2 : 1;
  if (newRatio > 0.5) domsScore += 2; else if (newRatio > 0.2) domsScore += 1;
  if (st.eccCount > 0) domsScore += 1;
  if (legsHeavy) domsScore += 1;
  if (prior.length === 0) domsScore += 1;
  const domsLevel = domsScore >= 7 ? '强烈' : domsScore >= 5 ? '明显' : domsScore >= 3 ? '中度' : '轻微';

  // —— 练后感觉 ——
  const feelMap = {
    chest: '胸口会明显充血发胀，推到最后几组手臂打颤属正常',
    back: '背部整体紧绷、肩胛周围酸胀，握力通常先于背力耗尽',
    shoulder: '肩部酸胀明显，手臂过头会感觉吃力，暂时别提重物',
    biceps: '手臂泵感强，屈肘到位时上臂前侧发僵',
    triceps: '手臂后侧发胀，伸肘发力时酸感清晰',
    forearm: '前臂和握力酸胀明显，抓握会短暂受影响',
    quad: '大腿前侧发胀发软，起身、下蹲会明显吃力',
    hamstring: '大腿后侧紧绷，弯腰和蹬地时酸感明显',
    glute: '臀部酸胀，坐硬凳子会有感觉',
    calf: '小腿发胀，踮脚时酸感清晰',
    core: '腹部发紧发酸，咳嗽、大笑、起身时核心存在感很强',
    full: '心率回落后疲惫与轻松并存，大量出汗后记得补水',
  };
  const postFeel = primary.map(m => feelMap[m.key]).filter(Boolean);
  if (intensity === '高' || (volVsAvg != null && volVsAvg > 1.3)) {
    postFeel.push('这次强度/容量不小，练后可能比平时更累，晚上容易早困，是正常的深度刺激反应。');
  } else if (st.sets >= 24) {
    postFeel.push('组数偏多，练后 1–2 小时可能进入明显疲劳期，先安排好这一餐再继续一天的事。');
  }

  // —— 次日感觉 ——
  const nextDayText = {
    轻微: '第二天基本无感或只有轻微发紧，属于正常恢复节奏，可以照常安排训练或活动。',
    中度: '第二天目标肌群会有中度酸痛，24–48 小时内逐渐消退，日常活动基本不受影响。',
    明显: '预计第二天酸痛明显，起床和久坐后起身时最有感觉；' + (legsHeavy ? '腿臀类的酸痛常持续 48 小时以上，别急着安排第二次腿课。' : '48 小时内避免同部位再次大强度训练。'),
    强烈: '第二天可能出现较强酸痛并伴随短暂力量下降，这是超大容量刺激后的正常反应；把吃睡做好，必要时完全休息一天。',
  }[domsLevel];

  // —— 恢复建议 ——
  const bw = ctx.bodyweight;
  const di = ctx.dayIntake; // {p, cal, items, hasPostMeal} 当日已记录饮食（联动）
  const lo = bw > 0 ? Math.round(bw * 1.6) : 80;
  const hi = bw > 0 ? Math.round(bw * 2.2) : 110;
  const diet = [];
  if (di && di.items > 0) {
    const eaten = Math.round(di.p);
    const left = Math.max(0, lo - eaten);
    diet.push('你在饮食页已记录今天摄入约 ' + eaten + 'g 蛋白质（目标 ' + lo + '–' + hi + 'g）' +
      (left > 0 ? '，还差约 ' + left + 'g——练后这餐优先把它补上。' : '，下限已达成，练后再补 20–30g 巩固一下即可。'));
  } else if (bw > 0) {
    diet.push('蛋白质按 ' + bw + 'kg、每公斤 1.6–2.2g 算，今天目标 ' + lo + '–' + hi + 'g，分 3–4 餐吃，练后 2 小时内先落实 25–40g。');
  } else {
    diet.push('蛋白质按每公斤体重 1.6–2.2g 摄入（在「设置」里填体重可得到具体克数），练后 2 小时内先吃含 25–40g 蛋白的一餐。');
  }
  if (legsHeavy || (volVsAvg != null && volVsAvg > 1.2)) {
    diet.push('这次练腿/容量偏大，碳水要吃够：练后一餐多安排米饭、面食或薯类帮糖原回补，这个阶段不用怕碳水。');
  } else {
    diet.push('练后一餐正常吃碳水＋蛋白的组合即可，别空着肚子硬扛。');
  }
  diet.push('训练每 1 小时补 500–750ml 水，全天以尿色淡黄为达标；出汗多时适当补点盐分。');

  const rest = [];
  if (di && di.hasPostMeal) rest.push('练后餐已经吃上了 ✓ 恢复的开局很好，接下来把睡眠守住就行。');
  rest.push('今晚睡够 7–9 小时，肌肉修复的大头在深睡期' + (legsHeavy ? '；练腿日晚上腿胀的话可以把脚垫高一会儿。' : '。'));
  if (domsLevel === '明显' || domsLevel === '强烈') {
    rest.push('明天做 10–15 分钟低强度活动（快走、轻松单车）加 5–10 分钟' + (primaryLabels || '目标肌群') + '静态拉伸或泡沫轴放松，比完全躺平恢复更快。');
  } else {
    rest.push('明天对' + (primaryLabels || '目标肌群') + '做 5–10 分钟拉伸放松，保持活动量即可。');
  }
  rest.push('24 小时内避免同部位二次大强度训练和过量饮酒，两者都会明显拖慢恢复。');
  if (prs.length) rest.push('今天有 ' + prs.length + ' 项个人纪录进账，神经系统消耗比平时大，接下来 1–2 天可以顺势降一点量。');

  // —— 简评 ——
  const brief = [];
  brief.push('本次以' + primaryLabels + '为主' + (secondaryLabels ? '、' + secondaryLabels + '为辅' : '') +
    '，共 ' + (workout.exercises || []).length + ' 个动作、' + st.sets + ' 组' +
    (st.tonnage > 0 ? '、总容量 ' + fmtLoad(st.tonnage, unit) : '') + '。');
  let quality;
  const refreshed = prs.filter(p => p.prev > 0);
  const firsts = prs.filter(p => !p.prev);
  if (prs.length >= 2) {
    let s = '';
    if (refreshed.length) s += '强度上得很足，' + refreshed.map(p => p.name).join('、') + ' 刷新了你的历史最好水平（估算1RM），状态在线。';
    if (firsts.length) s += (s ? '' : '') + firsts.map(p => p.name).join('、') + ' 为首次记录，从今天起有了对照基准。';
    quality = s;
  }
  else if (prs.length === 1) quality = prs[0].prev
    ? '其中 ' + prs[0].name + ' 刷新了历史最好（估算1RM ' + fmtLoad(prs[0].e1, unit) + '），这个部位的力量正在往上走。'
    : '其中 ' + prs[0].name + ' 是首次记录（估算1RM ' + fmtLoad(prs[0].e1, unit) + '），以后就以它为基准看进步。';
  else if (intensity === '高') quality = '负荷已经贴近你的最好水平，动作质量保持住的话进步会很快。';
  else if (intensity === '中等' || intensity === '中高') quality = '负荷中等，是一次扎实的积累型训练。';
  else quality = '负荷偏轻，如果是主动恢复或技术打磨没问题，正式课可以再加点重量。';
  brief.push(quality);
  // 课内结构
  const g0 = st.groups[0];
  if (g0 && g0.share > 0.65 && st.groups.length > 1) {
    const tips = {
      push: '如果长期这样排，肩后侧和背会相对落后，下次课可以补一个拉类动作。',
      pull: '推类占比偏低，胸肩的刺激这周记得找补回来。',
      legs: '这次几乎是纯下肢日，上肢安排在别的日子即可，注意 48 小时内别再排腿。',
      core: '核心占比很高，记得它更多是「辅助强健」，大肌群的容量也要跟上。',
      cardio: '有氧占绝对主导，力量刺激这周记得安排上。',
    };
    brief.push('动作结构上' + g0.label + '占比 ' + Math.round(g0.share * 100) + '%。' + (tips[g0.key] || ''));
  } else if (st.groups.length >= 2) {
    brief.push('课内推/拉/腿分布相对均衡，是一次结构健康的训练。');
  } else if (g0 && (workout.exercises || []).length >= 2) {
    brief.push('这次是专注' + g0.label + '的单部位课，同类动作排在一起、组间休息控制在 1–2 分钟，泵感和刺激都会更完整。');
  }
  if (volVsAvg != null) {
    const p = Math.round(volVsAvg * 100);
    if (p >= 115) brief.push('总容量约为近几次平均的 ' + p + '%，比平时大不少，接下来一两天重点做好恢复。');
    else if (p <= 70) brief.push('总容量约为近几次平均的 ' + p + '%，明显偏轻——如果是减载周那正好，不是的话下次可以加量。');
  }
  if (ctx.dayTimeMs > 0) brief.push('算上热身、整理等前后投入，今天为这次训练总共花掉 ' + fmtDur(ctx.dayTimeMs) + '。');

  return {
    at: Date.now(),
    unit,
    muscles: st.muscles, groups: st.groups,
    totals: { tonnage: st.tonnage, sets: st.sets, reps: st.reps, exercises: (workout.exercises || []).length },
    primary, secondary, primaryLabels, secondaryLabels,
    intensity, ratio: ratio == null ? null : Math.round(ratio * 100),
    prs, volVsAvg: volVsAvg == null ? null : Math.round(volVsAvg * 100),
    domsLevel, nextDayText, postFeel, diet, rest, brief,
    topSets: st.topSets.map(t => ({ name: t.name, sets: t.sets, reps: t.reps, tonnage: t.tonnage, best: t.best })),
  };
}

/**
 * 阶段分析（近 N 天）。
 * 返回频率、容量趋势、部位分布、平衡性、PR、连续训练与休息、状态评价与建议。
 */
export function analyzePeriod(workouts, days, nowTs, custom) {
  nowTs = nowTs == null ? Date.now() : nowTs;
  const end = nowTs + 86400000;
  const start = end - days * 86400000;
  const prevStart = start - days * 86400000;
  const inWin = (workouts || []).filter(w => w.startedAt >= start && w.startedAt < end).sort((a, b) => a.startedAt - b.startedAt);
  const prevWin = (workouts || []).filter(w => w.startedAt >= prevStart && w.startedAt < start);

  const weeks = days / 7;
  const freqPerWeek = inWin.length / weeks;
  const tonnageThis = inWin.reduce((a, w) => a + sessionStats(w, custom).tonnage, 0);
  const tonnagePrev = prevWin.reduce((a, w) => a + sessionStats(w, custom).tonnage, 0);
  const trendPct = tonnagePrev > 0 ? Math.round((tonnageThis / tonnagePrev - 1) * 100) : null;

  // 部位分布（按组）
  const gVol = {};
  inWin.forEach(w => sessionStats(w, custom).groups.forEach(g => {
    if (!gVol[g.key]) gVol[g.key] = { key: g.key, label: g.label, color: g.color, vol: 0, sets: 0 };
    gVol[g.key].vol += g.vol; gVol[g.key].sets += g.sets;
  }));
  const groups = Object.values(gVol).sort((a, b) => b.vol - a.vol);
  const gTotal = groups.reduce((a, g) => a + g.vol, 0) || 1;
  groups.forEach(g => g.share = g.vol / gTotal);

  // PR（本窗口内刷新历史最好）
  const bestBeforeWin = bestE1History((workouts || []).filter(w => w.startedAt < start), null);
  const runningBest = Object.assign({}, bestBeforeWin);
  const prs = [];
  for (const w of inWin) {
    for (const ex of (w.exercises || [])) {
      let best = 0;
      for (const s of (ex.sets || [])) best = Math.max(best, est1RM(s.w, s.r));
      if (best > 0 && best > (runningBest[ex.name] || 0)) {
        prs.push({ name: ex.name, e1: best, prev: runningBest[ex.name] || 0, at: w.startedAt });
        runningBest[ex.name] = best;
      }
    }
  }

  // 连续训练天数（截至最近一次训练）
  let streak = 0;
  if (inWin.length) {
    const dayTs = new Set(inWin.map(w => dayStart(w.startedAt)));
    let t = dayStart(inWin[inWin.length - 1].startedAt);
    while (dayTs.has(t)) { streak++; t -= 86400000; }
  }
  const restDays = days - new Set(inWin.map(w => dayKey(w.startedAt))).size;

  // 平衡性
  const shareOf = k => { const g = groups.find(x => x.key === k); return g ? g.share : 0; };
  const balanceNotes = [];
  const push = shareOf('push'), pull = shareOf('pull'), legs = shareOf('legs');
  if (push + pull > 0.3 && pull / (push || 0.01) < 0.5) balanceNotes.push('拉类明显少于推类，时间久了圆肩、体态问题容易找上门，下次课优先补划船/引体类动作。');
  if (push + pull > 0.3 && push / (pull || 0.01) < 0.5) balanceNotes.push('推类偏少，胸肩的容量这周可以加回来一些。');
  if (legs < 0.2 && (push + pull) > 0.4) balanceNotes.push('下肢占比不到两成，深蹲/硬拉这类大动作对全身激素环境和基础力量的回报最高，建议每周至少安排一次腿。');
  if (shareOf('core') < 0.05 && inWin.length >= 2) balanceNotes.push('核心练得很少，可以在组间穿插 2–3 组平板或举腿，不占额外时间。');
  if (!balanceNotes.length && inWin.length) balanceNotes.push('各部位分布比较均衡，继续保持这个节奏。');

  // 状态评价
  const stateParts = [];
  stateParts.push('近 ' + days + ' 天练了 ' + inWin.length + ' 次（约 ' + freqPerWeek.toFixed(1) + ' 次/周）' +
    (tonnageThis > 0 ? '，总容量 ' + fmtLoad(tonnageThis, 'kg') : ''));
  if (trendPct != null) {
    if (trendPct >= 15) stateParts.push('比上一个 ' + days + ' 天高 ' + trendPct + '%，容量处在上升通道');
    else if (trendPct <= -15) stateParts.push('比上一个 ' + days + ' 天低 ' + Math.abs(trendPct) + '%，量在回落');
    else stateParts.push('与上一阶段基本持平（' + (trendPct >= 0 ? '+' : '') + trendPct + '%）');
  } else if (inWin.length) stateParts.push('（上一阶段没有训练记录，趋势暂无法对比）');
  if (prs.length) {
    const refresh = prs.filter(p => p.prev > 0);
    const first = prs.length - refresh.length;
    let prTxt = '';
    if (refresh.length) prTxt += '刷新 ' + refresh.length + ' 项个人纪录（' + refresh.slice(0, 3).map(p => p.name).join('、') + (refresh.length > 3 ? ' 等' : '') + '）';
    if (first) prTxt += (prTxt ? '，另外首次建立 ' : '首次建立 ') + first + ' 个动作的力量基准';
    stateParts.push('期间' + prTxt);
  }

  let tone, advice = [];
  if (inWin.length === 0) {
    tone = '这段时间没有训练记录。休息也是训练的一部分，但如果已经超过一周，从一次 30 分钟的轻量课重新启动最容易。';
    advice.push('先安排 2–3 组轻重量找回动作感，别一上来就冲 PR。');
  } else if (freqPerWeek < 1) {
    tone = '频率偏低，进步主要靠规律的重复刺激，一周至少 2 次是性价比最高的起点。';
    advice.push('把训练固定写进日程（比如周二/周五晚），配合 App 的时间记录会更容易坚持。');
  } else if (streak >= 5) {
    tone = '连续训练 ' + streak + ' 天没有整休，进步幅度可能开始被疲劳吃掉，安排 1–2 天完全休息或低强度日会更好。';
    advice.push('疲劳是累积的，敢休息才敢进步。');
  } else if (trendPct != null && trendPct >= 15 && streak < 5) {
    tone = '容量与频率都在爬升，状态处于上升期；注意睡眠和蛋白质跟上，别让恢复拖后腿。';
  } else if (prs.length >= 2) {
    tone = '力量在实打实增长，说明目前的计划适合你，照这个节奏推进即可。';
  } else {
    tone = '训练节奏稳定，属于积累期——力量的增长常滞后于努力，再给身体两三周时间。';
  }
  if (trendPct != null && trendPct >= 40) advice.push('容量单阶段涨幅超过四成，属于比较激进的加量，留意关节和小肌群的疲劳信号。');

  return {
    days, sessions: inWin.length, freqPerWeek: +freqPerWeek.toFixed(1),
    tonnage: tonnageThis, trendPct, groups, prs, streak, restDays,
    balanceNotes, stateParts, tone, advice,
    dailyVolume: dailySeries(inWin, days, end, custom),
  };
}

/** 近 N 天每天的容量（用于趋势图） */
export function dailySeries(workouts, days, endTs, custom) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const s = endTs - (i + 1) * 86400000;
    const e = s + 86400000;
    const ws = workouts.filter(w => w.startedAt >= s && w.startedAt < e);
    const vol = ws.reduce((a, w) => a + sessionStats(w, custom).tonnage, 0);
    out.push({ dayKey: dayKey(s), start: s, tonnage: vol, sessions: ws.length });
  }
  return out;
}

/**
 * 某天的日简报：时间投入 + 当天各次训练的简评。
 * blocks: 当天的 timeBlocks；workouts: 当天的训练（含 analysis 或可再生成）。
 */
export function dayBrief(dateKey, blocks, workouts, categories) {
  const byCat = {};
  let totalMs = 0;
  for (const b of blocks) {
    const ms = Math.max(0, b.end - b.start);
    totalMs += ms;
    const c = (categories || []).find(x => x.key === b.cat);
    const k = c ? c.label : '其他';
    byCat[k] = (byCat[k] || 0) + ms;
  }
  const top = Object.keys(byCat).map(k => ({ label: k, ms: byCat[k] })).sort((a, b) => b.ms - a.ms);
  return {
    dateKey,
    totalMs,
    top,
    sessions: workouts.length,
    summary: totalMs > 0
      ? '今天共记录投入 ' + fmtDur(totalMs) + (top.length ? '，其中 ' + top.slice(0, 2).map(t => t.label + ' ' + fmtDur(t.ms)).join('、') : '')
      : '今天还没有时间记录，点「时间」页开始记录第一段。',
  };
}
