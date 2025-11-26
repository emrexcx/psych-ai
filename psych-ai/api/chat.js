export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    const { query, bot_id } = await req.json();
    const COZE_API_KEY = process.env.COZE_API_KEY;

    // 1. 发起请求
    const response = await fetch('https://api.coze.cn/v3/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bot_id: bot_id,
        user_id: "web_user_" + Date.now(),
        stream: true,
        auto_save_history: true,
        additional_messages: [{ role: "user", content: query, content_type: "text" }]
      }),
    });

    // 2. 建立直通管道
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const reader = response.body.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // 3. 边读边发 (不做任何 JSON 解析，直接转发)
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            // 只要行里包含 "content"，我们就尝试提取
            if (line.includes('"content"')) {
               // 简单粗暴提取 content 内容
               // 这是一个非常宽松的正则，只要是有 content":"... 这种结构的都抓
               const match = line.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/);
               if (match && match[1]) {
                   let content = match[1];
                   // 手动还原转义字符 (比如 \n 变回换行)
                   content = JSON.parse(`"${content}"`); 
                   
                   // 构造 SSE 消息发给前端
                   const msg = JSON.stringify({
                       event: 'conversation.message.delta',
                       message: { content: content }
                   });
                   await writer.write(encoder.encode(`data: ${msg}\n\n`));
               }
            }
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: { 'Content-Type': 'text/event-stream' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
}

