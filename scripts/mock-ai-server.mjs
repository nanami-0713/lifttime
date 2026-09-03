// 练时 LiftTime —— 本地模拟智谱 API（无依赖，用于离线开发/验收 AI 简评流程）
// 用法：node scripts/mock-ai-server.mjs [端口=8131]
// 然后在练时「设置 → AI 简评」里：
//   API Key 随便填（如 test），接口地址填 http://127.0.0.1:8131
// 结束一次训练即可看到 mock 版 AI 简评；它带 CORS 头，浏览器可直接调。
import { createServer } from 'node:http';

const PORT = Number(process.argv[2]) || 8131;

const MOCK_BRIEF = {
  brief: [
    '本次以胸和三头为主，12 组、总容量 12,700kg，是一堂扎实的上肢推课。',
    '卧推刷新了历史最好（估算1RM），力量曲线仍在爬升，状态在线。',
    '课内推类占比超过九成，下次训练记得补划船类动作把拉类找回来。',
  ],
  postFeel: [
    '胸口会有明显充血胀感，推类动作末段手臂打颤属正常。',
    '今晚可能比平时更容易困，是深度刺激后的正常反应。',
  ],
  nextDay: '第二天胸大肌和三头会有中度酸痛，24–48 小时逐渐消退，不影响日常活动。',
  domsLevel: '中度',
  diet: [
    '今天已摄入约 80g 蛋白质，离目标下限还差 30g 左右，练后这餐优先补上。',
    '练后一餐建议 30–40g 蛋白质配碳水，比如鸡胸加米饭或蛋白粉加香蕉。',
    '训练后两小时是补充窗口，别空着肚子硬扛。',
  ],
  rest: [
    '今晚睡够 7–9 小时，肌肉修复大头在深睡期。',
    '明天对胸肩做 5–10 分钟静态拉伸或泡沫轴放松。',
    '48 小时内避免同部位再次大强度训练。',
  ],
};

const server = createServer((req, res) => {
  // CORS：模拟「浏览器可直连」的情形
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url.startsWith('/chat/completions')) {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      // 模拟鉴权：带特定 key 可测错误分支（fail / empty / slow）
      const auth = req.headers.authorization || '';
      // 食物估算 prompt（含「估算「...」」特征）返回食物宏量 JSON
      let isFood = false;
      try { const b = JSON.parse(body); isFood = (b.messages || []).some(m => typeof m.content === 'string' && m.content.includes('估算「')); } catch (e) {}
      if (isFood) {
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ kcal: 250, p: 20, c: 10, f: 12 }) } }] }));
        }, 500);
        return;
      }
      let payload;
      if (auth.includes('fail401')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'invalid api key', code: '401' } }));
        return;
      }
      if (auth.includes('empty')) {
        payload = { choices: [{ message: { content: '' } }] };
      } else {
        payload = {
          id: 'mock-' + Date.now(),
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              reasoning_content: '（mock 思考过程：分析训练数据…）',
              content: JSON.stringify(MOCK_BRIEF, null, 2),
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 800, completion_tokens: 300, total_tokens: 1100 },
        };
      }
      // 模拟思考耗时 800ms
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      }, 800);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'not found' } }));
});

server.listen(PORT, () => {
  console.log('mock 智谱 API 已启动: http://127.0.0.1:' + PORT + '/chat/completions');
  console.log('在练时设置里把接口地址填为 http://127.0.0.1:' + PORT);
});
