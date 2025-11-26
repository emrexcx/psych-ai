export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    const { query, bot_id } = await req.json();

    // 🔴🔴🔴 请再次填入你的真实 Key (保留引号) 🔴🔴🔴
    const COZE_API_KEY = 'pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

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
        const errText = await response.text();
        return new Response(JSON.stringify({ error: "Coze报错", details: errText }), { status: response.status });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              // 🟢 只要是 SSE 数据行，就尝试解析
              if (line.startsWith('data:')) {
                try {
                  const jsonStr = line.slice(5).trim();
                  if (!jsonStr) continue;
                  const data = JSON.parse(jsonStr);

                  // 🟢 宽松策略：只要有 content 就发送，不管 type 是什么
                  // 这样能防止 Bot 在“思考”或“查库”时前端以为断连了
                  let content = "";
                  if (data.content) content = data.content;
                  else if (data.message && data.message.content) content = data.message.content;

                  if (content) {
                     // 过滤掉纯技术代码
                     if (content.includes('card_type') || content.includes('template_url')) continue;

                     const msg = JSON.stringify({
                         event: 'conversation.message.delta',
                         message: { content: content }
                     });
                     controller.enqueue(encoder.encode(`data: ${msg}\n\n`));
                  }
                } catch (e) {}
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
    return new Response(JSON.stringify({ error: "代码错误", details: error.message }), { status: 500 });
  }
}
