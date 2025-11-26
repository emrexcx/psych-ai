// ✅ 宽容模式：只要不是 JSON 代码，什么类型都显示
        async function simulateCozeAPIStream(agentId, prompt, onChunk) {
            const agent = agents.find(a => a.id === agentId);
            console.log(`[${agent.name}] 正在连接...`);

            try {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        query: prompt,
                        bot_id: agent.botId,
                        conversation_id: "debate_" + Date.now()
                    })
                });

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop();

                    for (const line of lines) {
                        if (line.startsWith('data:') && line.length > 5) {
                            try {
                                const rawJson = line.slice(5).trim();
                                if (rawJson === '[DONE]') continue;

                                const data = JSON.parse(rawJson);
                                
                                // 🔍 调试：在控制台打印每一条消息的类型，看看它到底是个啥
                                // if (data.message && data.message.type) {
                                //    console.log("收到类型:", data.message.type, "内容:", data.message.content);
                                // }

                                // 🟢 修改逻辑：
                                // 1. 只要有 content (内容)
                                // 2. 且 event 是 message.delta (增量消息)
                                // 3. 就不管 type 是什么了（删掉了 type==='answer' 的限制）
                                if (
                                    data.event === 'conversation.message.delta' && 
                                    data.message && 
                                    data.message.content 
                                ) {
                                    const content = data.message.content;
                                    
                                    // 🛑 唯一的过滤器：拦截 JSON 格式的“机器日志”
                                    // 如果这句话是以 "{" 开头，且包含 "msg_type"，那它肯定是后台日志，扔掉！
                                    // 否则，统统认为是人话，显示出来！
                                    if (content.trim().startsWith('{') && content.includes('"msg_type"')) {
                                        continue; 
                                    }

                                    // 显示上屏
                                    onChunk(content);
                                }
                            } catch (e) {}
                        }
                    }
                }
            } catch (err) {
                console.error("Stream Error:", err);
                onChunk(" **[连接中断]** ");
            }
        }
    })();

    return new Response(readable, {
      headers: { 'Content-Type': 'text/event-stream' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
}


