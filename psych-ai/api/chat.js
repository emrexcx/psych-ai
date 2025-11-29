// api/chat.js
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

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Coze API Error" }), { status: response.status });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body.getReader();
        let currentEvent = '';
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine) continue;

              if (trimmedLine.startsWith('event:')) {
                currentEvent = trimmedLine.replace('event:', '').trim();
                continue;
              }

              if (trimmedLine.startsWith('data:')) {
                const dataStr = trimmedLine.replace('data:', '').trim();

                try {
                  const data = JSON.parse(dataStr);
                  
                  // 获取内容和类型
                  const content = data.content || data.message?.content;
                  const contentType = data.content_type || data.message?.content_type;
                  const type = data.type || data.message?.type;

                  // 🟢 关键判断：是否是需要特殊处理的 JSON 字符串 (工作流/插件结果)
                  // 依据：contentType 是 object_string，或者内容明显是 JSON 格式
                  const isObjectString = contentType === 'object_string' || (typeof content === 'string' && content.trim().startsWith('{"content_type"'));

                  // ================= 处理逻辑 =================

                  // 1. 如果是 delta 事件 (流式传输)
                  if (currentEvent === 'conversation.message.delta') {
                    // 🛑 核心修改：如果是 object_string，直接忽略 delta，防止输出乱码 JSON
                    if (isObjectString) {
                      continue; 
                    }
                    
                    // 普通文本：正常流式发送
                    if (content) {
                      const msg = JSON.stringify({
                        event: 'conversation.message.delta',
                        message: { content, type }
                      });
                      controller.enqueue(encoder.encode(`data: ${msg}\n\n`));
                    }
                  }

                  // 2. 如果是 completed 事件 (完整消息)
                  else if (currentEvent === 'conversation.message.completed') {
                    // ✅ 核心修改：只有是 object_string 时，才在 completed 里处理
                    // 这样避免了普通文本重复输出，同时确保图片能被解析
                    if (isObjectString && content) {
                      try {
                        const parsedContent = JSON.parse(content);
                        // 提取真正的 markdown (对应你截图里的 .data 字段)
                        const realContent = parsedContent.data || content;
                        
                        // 将提取出的 Markdown 作为一条 delta 发送给前端
                        const msg = JSON.stringify({
                          event: 'conversation.message.delta',
                          message: { content: realContent, type: 'answer' }
                        });
                        controller.enqueue(encoder.encode(`data: ${msg}\n\n`));
                      } catch (e) {
                        // 如果解析失败，兜底发送原始内容
                        // console.error(e);
                      }
                    }
                  }

                } catch (e) {
                  // JSON parse error usually implies incomplete chunk, ignore
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
