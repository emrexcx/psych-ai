// api/chat.js (防重复 + 防乱码 + 稳健解析版)
export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    const { query, bot_id, conversation_id } = await req.json();
    const COZE_API_KEY = process.env.COZE_API_TOKEN;

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
        // 如果有 conversation_id 就传回去，保持上下文
        ...(conversation_id && { conversation_id }),
        additional_messages: [{ role: "user", content: query, content_type: "text" }]
      }),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Coze API Error" }), { status: response.status });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body.getReader();
        let buffer = ""; // 🟢 1. 缓冲区：专门处理跨包数据

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // 🟢 2. 解码并追加到缓冲区
            buffer += decoder.decode(value, { stream: true });
            
            // 🟢 3. 按双换行符分割 SSE 消息 (Coze 的 SSE 通常以 \n\n 分隔)
            const parts = buffer.split('\n\n');
            
            // 保留最后一个可能不完整的部分在缓冲区中，处理剩下的
            buffer = parts.pop(); 

            for (const part of parts) {
              const lines = part.split('\n');
              let eventType = null;
              let dataStr = null;

              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('event:')) {
                  eventType = trimmed.substring(6).trim();
                } else if (trimmed.startsWith('data:')) {
                  dataStr = trimmed.substring(5).trim();
                }
              }

              // 🟢 4. 核心过滤逻辑
              // 只处理 data 存在且 event 是 delta 的情况
              if (dataStr && eventType === 'conversation.message.delta') {
                try {
                  const data = JSON.parse(dataStr);
                  
                  // 再次确认是 answer 类型 (避免 function_call 等混入)
                  if (data.type === 'answer' && data.content) {
                     const msg = JSON.stringify({
                         event: 'conversation.message.delta',
                         message: { content: data.content }
                     });
                     controller.enqueue(encoder.encode(`data: ${msg}\n\n`));
                  }
                } catch (e) {
                  // JSON 解析失败通常是因为数据不完整，等待下一个 chunk
                }
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
