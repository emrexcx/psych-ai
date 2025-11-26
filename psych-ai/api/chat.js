// ✅ api/chat.js (基础稳健版)
export const config = { runtime: 'edge' };

export default async function handler(req) {
  try {
    const { query, bot_id } = await req.json();
    const response = await fetch('https://api.coze.cn/v3/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.COZE_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        bot_id: bot_id,
        user_id: "user",
        stream: true,
        auto_save_history: true,
        additional_messages: [{ role: "user", content: query, content_type: "text" }]
      })
    });
    return new Response(response.body, { headers: { 'Content-Type': 'text/event-stream' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
