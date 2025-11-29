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

                  const content = data.content || data.message?.content;
                  const contentType = data.content_type || data.message?.content_type;
                  const type = data.type || data.message?.type;

                  const isObjectString =
                    contentType === 'object_string' ||
                    (typeof content === 'string' && content.trim().startsWith('{"content_type"'));

                  // =============== delta 事件 ===============
                  if (currentEvent === 'conversation.message.delta') {

                    if (isObjectString) {
                      continue;
                    }

                    if (content) {
                      const msg = JSON.stringify({
                        event: 'conversation.message.delta',
                        message: { content, type }
                      });
                      controller.enqueue(encoder.encode(`data: ${msg}\n\n`));
                    }
                  }

                  // =============== completed 事件 ===============
                  else if (currentEvent === 'conversation.message.completed') {

                    if (isObjectString && content) {
                      try {
                        const parsedContent = JSON.parse(content);

                        // ===== 1. 发送 markdown 内容 =====
                        const realContent = parsedContent.data || content;

                        const msg = JSON.stringify({
                          event: 'conversation.message.delta',
                          message: { content: realContent, type: 'answer' }
                        });
                        controller.enqueue(encoder.encode(`data: ${msg}\n\n`));

                        // ===== 2. 如果有文件，则逐个发送 =====
                        if (Array.isArray(parsedContent.files)) {
                          for (const file of parsedContent.files) {
                            const fileMsg = JSON.stringify({
                              event: 'conversation.message.delta',
                              message: {
                                type: "file",
                                url: file.url,
                                mime_type: file.mime_type,
                                name: file.name
                              }
                            });

                            controller.enqueue(encoder.encode(`data: ${fileMsg}\n\n`));
                          }
                        }

                      } catch (e) {
                        // ignore parse error
                      }
                    }
                  }

                } catch (e) { /* ignore json error */ }
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
