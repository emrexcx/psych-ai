// api/chat.js (智能过滤版 - 完美解决双重输出)
export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    const { query, bot_id, conversation_id } = await req.json();
    
    // 1. 保持 stream: true，为了打字机效果
    const response = await fetch('https://api.coze.cn/v3/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.COZE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bot_id: bot_id,
        user_id: "web_user_" + Date.now(),
        stream: true, // 必须是 true
        auto_save_history: true,
        additional_messages: [{ role: "user", content: query, content_type: "text" }]
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return new Response(JSON.stringify({ error: err }), { status: 500 });
    }

    // 2. 建立过滤管道
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const reader = response.body.getReader();

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
                  // Coze 有时候会发一个 [DONE]
                  if (rawJson === '[DONE]') continue;

                  const data = JSON.parse(rawJson);

                  // 🛡️🛡️🛡️ 核心过滤器 (根据你提供的文档截图) 🛡️🛡️🛡️

                  // 1. 只允许 "message.delta" (正在打字)
                  // ❌ 坚决拦截 "message.completed" (这就解决了双重输出！)
                  if (data.event !== 'conversation.message.delta') continue;

                  // 2. 检查消息内容
                  if (data.message && data.message.content) {
                     const content = data.message.content;
                     const type = data.message.type;

                     // ❌ 拦截 "follow_up" (追问建议)
                     if (type === 'follow_up') continue;
                     
                     // ❌ 拦截 "verbose" (冗余包)
                     if (type === 'verbose') continue;

                     // ❌ 拦截代码日志 (msg_type)
                     if (content.trim().startsWith('{') || content.includes('msg_type')) continue;
                     
                     // ✅ 只有通过了上面所有关卡的，才是真正的“人话”
                     // 我们把它重新打包成 SSE 格式发给前端
                     const cleanData = JSON.stringify({
                         event: 'conversation.message.delta',
                         message: { content: content, type: 'answer' }
                     });
                     controller.enqueue(encoder.encode(`data: ${cleanData}\n\n`));
                  }

                } catch (e) {
                  // JSON 解析失败不用管
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
