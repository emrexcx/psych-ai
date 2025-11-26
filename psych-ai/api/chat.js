// 文件路径：api/chat.js

export const config = {
  runtime: 'edge', // 使用 Edge 模式，打字机效果更流畅
};

export default async function handler(req) {
  // 只允许 POST 请求
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    // 1. 解析前端发来的数据
    const { query, bot_id, conversation_id } = await req.json();

    // 2. 从 Vercel 后台读取你的 API Key (最安全！)
    const COZE_API_KEY = process.env.COZE_API_KEY;

    if (!COZE_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'API Key 未配置，请在 Vercel 环境变量中添加 COZE_API_KEY' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3. 转发请求给 Coze
    // 注意：国内版用 api.coze.cn，国际版用 api.coze.com
    const cozeRes = await fetch('https://api.coze.cn/open_api/v2/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Connection': 'keep-alive',
      },
      body: JSON.stringify({
        conversation_id: conversation_id || "web_" + Date.now(),
        bot_id: bot_id,
        user: "web_user",
        query: query,
        stream: true, // 开启流式输出
      }),
    });

    if (!cozeRes.ok) {
      const errorText = await cozeRes.text();
      return new Response(
        JSON.stringify({ error: `Coze API 报错: ${cozeRes.status}`, details: errorText }),
        { status: cozeRes.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 4. 把流直接转发回前端
    return new Response(cozeRes.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    return new Response(
      JSON.stringify({ error: '服务器内部错误', details: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}