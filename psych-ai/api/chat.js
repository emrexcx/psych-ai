// api/chat.js (后端清洗 + 稳健流式版)
export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    const { query, bot_id, conversation_id } = await req.json();
    const COZE_API_TOKEN = process.env.COZE_API_TOKEN;

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
        // 关键：带上 conversation_id 保持上下文
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
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // 保留未完成的行

            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('data:')) {
                const jsonStr = trimmed.substring(5).trim();
                if (jsonStr === '[DONE]') continue;

                try {
                  const data = JSON.parse(jsonStr);

                  // 🛡️🛡️🛡️ 后端清洗核心 🛡️🛡️🛡️
                  
                  // 1. 只通过 delta (正在打字)，拦截 completed (防止重复)
                  if (data.event === 'conversation.message.delta' && data.message) {
                    
                    // 2. 拦截 follow_up (追问) 和 verbose (冗余)
                    if (data.message.type === 'follow_up' || data.message.type === 'verbose') continue;

                    let content = data.message.content;
                    if (!content) continue;

                    // 3. 智能提取图片 (针对多模态数据)
                    // 如果内容是 JSON 数组 (比如 [{"type":"image"...}])
                    if (content.startsWith('[')) {
                        try {
                            const items = JSON.parse(content);
                            let parsed = "";
                            items.forEach(item => {
                                if (item.type === 'text') parsed += item.text;
                                if (item.type === 'image') parsed += `\n![Image](${item.file_url})\n`;
                            });
                            content = parsed;
                        } catch(e) {}
                    }

                    // 4. 拦截垃圾代码日志
                    if (content.trim().startsWith('{') || 
                        content.includes('msg_type') || 
                        content.includes('FunctionCall')) {
                        continue;
                    }

                    // ✅ 发送清洗后的纯文本给前端
                    // 使用自定义分隔符，防止 JSON 格式错误
                    controller.enqueue(encoder.encode(content));
                  }
                } catch (e) {
                  // 忽略解析错误
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
        'Content-Type': 'text/plain; charset=utf-8', // 发送纯文本
        'Cache-Control': 'no-cache' 
      } 
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
