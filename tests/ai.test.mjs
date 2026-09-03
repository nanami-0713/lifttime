// AI 模块单元测试：node tests/ai.test.mjs
import { aiConfig, buildWorkoutPrompt, parseAIResponse, callAI, generateAIAnalysis, aiEstimateFood, parseFoodEstimate, AIError, AI_DEFAULTS } from '../js/ai.js';

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.error('  ✗ FAIL: ' + msg); }
}

console.log('— aiConfig —');
ok(aiConfig({}) === null, '无 Key 返回 null');
ok(aiConfig({ aiKey: 'k' }).baseUrl === AI_DEFAULTS.baseUrl, '默认 coding plan 端点');
ok(aiConfig({ aiKey: 'k' }).model === 'glm-5.3-flash', '默认模型 glm-5.3-flash');
ok(aiConfig({ aiKey: 'k' }).effort === 'max', '默认思考强度 max');
ok(aiConfig({ aiKey: 'k', aiBaseUrl: 'http://x.dev/' }).baseUrl === 'http://x.dev', '自定义端点去尾斜杠');

console.log('— buildWorkoutPrompt —');
const workout = {
  startedAt: Date.now(), endAt: Date.now() + 3600000, feeling: 4, notes: '状态好',
  exercises: [
    { name: '卧推', sets: [{ w: 60, r: 10 }, { w: 65, r: 8 }] },
    { name: '引体向上', sets: [{ w: null, r: 8 }] },
  ],
};
const analysis = {
  primaryLabels: '胸、肱三头', secondaryLabels: '肩',
  totals: { tonnage: 12700, sets: 12, reps: 96 },
  intensity: '中高', ratio: 96, prs: [{ name: '卧推', prev: 76, e1: 81 }], volVsAvg: 115,
};
const msgs = buildWorkoutPrompt(workout, analysis, {
  bodyweight: 70, dayIntake: { p: 80, cal: 1500, items: 5 },
  history: [{ startedAt: Date.now() - 86400000, analysis: { primaryLabels: '背' } }],
});
ok(msgs.length === 2 && msgs[0].role === 'system', '消息结构 system+user');
const user = msgs[1].content;
ok(user.includes('卧推') && user.includes('60kg×10'), '包含动作与重量');
ok(user.includes('引体向上') && user.includes('自重×8'), '自重动作标注');
ok(user.includes('胸、肱三头'), '包含主练部位');
ok(user.includes('12700'), '包含总容量');
ok(user.includes('蛋白质约80g'), '包含当日摄入（联动）');
ok(user.includes('70'), '包含体重');
ok(user.includes('刷新此前纪录'), '包含 PR 信息');
ok(user.includes('domsLevel'), '输出格式要求含 domsLevel');
ok(msgs[0].content.includes('只输出 JSON'), 'system 约束 JSON 输出');

console.log('— parseAIResponse —');
const good = JSON.stringify({
  brief: ['段一', '段二'], postFeel: ['充血'], nextDay: '明天胸会酸', domsLevel: '中度',
  diet: ['蛋白质 120g'], rest: ['睡 8 小时'],
});
let r = parseAIResponse(good);
ok(r.brief.length === 2 && r.nextDayText === '明天胸会酸' && r.domsLevel === '中度', '标准 JSON 解析');
r = parseAIResponse('```json\n' + good + '\n```');
ok(r.brief.length === 2, '带围栏也能解析');
r = parseAIResponse('好的，这是简评：\n' + good + '\n希望对你有帮助');
ok(r.diet[0] === '蛋白质 120g', '前后有废话也能截取');
ok(parseAIResponse('{"domsLevel":"无敌酸","brief":["x"]}').domsLevel === undefined, '非法 domsLevel 被丢弃');
let threw = false;
try { parseAIResponse('{"brief":[]}'); } catch (e) { threw = true; }
ok(threw, '全空字段抛错（调用方降级规则版）');
threw = false;
try { parseAIResponse('没有 JSON'); } catch (e) { threw = true; }
ok(threw, '非 JSON 抛错');
threw = false;
try { parseAIResponse('{"foo":1}'); } catch (e) { threw = true; }
ok(threw, '无可用字段抛错');

console.log('— callAI（注入 mock fetch）—');
const mockOk = async (url, opts) => {
  const body = JSON.parse(opts.body);
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: good, reasoning_content: '思考过程' } }] }),
    _body: body,
  };
};
const cfg = { key: 'k', baseUrl: 'http://mock.dev/api', model: 'glm-5.3-flash', effort: 'max', timeoutMs: 5000 };
const content = await callAI(cfg, msgs, mockOk);
ok(content === good, 'mock 返回 content（忽略 reasoning）');
// 校验请求构造
let captured = null;
await callAI(cfg, msgs, async (url, opts) => { captured = { url, opts }; return mockOk(url, opts); });
ok(captured.url === 'http://mock.dev/api/chat/completions', 'URL 拼接正确');
ok(captured.opts.headers['Authorization'] === 'Bearer k', 'Bearer 头');
ok(captured.opts.body.includes('"reasoning_effort":"max"'), 'body 含 reasoning_effort max');
ok(captured.opts.body.includes('"thinking":{"type":"enabled"}'), 'body 含 thinking enabled');
// 端点已带 /chat/completions 时不重复拼接
await callAI(Object.assign({}, cfg, { baseUrl: 'http://m.dev/v4/chat/completions' }), msgs, async (url, opts) => { captured = { url }; return mockOk(url, opts); });
ok(captured.url === 'http://m.dev/v4/chat/completions', '完整端点不重复拼接');
// HTTP 错误映射
let err = null;
try { await callAI(cfg, msgs, async () => ({ ok: false, status: 401, text: async () => '{"error":{"message":"invalid key"}}' })); } catch (e) { err = e; }
ok(err instanceof AIError && err.kind === 'http' && err.message.includes('Key 无效'), '401 → Key 无效提示');
err = null;
try { await callAI(cfg, msgs, async () => { throw new TypeError('Failed to fetch'); }); } catch (e) { err = e; }
ok(err.kind === 'network' && err.message.includes('跨域'), '网络/CORS 失败给出代理指引');

console.log('— generateAIAnalysis —');
const fields = await generateAIAnalysis(workout, analysis, {}, cfg, mockOk);
ok(fields.brief.length === 2 && fields.domsLevel === '中度', '端到端（mock）生成字段');

console.log('— parseFoodEstimate —');
let fe = parseFoodEstimate('{"kcal":520,"p":28,"c":45,"f":22}');
ok(fe.kcal === 520 && fe.p === 28, '标准解析');
fe = parseFoodEstimate('```json\n{"kcal":300,"p":10,"c":40,"f":10}\n```');
ok(fe.kcal === 300, '带围栏解析');
fe = parseFoodEstimate('估算结果如下：{"kcal":180,"p":12,"c":8,"f":6}');
ok(fe.p === 12, '带前导语解析');
let feThrew = false;
try { parseFoodEstimate('{"kcal":0}'); } catch (e) { feThrew = true; }
ok(feThrew, '零热量判无效');
feThrew = false;
try { parseFoodEstimate('没有json'); } catch (e) { feThrew = true; }
ok(feThrew, '非 JSON 抛错');
// aiEstimateFood 走 callAI（mock fetch），且强制 effort=low
let capBody = null;
const mockFood = async (url, opts) => { capBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ choices: [{ message: { content: '{"kcal":250,"p":20,"c":10,"f":12}' } }] }) }; };
const est = await aiEstimateFood('神秘烤肉饭', 400, cfg, mockFood);
ok(est.kcal === 250 && est.p === 20, 'aiEstimateFood 端到端');
ok(capBody.reasoning_effort === 'low', '食物估算强制 low 强度（求快）');
ok(capBody.messages[1].content.includes('400'), 'prompt 携带克数');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
