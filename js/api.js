async function fetchModels() {
    if (!DOM.apiKeyInput.value.trim()) return showToast("请先填写 API Key");
    const fetchBtn = DOM.settingsContainer.querySelector('.btn-outline');
    const origText = fetchBtn.textContent;
    fetchBtn.textContent = '加载中...';
    fetchBtn.style.opacity = '0.5';
    try {
        DOM.modelSelect.innerHTML = '<option value="">加载中...</option>';
        refreshCustomSelect(DOM.modelSelect);
        const res = await fetch(`${API_BASE}/models`, { headers: { 'Authorization': `Bearer ${DOM.apiKeyInput.value.trim()}` } });
        const data = await res.json();
        if (data && data.data) {
            DOM.modelSelect.innerHTML = ''; DOM.titleModelSelect.innerHTML = '<option value="">跟随对话模型</option>';
            data.data.forEach(m => { DOM.modelSelect.add(new Option(m.id, m.id)); DOM.titleModelSelect.add(new Option(m.id, m.id)); });
            if (state.selectedModel && data.data.find(m => m.id === state.selectedModel)) DOM.modelSelect.value = state.selectedModel;
            else { state.selectedModel = data.data[0].id; saveSettings(); }
            if (state.titleModel && data.data.find(m => m.id === state.titleModel)) DOM.titleModelSelect.value = state.titleModel;
            refreshAllCustomSelects();
            showToast("模型列表获取成功！");
        }
    } catch (error) {
        DOM.modelSelect.innerHTML = '<option value="">获取失败，点击重试</option>';
        refreshCustomSelect(DOM.modelSelect);
    } finally {
        fetchBtn.textContent = origText;
        fetchBtn.style.opacity = '1';
    }
}

async function executeChatRequest(currentChat, preparedMessages) {
    abortController = new AbortController();
    updateSendButton(true);
    updateTrimIndicator();
    DOM.loadingIndicator.style.display = 'block';
    if (autoScroll) scrollToBottom();

    let apiMessages;
    if (preparedMessages && preparedMessages.length > 0) {
        apiMessages = preparedMessages.map(m => {
            if (m.role === 'assistant') {
                let content = typeof m.content === 'string' ? m.content : '';
                content = content.replace(CLOSED_THINK_BLOCK_PATTERN_GLOBAL, '').trim();
                return { role: m.role, content };
            }
            if (m.role === 'user' && state.userPrefix) {
                let contentCopy = JSON.parse(JSON.stringify(m.content));
                if (typeof contentCopy === 'string') {
                    contentCopy = state.userPrefix + contentCopy;
                } else if (Array.isArray(contentCopy)) {
                    let textPart = contentCopy.find(c => c.type === 'text');
                    if (textPart) textPart.text = state.userPrefix + textPart.text;
                }
                return { role: m.role, content: contentCopy };
            }
            return { role: m.role, content: m.content };
        });
    } else {
        apiMessages = buildContextWithTrim(currentChat).messages.map(m => {
            if (m.role === 'assistant') {
                let content = typeof m.content === 'string' ? m.content : '';
                content = content.replace(CLOSED_THINK_BLOCK_PATTERN_GLOBAL, '').trim();
                return { role: m.role, content };
            }
            if (m.role === 'user' && state.userPrefix) {
                let contentCopy = JSON.parse(JSON.stringify(m.content));
                if (typeof contentCopy === 'string') {
                    contentCopy = state.userPrefix + contentCopy;
                } else if (Array.isArray(contentCopy)) {
                    let textPart = contentCopy.find(c => c.type === 'text');
                    if (textPart) textPart.text = state.userPrefix + textPart.text;
                }
                return { role: m.role, content: contentCopy };
            }
            return { role: m.role, content: m.content };
        });
    }

    const targetIndex = currentChat.messages.length;
    const botDomObj = createMessageDOM({ role: 'assistant', content: '' }, targetIndex, true);
    botDomObj.wrapper.querySelector('.message-actions').style.display = 'none';
    DOM.chatMessages.appendChild(botDomObj.wrapper);
    let streamThinkOpen = false;
    botDomObj.contentNode.addEventListener('pointerdown', (event) => {
        const summary = event.target.closest('.think-summary');
        if (!summary || !botDomObj.contentNode.contains(summary)) return;
        event.preventDefault();
        streamThinkOpen = !streamThinkOpen;
        const thinkBlock = summary.closest('.think-block');
        if (thinkBlock) thinkBlock.open = streamThinkOpen;
    });

    let _streamTimer = null;
    let _pendingStreamContent = '';
    let _thinkRenderedOnce = false;
    function scheduleStreamRender(content) {
        if (content === _pendingStreamContent) return;
        _pendingStreamContent = content;
        if (_streamTimer) return;
        if (document.visibilityState !== 'visible') {
            window.__streamFlush = () => {
                if (_pendingStreamContent && !_streamTimer) {
                    const content = _pendingStreamContent;
                    _pendingStreamContent = '';
                    scheduleStreamRender(content);
                }
            };
            return;
        }
        _streamTimer = setTimeout(() => {
            window.__streamFlush = null;
            _streamTimer = null;
            const c = _pendingStreamContent;
            _pendingStreamContent = '';
            const existingReply = botDomObj.contentNode.querySelector('.reply-content');
            const hasClosedThink = c && CLOSED_THINK_BLOCK_PATTERN.test(c);
        if (hasClosedThink && existingReply && _thinkRenderedOnce) {
            const replyContent = c.replace(CLOSED_THINK_BLOCK_PATTERN, '').trim();
            existingReply.innerHTML = renderMarkdownToHtml(replyContent) + '<span class="stream-cursor"></span>';
            if (replyContent) {
                if (shouldProcessMath(replyContent)) renderMath(existingReply);
                if (replyContent.includes('<pre') || replyContent.includes('```')) highlightCodeBlocks(existingReply);
            }
        } else {
            _thinkRenderedOnce = !!hasClosedThink;
            botDomObj.contentNode.innerHTML = renderContentWithThink(c, true);
            if (shouldProcessMath(c)) renderMath(botDomObj.contentNode);
            if (c && (c.includes('<pre') || c.includes('```'))) highlightCodeBlocks(botDomObj.contentNode);
            const nextThinkBlock = botDomObj.contentNode.querySelector('.think-block');
            if (nextThinkBlock) nextThinkBlock.open = streamThinkOpen;
        }
        // 流式光标：追加到内容末尾
        const cursorTarget = botDomObj.contentNode.querySelector('.reply-content') || botDomObj.contentNode;
        if (!cursorTarget.querySelector('.stream-cursor')) {
            cursorTarget.insertAdjacentHTML('beforeend', '<span class="stream-cursor"></span>');
        }
            if (autoScroll) scrollToBottom();
        }, 120);
    }

    let botReply = '';
    let reasoningBuffer = '';
    const maxRetries = 3;

    for (let retry = 0; retry <= maxRetries; retry++) {
        try {
            botReply = '';
            reasoningBuffer = '';
            DOM.loadingIndicator.innerHTML = retry > 0 ? `AI 正在思考 (重试 ${retry}/${maxRetries})<span></span>` : `AI 正在思考<span></span>`;

            const requestBody = { model: state.selectedModel, messages: apiMessages, stream: currentChat.stream !== false, temperature: currentChat.temperature !== undefined ? currentChat.temperature : 0.7 };
            if (currentChat.maxTokens) requestBody.max_tokens = currentChat.maxTokens;

            const response = await fetch(`${API_BASE}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.apiKey}` },
                body: JSON.stringify(requestBody),
                signal: abortController.signal
            });

            if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
            DOM.loadingIndicator.style.display = 'none';

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, newlineIndex).trim();
                    buffer = buffer.slice(newlineIndex + 1);
                    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                        try {
                            const dataObj = JSON.parse(line.slice(6));
                            const delta = dataObj.choices[0]?.delta;

                            // 处理推理内容 (reasoning_content)
                            if (delta?.reasoning_content) {
                                reasoningBuffer += delta.reasoning_content;
                            }

                            // 处理内容
                            if (delta?.content) {
                                botReply += delta.content;
                            }

                            if (delta?.reasoning_content || delta?.content) {
                                scheduleStreamRender(reasoningBuffer
                                    ? `<think>${reasoningBuffer}</think>\n\n${botReply}`
                                    : botReply);
                            }
                        } catch (e) {}
                    }
                }
            }
            // 流式渲染结束，清空定时器并进行最终渲染
            if (_streamTimer) {
                clearTimeout(_streamTimer);
                _streamTimer = null;
            }
            window.__streamFlush = null;
            if (_pendingStreamContent) {
                const c = _pendingStreamContent;
                _pendingStreamContent = '';
                const existingReply = botDomObj.contentNode.querySelector('.reply-content');
                const hasClosedThink = c && CLOSED_THINK_BLOCK_PATTERN.test(c);
                if (hasClosedThink && existingReply) {
                    const replyContent = c.replace(CLOSED_THINK_BLOCK_PATTERN, '').trim();
                    if (replyContent) {
                        existingReply.innerHTML = renderMarkdownToHtml(replyContent);
                        if (shouldProcessMath(replyContent)) renderMath(existingReply);
                        if (replyContent.includes('<pre') || replyContent.includes('```')) highlightCodeBlocks(existingReply);
                    }
                } else {
                    botDomObj.contentNode.innerHTML = renderContentWithThink(c, true);
                    if (shouldProcessMath(c)) renderMath(botDomObj.contentNode);
                    if (c && (c.includes('<pre') || c.includes('```'))) highlightCodeBlocks(botDomObj.contentNode);
                }
                const nextThinkBlock = botDomObj.contentNode.querySelector('.think-block');
                if (nextThinkBlock) nextThinkBlock.open = streamThinkOpen;
                if (autoScroll) scrollToBottom();
            }
            botDomObj.contentNode.querySelectorAll('.stream-cursor').forEach(el => el.remove());
            break;
        } catch (error) {
            if (error.name === 'AbortError') {
                break;
            }
            if (retry < maxRetries) {
                await new Promise(r => setTimeout(r, retry * 3000));
            } else {
                renderMarkdownIntoElement(botDomObj.contentNode, botReply + `\n\n请求失败，已重试 ${maxRetries} 次。错误: ` + error.message);
                showToast("消息请求失败，请重试");
            }
        }
    }

    if (botReply || reasoningBuffer) {
        currentChat.messages.push({ role: 'assistant', content: reasoningBuffer ? `<think>${reasoningBuffer}</think>\n\n${botReply}` : botReply });
        saveState();
    }
    botDomObj.contentNode.querySelectorAll('.stream-cursor').forEach(el => el.remove());
    renderMessages();

    abortController = null;
    updateSendButton(false);
    updateTrimIndicator();
    DOM.loadingIndicator.style.display = 'none';
    DOM.userInput.focus();

    if (currentChat.autoFixEnglish && botReply) {
        autoFixLastAssistantMessage(currentChat).catch(() => {});
    }

    if (currentChat.autoRetryOnRefuse && botReply) {
        checkRefuseAndRetry(currentChat).catch(() => {});
    }

    // 检查队列是否有待发送消息
    if (messageQueue.length > 0 && !isProcessingQueue) {
        setTimeout(() => processQueue(), 500);
    }
}

function stopGeneration() {
    if (abortController) {
        abortController.abort();
        showToast("已停止生成");
    }
}

function updateSendButton(isGenerating) {
    if (isGenerating) {
        DOM.sendBtn.innerHTML = '<svg class="stop-spinner" viewBox="0 0 24 24"><path d="M19.2 12a7.2 7.2 0 1 1-2.1-5.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M17.1 3.8v3.1h3.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        DOM.sendBtn.onclick = stopGeneration;
        DOM.sendBtn.classList.add('stop-btn');
        DOM.queueBtn.classList.add('generating');
    } else {
        DOM.sendBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg>';
        DOM.sendBtn.onclick = sendMessage;
        DOM.sendBtn.classList.remove('stop-btn');
        DOM.queueBtn.classList.remove('generating');
    }
}

async function checkRefuseAndRetry(chat) {
    if (chat.id !== state.currentChatId) return;
    const lastIdx = chat.messages.length - 1;
    if (lastIdx < 0) return;
    const msg = chat.messages[lastIdx];
    if (!msg || msg.role !== 'assistant') return;

    const modelToUse = state.selectedModel;
    if (!modelToUse || !state.apiKey) return;

    const plain = getMessagePlainText(msg);
    if (!plain) return;

    try {
        const prompt = `你是一个判断助手。请判断以下AI回复是否在拒绝回答用户的问题（例如：表示无法回答、不愿意回答、因安全策略拒绝、回避问题等）。\n\nAI回复内容：\n${plain}\n\n请以JSON格式回复，格式为：{"refused": true/false}`;
        const response = await fetch(`${API_BASE}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.apiKey}` },
            body: JSON.stringify({
                model: modelToUse,
                messages: [{ role: 'user', content: prompt }],
                stream: false,
                temperature: 0,
                response_format: { type: 'json_object' }
            })
        });
        if (!response.ok) return;
        const data = await response.json();
        let text = data.choices?.[0]?.message?.content?.trim() || '';
        text = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) text = jsonMatch[0];
        let result;
        try { result = JSON.parse(text); } catch (e) { return; }
        if (result && result.refused === true) {
            showToast('检测到拒绝回答，正在自动重试...');
            retryMessage(lastIdx);
        }
    } catch (error) {}
}

async function generateTitle(chatId, text) {
    const modelToUse = state.titleModel || state.selectedModel;
    if (!modelToUse || !state.apiKey) return;
    try {
        const response = await fetch(`${API_BASE}/chat/completions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.apiKey}` },
            body: JSON.stringify({ model: modelToUse, messages: [{ role: 'user', content: `生成简短标题（不超过10字！！不得超过10字！！），直接输出文本：\n${text}` }], stream: false })
        });
        if (response.ok) {
            const data = await response.json();
            let title = data.choices[0].message.content.trim().replace(/^['""'+]+|['"''']+$/g, '').replace(/[。，！.!,]+$/, '');
            if (title.length > 10) title = title.substring(0, 10);
            const chat = state.chats.find(c => c.id === chatId);
            if (chat && title) { chat.title = title; saveState(); renderChatList(); if(chat.id === state.currentChatId) DOM.chatHeaderTitle.textContent = title; }
        }
    } catch (error) {}
}
