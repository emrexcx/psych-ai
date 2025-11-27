// api/chat.js
export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    const { query, bot_id } = await req.json(); // 移除未使用的 conversation_id
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
                
                // 监听 delta (流式文本) 和 completed (完整消息/生图结果)
                if (['conversation.message.delta', 'conversation.message.completed'].includes(currentEvent)) {
                  try {
                    const data = JSON.parse(dataStr);
                    
                    // 1. 获取原始 content
                    let content = data.content || data.message?.content;
                    const contentType = data.content_type || data.message?.content_type;

                    // 🟢 核心修复：处理 "object_string" 或 JSON 格式的内容
                    // 如果 content 是字符串但看起来像 JSON，或者明确标记为 object_string
                    if (content && typeof content === 'string' && (contentType === 'object_string' || content.trim().startsWith('{'))) {
                      try {
                        // 尝试二次解析 (Unwrap)
                        const parsedContent = JSON.parse(content);
                        // 对应你截图中的结构：parsedContent.data 才是真正的文本
                        if (parsedContent.data) {
                          content = parsedContent.data;
                        }
                      } catch (e) {
                        // 如果解析失败，说明它可能只是普通的包含大括号的文本，保持原样
                        console.log("Not a JSON string, keeping original content");
                      }
                    }

                    // 2. 发送处理后的内容
                    if (content) {
                      const msg = JSON.stringify({
                        event: 'conversation.message.delta',
                        message: { 
                          content: content,
                          type: 'answer'
                        }
                      });
                      controller.enqueue(encoder.encode(`data: ${msg}\n\n`));
                    }
                  } catch (e) {
                     // 忽略非核心错误
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
