export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  // 1. 安全检查
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    const { query, bot_id } = await req.json();
    const COZE_API_KEY = process.env.COZE_API_KEY;

    if (!COZE_API_KEY) {
      return new Response(JSON.stringify({ error: "API Key 未配置" }), { status: 500 });
    }

    // 2. 发送 Coze V3 请求
    const response = await fetch('https://api.coze.cn/v3/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bot_id: bot_id,
        user_id: "web_user_" + Date.now(), // 随机用户ID，防止串台
        stream: true,
        auto_save_history: true,
        additional_messages: [
          {
            role: "user",
            content: query,
            content_type: "text"
          }
        ]
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return new Response(JSON.stringify({ error: err }), { status: response.status });
    }

    // 3. 智能流式处理
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body.getReader();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // 保留末尾不完整片段

            for (const line of lines) {
              if (line.trim().startsWith('data:')) {
                try {
                  // 去掉 'data:' 前缀
                  const jsonStr = line.replace(/^data:\s*/, '').trim();
                  if (!jsonStr) continue;
                  
                  const data = JSON.parse(jsonStr);

                  // 🟢 核心过滤区：只放行真正的回答 🟢
                  // event: conversation.message.delta  -> 代表正在打字
                  // type: answer                       -> 代表是Bot的回答(不是工具/不是建议)
                  if (data.event === 'conversation.message.delta' && data.type === 'answer') {
                     const content = data.content;
                     
                     // 🧹 垃圾清理：如果包含卡片代码，直接跳过
                     if (content.includes('card_type') || content.includes('template_url')) {
                         continue; 
                     }

                     // 📦 打包发给前端
                     const msg = JSON.stringify({
                         event: 'conversation.message.delta',
                         message: { content: content }
                     });
                     controller.enqueue(encoder.encode(`data: ${msg}\n\n`));
                  }
                  
                  // 注：这里故意不处理 completed 事件，防止重复！
                  
                } catch (e) { /* 忽略非 JSON 行 */ }
              }
            }
          }
        } catch (err) {
          console.error("Stream Error:", err);
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
