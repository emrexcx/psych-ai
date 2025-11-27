// api/chat.js (Buffer防乱码 + 智能兼容版)
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
        // 关键：传回 conversation_id 以保持上下文
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
        let buffer = ''; // 缓存池
        let currentEvent = ''; 

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // 保留未完成的行

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine) continue;

              if (trimmedLine.startsWith('event:')) {
                currentEvent = trimmedLine.replace('event:', '').trim();
                continue;
              }

              if (trimmedLine.startsWith('data:')) {
                const dataStr = trimmedLine.replace('data:', '').trim();
                
                // 🛑 核心过滤：只允许 delta (正在打字)
                if (currentEvent === 'conversation.message.delta') {
                  try {
                    const data = JSON.parse(dataStr);
                    
                    // 🔍 提取内容 (兼容普通文本和多模态)
                    let content = data.content || data.message?.content;
                    
                    // 🔍 额外检查：必须是 answer 类型 (防止工具调用日志泄露)
                    // 或者内容包含图片链接 (有些图片可能不带 type: answer)
                    const isAnswer = data.type === 'answer' || data.message?.type === 'answer';
                    const hasImage = typeof content === 'string' && (content.includes('http') || content.startsWith('['));

                    if ((isAnswer || hasImage) && content) {
                      // 过滤掉明显的非内容指令
                      if (typeof content === 'string' && content.includes('card_type')) continue;

                      const msg = JSON.stringify({
                        event: 'conversation.message.delta',
                        message: { content: content, type: 'answer' } // 统一包装为 answer 发给前端
                      });
                      controller.enqueue(encoder.encode(`data: ${msg}\n\n`));
                    }
                  } catch (e) {
                    // 忽略解析错误
                  }
                }
              }
            }
          }
        } catch (err) {
          console.error(err);
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
