// api/chat.js (纯净版 - 屏蔽思考过程)
export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    const { query, bot_id } = await req.json();
    const COZE_API_KEY = process.env.COZE_API_KEY;

    const response = await fetch('https://api.coze.cn/v3/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bot_id: bot_id,
        user_id: "web_user",
        stream: true,
        auto_save_history: true,
        additional_messages: [{ role: "user", content: query, content_type: "text" }]
      }),
    });

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body.getReader();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (line.startsWith('data:')) {
              try {
                const jsonStr = line.slice(5).trim();
                if (!jsonStr) continue;
                
                const data = JSON.parse(jsonStr);
                
                // 🟢 核心过滤器：只放行 'answer' 类型的消息 🟢
                // 这样就屏蔽了 function_call (数据库操作) 和 verbose (思考过程)
                if (data.event === 'conversation.message.delta' && data.type === 'answer') {
                   const content = data.content;
                   
                   // 二次保险：过滤掉可能残留的卡片代码
                   if (content.includes('card_type')) continue;

                   const msg = JSON.stringify({
                       event: 'conversation.message.delta',
                       message: { content: content }
                   });
                   controller.enqueue(encoder.encode(`data: ${msg}\n\n`));
                }
              } catch (e) {}
            }
          }
        }
        controller.close();
      }
    });

    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
