// api/chat.js
export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    const { query, bot_id, conversation_id } = await req.json();
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

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Coze API Error" }), { status: response.status });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body.getReader();
        let currentEvent = ''; 
        let buffer = ''; // 🟢 1. 新增：缓存池，用于拼接被切断的数据

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // 🟢 2. 解码并追加到 buffer，而不是直接处理 chunk
            buffer += decoder.decode(value, { stream: true });
            
            // 🟢 3. 按换行符切割，但保留最后一个可能不完整的部分
            const lines = buffer.split('\n');
            buffer = lines.pop(); // 将数组最后一行（可能不完整）拿出来放回 buffer，等待下一个 chunk

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine) continue;

              // 捕捉 event 类型
              if (trimmedLine.startsWith('event:')) {
                currentEvent = trimmedLine.replace('event:', '').trim();
                continue;
              }

              // 处理 data 数据
              if (trimmedLine.startsWith('data:')) {
                // Coze 返回的数据有时是 "data: {...}"
                const dataStr = trimmedLine.replace('data:', '').trim();
                
                // 如果是 conversation.message.delta 且包含内容
                if (currentEvent === 'conversation.message.delta') {
                  try {
                    const data = JSON.parse(dataStr);
                    
                    // 兼容 content 在根节点或 message 节点的情况
                    const content = data.content || data.message?.content;
                    
                    if (content && !content.includes('card_type')) {
                      const msg = JSON.stringify({
                        event: 'conversation.message.delta',
                        message: { content: content }
                      });
                      controller.enqueue(encoder.encode(`data: ${msg}\n\n`));
                    }
                  } catch (e) {
                    // JSON 解析失败通常是因为数据不完整，但在有了 buffer 机制后，这种情况会极少发生
                    // console.error("JSON Parse Error:", e);
                  }
                }
              }
            }
          }
        } catch (err) {
          console.error("Stream Error:", err);
          controller.error(err);
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
