// api/chat.js (终极硬编码版 - 专治各种不通)
export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  // 1. 允许跨域 (防止本地调试报错)
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    const { query, bot_id } = await req.json();

    // 🔴🔴🔴 请在这里直接填入你的 API Key！不要留空！🔴🔴🔴
    // 例如: const COZE_API_KEY = 'pat_123456789...';
    const COZE_API_KEY = 'pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; 

    // 检查一下是不是忘了填
    if (COZE_API_KEY.includes('xxxx')) {
        return new Response(JSON.stringify({ error: "请在 api/chat.js 代码里填入真实的 API Key！" }), { status: 500 });
    }

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
      return new Response(JSON.stringify({ error: "Coze API 报错", details: errText }), { status: response.status });
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
              if (line.startsWith('data:')) {
                try {
                  const jsonStr = line.slice(5).trim();
                  if (!jsonStr) continue;
                  const data = JSON.parse(jsonStr);
                  
                  // 宽松过滤：只要是 delta 消息且有 content 就发
                  if (data.event === 'conversation.message.delta' && data.message?.content) {
                     const content = data.message.content;
                     // 过滤卡片代码
                     if (content.includes('card_type')) continue;

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
    return new Response(JSON.stringify({ error: "代码运行错误", details: error.message }), { status: 500 });
  }
}
