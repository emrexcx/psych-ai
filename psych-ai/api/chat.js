// api/chat.js
export const config = { runtime: "edge" };

export default async function handler(req) {
  if (req.method !== "POST")
    return new Response("Method Not Allowed", { status: 405 });

  try {
    const { query, bot_id, conversation_id } = await req.json();

    const response = await fetch("https://api.coze.cn/v3/chat", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.COZE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        bot_id,
        user_id: "web_user",
        stream: true,
        conversation_id,
        additional_messages: [
          { role: "user", content: query, content_type: "text" },
        ],
      }),
    });

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body.getReader();
        let buffer = "";
        let currentEvent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            if (line.startsWith("event:")) {
              currentEvent = line.replace("event:", "").trim();
              continue;
            }

            if (!line.startsWith("data:")) continue;
            const jsonStr = line.replace("data:", "").trim();

            try {
              const data = JSON.parse(jsonStr);
              const msg = data.message || data;

              const content = msg.content;
              const contentType = msg.content_type;

              // ========== 普通文本流式 ==========
              if (
                currentEvent === "conversation.message.delta" &&
                contentType === "text"
              ) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      event: "delta",
                      content,
                    })}\n\n`
                  )
                );
              }

              // ========== object_string（文件/图片） ==========
              if (
                currentEvent === "conversation.message.completed" &&
                contentType === "object_string"
              ) {
                try {
                  const parsed = JSON.parse(content);

                  // markdown 内容
                  if (parsed.data) {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({
                          event: "delta",
                          content: parsed.data,
                        })}\n\n`
                      )
                    );
                  }

                  // 文件（包含 URLs）
                  if (parsed.files && Array.isArray(parsed.files)) {
                    parsed.files.forEach((f) => {
                      controller.enqueue(
                        encoder.encode(
                          `data: ${JSON.stringify({
                            event: "file",
                            url: f.url,
                            mime_type: f.mime_type,
                            name: f.name,
                          })}\n\n`
                        )
                      );
                    });
                  }
                } catch (err) {
                  console.log("解析 object_string 失败", err);
                }
              }
            } catch {}
          }
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
