// api/chat.js —— 修复了长数据断裂的问题
export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    // 1. 接收前端传来的参数，包括对话 ID
    const { query, bot_id, conversation_id } = await req.json();
    const COZE_API_TOKEN = process.env.COZE_API_TOKEN;

    // 2. 发送请求给 Coze
    const response = await fetch('https://api.coze.cn/v3/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bot_id: bot_id,
        user_id: "web_user",
        stream: true,
        auto_save_history: true,
        // 如果有 conversation_id 就带上，保持上下文
        ...(conversation_id && { conversation_id }),
        additional_messages: [{ role: "user", content: query, content_type: "text" }]
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Coze API Error:", response.status, errorText);
      return new Response(JSON.stringify({ error: `Coze API Error: ${response.status}` }), { status: response.status });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // 3. 创建流式响应
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body.getReader();
        let buffer = ''; // 🟢 “胶水”缓存区

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // 🟢 把新收到的数据粘到缓存区后面
            buffer += decoder.decode(value, { stream: true });
            // 🟢 按换行符切分数据
            const lines = buffer.split('\n');
            // 🟢 把最后一行可能是半截的数据留着，放回缓存区等待下一次拼接
            buffer = lines.pop(); 

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;

              // 只转发以 data: 开头的数据行
              if (trimmedLine.startsWith('data:')) {
                controller.enqueue(encoder.encode(`${trimmedLine}\n\n`));
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
    console.error("Handler Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
