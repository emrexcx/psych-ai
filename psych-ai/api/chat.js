// api/chat.js (非流式稳定版)
export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    const { query, bot_id, conversation_id } = await req.json();
    const COZE_API_KEY = process.env.COZE_API_KEY;

    // 1. 发送请求给 Coze (内部依然用流式，因为这样获取数据最稳，不用写轮询逻辑)
    const response = await fetch('https://api.coze.cn/v3/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bot_id: bot_id,
        user_id: "web_user",
        stream: true, // 保持 true，我们在后端拼好再发给前端
        auto_save_history: true,
        // ⚠️ 关键修复：如果你之前觉得“全部没了”，可能是因为没把 conversation_id 传回去
        ...(conversation_id && { conversation_id }), 
        additional_messages: [{ role: "user", content: query, content_type: "text" }]
      }),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Coze API Error" }), { status: response.status });
    }

    // 2. 接收流并拼接所有内容
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = ""; // 用于存放最终的完整回复
    let finalConversationId = conversation_id; // 尝试抓取新的会话ID

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.includes('"content"')) {
            try {
              // 提取 JSON
              const jsonStr = line.substring(line.indexOf('{'));
              const data = JSON.parse(jsonStr);

              // 尝试抓取 conversation_id (防止第一句没ID导致上下文丢失)
              if (data.conversation_id) {
                finalConversationId = data.conversation_id;
              }

              // 拼接内容
              if (data.content || data.message?.content) {
                const text = data.content || data.message.content;
                // 过滤掉非内容的系统指令
                if (!text.includes('card_type') && data.type !== 'follow_up') {
                   fullContent += text;
                }
              }
            } catch (e) {
              // 忽略解析错误，继续处理下一行
            }
          }
        }
      }
    } catch (err) {
      console.error("Stream parsing error:", err);
    }

    // 3. 最终一次性返回标准 JSON (前端不再需要处理流)
    return new Response(JSON.stringify({
      content: fullContent,
      conversation_id: finalConversationId // 把 ID 返还给前端，保证下次对话能接上
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
