// 动作库：名称/别名 → 目标肌群映射（纯数据，无 DOM）
// p = 主要发力肌群, s = 次要参与肌群, bw = 自重为主, cardio = 有氧/计时类, ecc = 离心刺激大(易迟发酸痛)

export const MUSCLES = {
  chest:    { label: '胸',     group: 'push' },
  shoulder: { label: '肩',     group: 'push' },
  triceps:  { label: '肱三头', group: 'push' },
  back:     { label: '背',     group: 'pull' },
  biceps:   { label: '肱二头', group: 'pull' },
  forearm:  { label: '前臂',   group: 'pull' },
  quad:     { label: '股四头', group: 'legs' },
  hamstring:{ label: '腘绳肌', group: 'legs' },
  glute:    { label: '臀',     group: 'legs' },
  calf:     { label: '小腿',   group: 'legs' },
  core:     { label: '核心',   group: 'core' },
  full:     { label: '全身',   group: 'cardio' },
};

export const GROUPS = {
  push:  { label: '推类(胸肩三头)', color: '#ef4444' },
  pull:  { label: '拉类(背二头)',   color: '#3b82f6' },
  legs:  { label: '腿臀',           color: '#22c55e' },
  core:  { label: '核心',           color: '#f59e0b' },
  cardio:{ label: '有氧/全身',      color: '#14b8a6' },
};

const M = MUSCLES;
export const EXERCISE_DB = [
  // 胸
  { n: '卧推',          a: ['杠铃卧推', '平板卧推', '哑铃卧推', 'bench press'], p: ['chest'], s: ['triceps', 'shoulder'] },
  { n: '上斜卧推',      a: ['上斜杠铃卧推', '上斜哑铃卧推'], p: ['chest'], s: ['shoulder', 'triceps'] },
  { n: '下斜卧推',      a: [], p: ['chest'], s: ['triceps'] },
  { n: '夹胸',          a: ['蝴蝶机夹胸', '绳索夹胸', '龙门架夹胸'], p: ['chest'], s: [] },
  { n: '俯卧撑',        a: ['标准俯卧撑'], p: ['chest'], s: ['triceps', 'core'], bw: 1 },
  { n: '双杠臂屈伸',    a: ['双杠'], p: ['chest', 'triceps'], s: ['shoulder'], bw: 1, ecc: 1 },
  // 背
  { n: '引体向上',      a: ['正手引体', 'chin up'], p: ['back', 'biceps'], s: ['forearm'], bw: 1, ecc: 1 },
  { n: '高位下拉',      a: ['坐姿下拉'], p: ['back'], s: ['biceps'] },
  { n: '杠铃划船',      a: ['俯身划船', 'barbell row'], p: ['back'], s: ['biceps', 'hamstring'] },
  { n: '坐姿划船',      a: ['器械划船', '绳索划船'], p: ['back'], s: ['biceps'] },
  { n: '单臂哑铃划船',  a: ['单边划船'], p: ['back'], s: ['biceps'] },
  { n: '直臂下压',      a: ['直臂下拉'], p: ['back'], s: [] },
  { n: '硬拉',          a: ['deadlift'], p: ['back', 'hamstring'], s: ['glute', 'quad', 'forearm'], ecc: 1 },
  { n: '罗马尼亚硬拉',  a: ['RDL'], p: ['hamstring', 'glute'], s: ['back'], ecc: 1 },
  { n: '面拉',          a: ['face pull'], p: ['back', 'shoulder'], s: [] },
  // 肩
  { n: '推举',          a: ['肩推', '杠铃推举', '哑铃推举', '军推', '实力举'], p: ['shoulder'], s: ['triceps'] },
  { n: '阿诺德推举',    a: [], p: ['shoulder'], s: ['triceps'] },
  { n: '侧平举',        a: ['哑铃侧平举'], p: ['shoulder'], s: [] },
  { n: '前平举',        a: [], p: ['shoulder'], s: [] },
  { n: '反向飞鸟',      a: ['俯身飞鸟', '后束飞鸟'], p: ['shoulder'], s: ['back'] },
  { n: '耸肩',          a: ['哑铃耸肩'], p: ['back'], s: ['forearm'] },
  // 手臂
  { n: '弯举',          a: ['杠铃弯举', '哑铃弯举', '站姿弯举'], p: ['biceps'], s: ['forearm'] },
  { n: '锤式弯举',      a: [], p: ['biceps', 'forearm'], s: [] },
  { n: '牧师弯举',      a: ['斜板弯举'], p: ['biceps'], s: [] },
  { n: '绳索弯举',      a: [], p: ['biceps'], s: ['forearm'] },
  { n: '窄距卧推',      a: ['窄握卧推'], p: ['triceps'], s: ['chest'] },
  { n: '绳索下压',      a: ['三头下压', '器械下压'], p: ['triceps'], s: [] },
  { n: '仰卧臂屈伸',    a: ['skull crusher', '碎颅式'], p: ['triceps'], s: [] },
  { n: '过头臂屈伸',    a: ['哑铃颈后臂屈伸'], p: ['triceps'], s: ['shoulder'] },
  { n: '腕弯举',        a: ['前臂弯举'], p: ['forearm'], s: [] },
  // 腿臀
  { n: '深蹲',          a: ['杠铃深蹲', '后蹲', 'squat'], p: ['quad', 'glute'], s: ['hamstring', 'core'], ecc: 1 },
  { n: '前蹲',          a: ['前深蹲'], p: ['quad'], s: ['core'], ecc: 1 },
  { n: '腿举',          a: ['倒蹬', 'leg press'], p: ['quad', 'glute'], s: ['hamstring'] },
  { n: '哈克深蹲',      a: ['hack squat'], p: ['quad'], s: ['glute'] },
  { n: '保加利亚分腿蹲', a: ['保加利亚蹲'], p: ['quad', 'glute'], s: ['hamstring'], ecc: 1 },
  { n: '箭步蹲',        a: ['弓步蹲', '行走箭步蹲'], p: ['quad', 'glute'], s: ['hamstring'], ecc: 1 },
  { n: '腿屈伸',        a: ['坐姿屈膝伸腿'], p: ['quad'], s: [] },
  { n: '腿弯举',        a: ['俯卧腿弯举'], p: ['hamstring'], s: ['calf'] },
  { n: '臀桥',          a: ['髋推', '臀推'], p: ['glute'], s: ['hamstring'] },
  { n: '提踵',          a: ['站姿提踵', '坐姿提踵'], p: ['calf'], s: [] },
  // 核心
  { n: '平板支撑',      a: ['plank'], p: ['core'], s: ['shoulder'], bw: 1 },
  { n: '卷腹',          a: ['仰卧起坐'], p: ['core'], s: [], bw: 1 },
  { n: '悬垂举腿',      a: ['举腿'], p: ['core'], s: ['forearm'], bw: 1 },
  { n: '俄罗斯转体',    a: [], p: ['core'], s: [], bw: 1 },
  { n: '健腹轮',        a: ['腹轮'], p: ['core'], s: ['shoulder'], bw: 1 },
  // 有氧 / 全身
  { n: '跑步',          a: ['慢跑', '跑步机'], p: ['full'], s: ['quad', 'calf'], bw: 1, cardio: 1 },
  { n: '快走',          a: [], p: ['full'], s: [], bw: 1, cardio: 1 },
  { n: '椭圆机',        a: [], p: ['full'], s: [], bw: 1, cardio: 1 },
  { n: '划船机',        a: ['赛艇机'], p: ['full'], s: ['back', 'quad'], bw: 1, cardio: 1 },
  { n: '骑行',          a: ['动感单车', '自行车'], p: ['full'], s: ['quad'], bw: 1, cardio: 1 },
  { n: '跳绳',          a: [], p: ['full'], s: ['calf'], bw: 1, cardio: 1 },
  { n: '游泳',          a: [], p: ['full'], s: ['back'], bw: 1, cardio: 1 },
  { n: '波比跳',        a: ['burpee'], p: ['full'], s: ['chest', 'quad'], bw: 1, cardio: 1 },
  { n: 'HIIT',          a: ['高强度间歇'], p: ['full'], s: [], bw: 1, cardio: 1 },
];

/** 归一化名称用于匹配（去空格、小写） */
function norm(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }

/** 在内置库里找动作：精确名 → 精确别名 → 包含匹配。找不到返回 null */
export function findInDB(name) {
  if (!name) return null;
  const q = norm(name);
  let hit = EXERCISE_DB.find(e => norm(e.n) === q);
  if (hit) return hit;
  hit = EXERCISE_DB.find(e => (e.a || []).some(al => norm(al) === q));
  if (hit) return hit;
  hit = EXERCISE_DB.find(e => norm(e.n).includes(q) || q.includes(norm(e.n)));
  if (hit) return hit;
  hit = EXERCISE_DB.find(e => (e.a || []).some(al => { const n = norm(al); return n.includes(q) || q.includes(n); }));
  return hit || null;
}

/**
 * 解析动作的肌群映射。
 * custom: { 动作名: { p: [muscleKey] } } 用户自定义映射优先。
 * 返回 { entry, primary, secondary, flags }；未知动作 primary 为空（界面会引导补一个部位）。
 */
export function resolveExercise(name, custom) {
  const c = custom && custom[name];
  if (c && c.p && c.p.length) {
    return { entry: { n: name, p: c.p, s: c.s || [] }, primary: c.p, secondary: c.s || [], flags: { bw: 0, cardio: 0, ecc: 0 } };
  }
  const e = findInDB(name);
  if (!e) return { entry: null, primary: [], secondary: [], flags: { bw: 0, cardio: 0, ecc: 0 } };
  return {
    entry: e,
    primary: e.p || [],
    secondary: e.s || [],
    flags: { bw: !!e.bw, cardio: !!e.cardio, ecc: !!e.ecc },
  };
}

/** 搜索动作（供选择器）：返回 [{name, primary, secondary}] */
export function searchExercises(q, limit) {
  limit = limit || 40;
  if (!q) return EXERCISE_DB.slice(0, limit).map(e => ({ name: e.n, primary: e.p, secondary: e.s }));
  const nq = norm(q);
  const scored = [];
  for (const e of EXERCISE_DB) {
    const names = [e.n].concat(e.a || []);
    let best = -1;
    for (const nm of names) {
      const n = norm(nm);
      let sc = -1;
      if (n === nq) sc = 100;
      else if (n.startsWith(nq)) sc = 80;
      else if (n.includes(nq)) sc = 60;
      else if (nq.includes(n)) sc = 40;
      if (sc > best) best = sc;
    }
    if (best > 0) scored.push({ sc: best, e });
  }
  scored.sort((a, b) => b.sc - a.sc);
  return scored.slice(0, limit).map(x => ({ name: x.e.n, primary: x.e.p, secondary: x.e.s }));
}

export function muscleLabel(key) { return MUSCLES[key] ? MUSCLES[key].label : key; }
export function muscleLabels(keys) { return (keys || []).map(muscleLabel); }
export function groupOfMuscle(key) { return MUSCLES[key] ? MUSCLES[key].group : 'cardio'; }
