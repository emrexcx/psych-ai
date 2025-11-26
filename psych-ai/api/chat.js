// api/chat.js (Coze V3 版)
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

    // --- 发送 V3 格式请求 ---
    const response = await fetch('https://api.coze.cn/v3/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bot_id: bot_id,
        user_id: "web_user_001", 
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
        const errText = await response.text();
        return new Response(JSON.stringify({ error: errText }), { status: response.status });
    }

    // --- 处理 V3 流并转发 ---
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
                
                // 捕捉 V3 的回复内容
                if (data.event === 'conversation.message.delta' && data.type === 'answer') {
                   const text = data.content;
                   // 包装成前端能看懂的格式
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
