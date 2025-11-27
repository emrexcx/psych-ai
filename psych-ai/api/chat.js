// api/chat.js (防重复 + 防乱码 + 支持生图)
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
        // 关键：把 conversation_id 传回去，保证上下文连贯（否则Bot记不住之前画了啥）
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
        let buffer = ""; // 缓存池，专门解决乱码
        let currentEvent = ""; // 记录当前事件类型

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // 1. 解码并追加到缓冲区
            buffer += decoder.decode(value, { stream: true });
            
            // 2. 按行处理 (Coze 的 SSE 数据以换行符分隔)
            const lines = buffer.split('\n');
            // 保留最后一行（可能是不完整的），放回 buffer 等下次拼接
            buffer = lines.pop(); 

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine) continue; // 跳过空行

              // 3. 捕捉事件类型
              if (trimmedLine.startsWith('event:')) {
                currentEvent = trimmedLine.replace('event:', '').trim();
                continue;
              }

              // 4. 捕捉数据内容
              if (trimmedLine.startsWith('data:')) {
                const dataStr = trimmedLine.replace('data:', '').trim();
                
                // 🛑 核心过滤：只允许 delta (正在打字) 通过
                // 这样就彻底屏蔽了 completed (总结)，解决了“说两遍”的问题
                if (currentEvent === 'conversation.message.delta') {
                  try {
                    const data = JSON.parse(dataStr);
                    
                    // 提取内容 (兼容普通文本和多模态消息)
                    const content = data.content || data.message?.content;
                    
                    if (content) {
                      // 🔍 这里不需要过滤太多，交给前端去渲染
                      // 只要有内容，就打包发给前端
                      const msg = JSON.stringify({
                        event: 'conversation.message.delta',
                        message: { content: content, type: 'answer' }
                      });
                      controller.enqueue(encoder.encode(`data: ${msg}\n\n`));
                    }
                  } catch (e) {
                    // 忽略 JSON 解析错误（通常是 [DONE] 信号）
                  }
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
        } 
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
