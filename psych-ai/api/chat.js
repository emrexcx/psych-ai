// api/chat.js (服务端过滤版 - 解决无输出和重复问题)
export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    const { query, bot_id } = await req.json();
    const COZE_API_TOKEN = process.env.COZE_API_TOKEN;

    // 1. 向 Coze 发起请求
    const upstreamResponse = await fetch('https://api.coze.cn/v3/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${COZE_API_TOKEN}`
      },
      body: JSON.stringify({
        bot_id: bot_id,
        user_id: "web_user_" + Date.now(),
        stream: true, 
        auto_save_history: true,
        additional_messages: [{ role: "user", content: query, content_type: "text" }]
      })
    });

    if (!upstreamResponse.ok) {
      const errText = await upstreamResponse.text();
      return new Response(JSON.stringify({ error: errText }), { status: 500 });
    }

    // 2. 手动处理流 (这是为了确保 Vercel 能把数据推给前端)
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const reader = upstreamResponse.body.getReader();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data:') && line.length > 5) {
                try {
                  const rawJson = line.slice(5).trim();
                  if (rawJson === '[DONE]') continue;
                  const data = JSON.parse(rawJson);

                  // 🛡️🛡️🛡️ 后端过滤器 🛡️🛡️🛡️
                  
                  // 1. 只要 "正在打字" (delta)，不要 "总结" (completed) -> 解决说话重复
                  if (data.event !== 'conversation.message.delta') continue;

                  // 2. 只要 "回答" (answer)，不要 "追问" (follow_up) -> 解决尾巴长
                  if (data.message?.type === 'follow_up') continue;

                  // 3. 过滤代码日志
                  if (data.message?.content) {
                     const content = data.message.content;
                     if (content.trim().startsWith('{') || content.includes('msg_type')) continue;
                     
                     // ✅ 这是一个完美的数据包，发给前端！
                     controller.enqueue(encoder.encode(line + '\n\n'));
                  }

                } catch (e) {
                  // JSON 解析失败忽略，继续发原始数据以防万一
                }
              }
            }
          }
        } catch (err) {
          console.error('Stream error:', err);
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: { 
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
