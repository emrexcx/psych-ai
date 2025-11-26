// api/chat.js
export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const { query, bot_id, conversation_id } = await req.json();
    const COZE_API_KEY = process.env.COZE_API_KEY;

    if (!COZE_API_KEY) {
        return new Response(JSON.stringify({ error: "API Key 未配置" }), { status: 500 });
    }

    // --- 核心修改：使用 V3 接口格式 ---
    const response = await fetch('https://api.coze.cn/v3/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bot_id: bot_id,
        user_id: "web_user_001", // V3 需要 user_id
        stream: true,
        auto_save_history: true, // 自动保存历史
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
        const errText = await response.text();
        return new Response(JSON.stringify({ error: errText }), { status: response.status });
    }

    // V3 的流处理逻辑
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
                
                // V3 的核心回复在 conversation.message.delta 事件里
                if (data.event === 'conversation.message.delta' && data.type === 'answer') {
                   // 将内容重新打包成 SSE 格式发给前端
                   const text = data.content;
                   // 为了兼容你的前端代码，我们要模拟成 V2 的格式发回去，或者直接发内容
                   // 这里我们直接构造一个简单的 SSE 消息给前端
                   const frontendMsg = JSON.stringify({
                       event: 'conversation.message.delta',
                       message: { content: text }
                   });
                   controller.enqueue(encoder.encode(`data: ${frontendMsg}\n\n`));
                }
              } catch (e) {}
            }
          }
        }
        controller.close();
      }
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}