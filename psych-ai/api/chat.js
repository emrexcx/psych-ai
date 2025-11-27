// api/chat.js (修复重复显示版)
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
        let currentEvent = ''; // 🟢 1. 新增变量：记录当前事件类型
        
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine) continue;

              // 🟢 2. 捕捉 event 类型
              if (trimmedLine.startsWith('event:')) {
                currentEvent = trimmedLine.replace('event:', '').trim();
                continue;
              }

              // 🟢 3. 只有当事件是 'delta' 时才提取 content
              // 这样就屏蔽了 'conversation.message.completed' 造成的重复
              if (currentEvent === 'conversation.message.delta' && line.includes('"content"')) {
                try {
                  const jsonStr = line.substring(line.indexOf('{'));
                  const data = JSON.parse(jsonStr);
                  
                  if (data.content || data.message?.content) {
                     const text = data.content || data.message.content;
                     // 过滤掉纯代码或其他非文本类型
                     if (text.includes('card_type')) continue;

                     const msg = JSON.stringify({
                         event: 'conversation.message.delta',
                         message: { content: text }
                     });
                     controller.enqueue(encoder.encode(`data: ${msg}\n\n`));
                  }
                } catch (e) {
                   // 忽略解析错误
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
