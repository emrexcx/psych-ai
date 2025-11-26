// api/chat.js (暴力直通版 - 保证有数据！)
export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  try {
    const { query, bot_id } = await req.json();
    
    // 直接发请求，不做任何花哨的处理
    const response = await fetch('https://api.coze.cn/v3/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.COZE_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        bot_id: bot_id,
        user_id: "web_user",
        stream: true,
        auto_save_history: true,
        additional_messages: [{ role: "user", content: query, content_type: "text" }]
      })
    });

    // 把 Coze 的回复直接甩给前端
    return new Response(response.body, {
      headers: { 'Content-Type': 'text/event-stream' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
