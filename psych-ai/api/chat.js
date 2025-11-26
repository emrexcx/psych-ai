// ✅ 文件路径：api/chat.js
export const config = {
  runtime: 'edge', // 必须开启 edge 模式
};

export default async function handler(req) {
  // 1. 只允许 POST 请求
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    // 2. 解析前端传来的数据
    const { query, bot_id, conversation_id } = await req.json();

    // 3. 检查环境变量
    const COZE_API_TOKEN = process.env.COZE_API_TOKEN;
    if (!COZE_API_TOKEN) {
      return new Response(JSON.stringify({ error: 'Missing COZE_API_TOKEN' }), { status: 500 });
    }

    // 4. 向 Coze 发起请求 (注意是 .cn)
    const cozeResponse = await fetch('https://api.coze.cn/v3/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${COZE_API_TOKEN}`
      },
      body: JSON.stringify({
        bot_id: bot_id,
        user_id: "web_user_" + Math.random().toString(36).slice(2),
        stream: true, 
        auto_save_history: true,
        additional_messages: [
          { role: "user", content: query, content_type: "text" }
        ]
      })
    });

    if (!cozeResponse.ok) {
      const errText = await cozeResponse.text();
      return new Response(JSON.stringify({ error: `Coze API Error: ${cozeResponse.status}`, details: errText }), { status: 500 });
    }

    // 5. 建立流式管道 (手动搬运数据，防止卡顿)
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const reader = cozeResponse.body.getReader();

    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
        }
      } catch (e) {
        console.error('Stream error:', e);
      } finally {
        writer.close();
      }
    })();

    return new Response(readable, {
      headers: { 'Content-Type': 'text/event-stream' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
