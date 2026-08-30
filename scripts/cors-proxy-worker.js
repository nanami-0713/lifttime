// 练时 LiftTime —— 智谱 API 的 CORS 代理（Cloudflare Workers 免费部署）
//
// 背景：浏览器直连 https://open.bigmodel.cn 可能被 CORS 预检拦截（取决于智谱侧策略）。
// 这个 Worker 只做一件事：把请求原样转发给智谱 Coding Plan 端点，并补上 CORS 头。
//
// 部署步骤（约 3 分钟，免费额度足够个人用）：
//   1. 打开 https://workers.cloudflare.com/ 注册/登录（免费计划即可）
//   2. Create Application → Create Worker → 把本文件全部内容粘进编辑器 → Deploy
//   3. 复制 Worker 地址（形如 https://lifttime-glm-proxy.<你的子域>.workers.dev）
//   4. 回到练时「设置 → AI 简评」，把「接口地址」改为：
//        https://lifttime-glm-proxy.<你的子域>.workers.dev
//      （本代理会把 /chat/completions 拼到上游 Coding Plan 端点后面，与直连行为一致）
//
// 安全说明：你的 API Key 仍然只存在你自己的手机/浏览器里，
// 请求只是「路过」这个 Worker 转发，Key 不落盘、不记录（代码里没有任何存储）。

const UPSTREAM = 'https://open.bigmodel.cn/api/coding/paas/v4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    // 预检请求直接放行
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'POST' && request.method !== 'GET') {
      return new Response('method not allowed', { status: 405, headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    // 只放行 /chat/completions 路径，避免代理被拿去转发别的请求
    if (url.pathname !== '/chat/completions') {
      return new Response('only /chat/completions is proxied', { status: 404, headers: CORS_HEADERS });
    }
    const upstream = UPSTREAM + url.pathname + url.search;
    const res = await fetch(upstream, {
      method: request.method,
      headers: {
        'Content-Type': request.headers.get('Content-Type') || 'application/json',
        'Authorization': request.headers.get('Authorization') || '',
      },
      body: request.method === 'POST' ? await request.text() : undefined,
    });
    const out = new Response(res.body, { status: res.status, statusText: res.statusText });
    out.headers.set('Content-Type', res.headers.get('Content-Type') || 'application/json');
    for (const [k, v] of Object.entries(CORS_HEADERS)) out.headers.set(k, v);
    return out;
  },
};
