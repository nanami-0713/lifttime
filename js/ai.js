// AI 简评：接入智谱 GLM（Coding Plan OpenAI 兼容端点）
// Key 仅存本机 localStorage，浏览器直连 API；跨域被拦时降级规则版并给出指引
export const AI_DEFAULTS = {
  baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
  model: 'glm-5.3-flash',
  effort: 'max',      // low | high | max（GLM-5.3 强制思考，三档强度）
  timeoutMs: 120000,  // max 思考较慢，给足时间
};

export function aiConfig(settings) {
  const s = settings || {};
  if (!s.aiKey) return null;
  return {
    key: s.aiKey,
    baseUrl: (s.aiBaseUrl || AI_DEFAULTS.baseUrl).replace(/\/+$/, ''),
    model: s.aiModel || AI_DEFAULTS.model,
    effort: s.aiEffort || AI_DEFAULTS.effort,
    timeoutMs: AI_DEFAULTS.timeoutMs,
  };
}

/** 训练数据 → 对话消息（system + user） */
export function buildWorkoutPrompt(workout, a, ctx) {
  ctx = ctx || {};
  const exLines = (workout.exercises || []).map(ex => {
    const sets = (ex.sets || []).map(s => (s.w > 0 ? s.w + 'kg' : '自重') + '×' + s.r).join('，');
    return `- ${ex.name}：${sets}`;
  }).join('\n');
  const hist = (ctx.history || []).slice(-5).map(w => {
    const labels = w.analysis && w.analysis.primaryLabels ? w.analysis.primaryLabels : '';
    const d = new Date(w.startedAt);
    return `${d.getMonth() + 1}/${d.getDate()} ${labels}`;
  }).join('；');
  const data = {
    日期: new Date(workout.startedAt).toLocaleString('zh-CN'),
    训练时长分钟: workout.endAt ? Math.round((workout.endAt - workout.startedAt) / 60000) : null,
    动作与组数: exLines,
    主练部位: a.primaryLabels,
    次重点: a.secondaryLabels || '无',
    总容量kg: Math.round(a.totals.tonnage),
    总组数: a.totals.sets,
    总次数: a.totals.reps,
    强度评估: a.intensity + (a.ratio != null ? `（对比历史最好 ${a.ratio}%）` : ''),
    个人纪录: a.prs.length ? a.prs.map(p => p.name + (p.prev ? ' 刷新此前纪录' : ' 首次纪录')).join('、') : '无',
    容量对比近期均值: a.volVsAvg != null ? a.volVsAvg + '%' : '数据不足',
    练后自感: ['', '毫无感觉', '轻松', '适中', '较累', '疲惫/力竭'][workout.feeling || 3],
    用户备注: workout.notes || '无',
    体重kg: ctx.bodyweight || '未填写',
    当天已摄入: ctx.dayIntake && ctx.dayIntake.items > 0
      ? `蛋白质约${Math.round(ctx.dayIntake.p)}g、热量约${Math.round(ctx.dayIntake.cal)}kcal`
      : '今天还没记饮食',
    近几次训练: hist || '这是第一次记录',
  };
  return [
    {
      role: 'system',
      content: '你是一位经验丰富的健身教练，点评直接、具体、善用数字，像朋友一样说话，不堆砌术语，不写免责声明。你只输出 JSON，不输出任何其他内容。',
    },
    {
      role: 'user',
      content: '这是我今天的一次力量训练数据，请生成训练简评。\n\n' + JSON.stringify(data, null, 2) + '\n\n' +
        '严格按这个 JSON 结构输出（不要加 markdown 代码围栏）：\n' +
        '{\n' +
        '  "brief": ["2-4 段简评，每段不超过 45 字：第 1 段总结主练与容量，后面评价强度/动作结构/近期状态"],\n' +
        '  "postFeel": ["2-4 条练后这几小时身体会有什么感觉"],\n' +
        '  "nextDay": "第二天酸痛和状态预测，1-2 句",\n' +
        '  "domsLevel": "轻微/中度/明显/强烈 四选一",\n' +
        '  "diet": ["3-4 条饮食建议：若已给出当天摄入，结合缺口给具体到克的建议；练后餐怎么吃不重复啰嗦"],\n' +
        '  "rest": ["2-4 条休息与恢复建议"]\n' +
        '}',
    },
  ];
}

/** 从模型输出里稳健地抠出 JSON 并校验 */
export function parseAIResponse(text) {
  if (!text || typeof text !== 'string') throw new Error('模型没有返回内容');
  let s = text.trim();
  // 去掉 markdown 围栏
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  // 若前后有废话，截取第一个 { 到最后一个 }
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) throw new Error('模型输出不是 JSON');
  let obj;
  try { obj = JSON.parse(s.slice(i, j + 1)); }
  catch (e) { throw new Error('JSON 解析失败: ' + e.message); }

  const arr = v => Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : [];
  const out = {};
  const brief = arr(obj.brief);
  if (brief.length) out.brief = brief.slice(0, 5);
  const postFeel = arr(obj.postFeel);
  if (postFeel.length) out.postFeel = postFeel.slice(0, 5);
  if (typeof obj.nextDay === 'string' && obj.nextDay.trim()) out.nextDayText = obj.nextDay.trim();
  if (['轻微', '中度', '明显', '强烈'].includes(obj.domsLevel)) out.domsLevel = obj.domsLevel;
  const diet = arr(obj.diet);
  if (diet.length) out.diet = diet.slice(0, 5);
  const rest = arr(obj.rest);
  if (rest.length) out.rest = rest.slice(0, 5);
  if (!Object.keys(out).length) throw new Error('JSON 里没有可用字段');
  return out;
}

export class AIError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

/**
 * 调用智谱 API。fetchImpl 可注入（测试用），默认全局 fetch。
 * cfg: {key, baseUrl, model, effort, timeoutMs}
 */
export async function callAI(cfg, messages, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  const url = /\/chat\/completions$/.test(cfg.baseUrl) ? cfg.baseUrl : cfg.baseUrl + '/chat/completions';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs || AI_DEFAULTS.timeoutMs);
  let res;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.key,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        thinking: { type: 'enabled' },
        reasoning_effort: cfg.effort,
        max_tokens: 4096,
        temperature: 0.7,
        stream: false,
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === 'AbortError') throw new AIError('timeout', '请求超时（' + Math.round((cfg.timeoutMs || AI_DEFAULTS.timeoutMs) / 1000) + ' 秒），大模型思考太久了，可以把思考强度调低一档');
    throw new AIError('network', '网络请求失败：' + (e && e.message ? e.message : '无法连接') + '。如果是浏览器跨域被拦，可在设置里把接口地址改成自部署代理（仓库 scripts/cors-proxy-worker.js 可免费部署）');
  }
  clearTimeout(timer);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let msg = 'HTTP ' + res.status;
    try {
      const j = JSON.parse(body);
      msg += '：' + (j.error && (j.error.message || j.error.code) ? (j.error.message || j.error.code) : body.slice(0, 120));
    } catch (e) { msg += '：' + body.slice(0, 120); }
    if (res.status === 401 || res.status === 403) msg = 'API Key 无效或没有权限（' + msg + '），请检查设置里的 Key';
    else if (res.status === 429) msg = '额度不足或触发限流（' + msg + '）';
    throw new AIError('http', msg);
  }
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content : '';
  if (!content) throw new AIError('empty', '模型返回为空');
  return content;
}

/** 生成 AI 简评字段（抛异常时调用方降级） */
export async function generateAIAnalysis(workout, ruleAnalysis, ctx, cfg, fetchImpl) {
  const messages = buildWorkoutPrompt(workout, ruleAnalysis, ctx);
  const text = await callAI(cfg, messages, fetchImpl);
  return parseAIResponse(text);
}

/** AI 估算单个食物的热量和三大营养素（用 low 强度，求快） */
export async function aiEstimateFood(text, grams, cfg, fetchImpl) {
  const messages = [
    { role: 'system', content: '你是营养师，熟悉《中国食物成分表》。只输出 JSON，不要解释、不要围栏。' },
    { role: 'user', content: '估算「' + text + '」（可食部分约 ' + (grams > 0 ? grams : 100) + ' 克）的热量和三大营养素。严格输出 JSON：{"kcal":数字,"p":数字,"c":数字,"f":数字}，kcal=千卡，p/c/f=克。拿不准就给最常见的餐馆/家庭做法的合理估值。' },
  ];
  const content = await callAI(Object.assign({}, cfg, { effort: 'low' }), messages, fetchImpl);
  return parseFoodEstimate(content);
}

/** 解析 AI 食物估算输出 */
export function parseFoodEstimate(text) {
  let s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) throw new Error('AI 输出不是 JSON');
  let o;
  try { o = JSON.parse(s.slice(i, j + 1)); } catch (e) { throw new Error('JSON 解析失败'); }
  const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const out = { kcal: num(o.kcal), p: num(o.p), c: num(o.c), f: num(o.f) };
  if (!(out.kcal > 0)) throw new Error('AI 估算结果无效');
  return out;
}
