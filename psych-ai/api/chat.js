// api/chat.js (万能解析版)
export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    const { query, bot_id, conversation_id } = await req.json();
    const COZE_API_KEY = process.env.COZE_API_KEY;

    // 发送 V3 请求
    const response = await fetch('https://api.coze.cn/v3/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bot_id: bot_id,
        user_id: "web_user_v3",
        stream: true,
        auto_save_history: true,
        additional_messages: [{ role: "user", content: query, content_type: "text" }]
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return new Response(JSON.stringify({ error: err }), { status: response.status });
    }

    // --- 暴力流式转发 (不进行复杂解析，直接寻找 content) ---
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
            
            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;
            
            // 按行分割
            const lines = buffer.split('\n');
            buffer = lines.pop(); // 保留最后不完整的一行

            for (const line of lines) {
              // 只要行里包含 "content":，我们就尝试提取它
              // 这种方式不依赖 event: 头，容错率极高
              if (line.includes('"content":')) {
                try {
                  // 去掉前面的 data: 或 event: 等杂质，尝试找到 JSON 部分
                  const jsonStartIndex = line.indexOf('{');
                  if (jsonStartIndex !== -1) {
                    const jsonStr = line.slice(jsonStartIndex);
                    const data = JSON.parse(jsonStr);
                    
                    // 只要有 content 且不是空的，就发给前端
                    if (data.content && data.type === 'answer') {
                       const msg = JSON.stringify({
                           event: 'conversation.message.delta',
                           message: { content: data.content }
                       });
                       controller.enqueue(encoder.encode(`data: ${msg}\n\n`));
                    }
                  }
                } catch (e) {
                  // 忽略解析错误，继续下一行
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
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
