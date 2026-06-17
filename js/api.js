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
            DOM.modelSelect.innerHTML = ''; DOM.titleModelSelect.innerHTML = '<option value="">跟随对话模型</option>'; DOM.refuseModelSelect.innerHTML = '<option value="">跟随对话模型</option>';
            data.data.forEach(m => { DOM.modelSelect.add(new Option(m.id, m.id)); DOM.titleModelSelect.add(new Option(m.id, m.id)); DOM.refuseModelSelect.add(new Option(m.id, m.id)); });
            if (state.selectedModel && data.data.find(m => m.id === state.selectedModel)) DOM.modelSelect.value = state.selectedModel;
            else { state.selectedModel = data.data[0].id; DOM.modelSelect.value = state.selectedModel; persistSettings(); }
            if (state.titleModel && data.data.find(m => m.id === state.titleModel)) DOM.titleModelSelect.value = state.titleModel;
            if (state.refuseModel && data.data.find(m => m.id === state.refuseModel)) DOM.refuseModelSelect.value = state.refuseModel;
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

async function executeChatRequest(currentChat, preparedMessages, options = {}) {
    abortController = new AbortController();
    updateSendButton(true);
    updateTrimIndicator();
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
    let botDomObj;
    const reuseWrapper = options && options.reuseWrapper;
    if (reuseWrapper && reuseWrapper.isConnected) {
        botDomObj = {
            wrapper: reuseWrapper,
            contentNode: reuseWrapper.querySelector('.message.bot, .message')
        };
        botDomObj.wrapper.classList.remove('bubble-resetting');
        botDomObj.wrapper.classList.add('bubble-reenter');
        botDomObj.wrapper.querySelector('.message-actions').style.display = 'none';
        botDomObj.contentNode.innerHTML = '<div class="result-thinking"><span></span><span></span><span></span></div>';
    } else {
        botDomObj = createMessageDOM({ role: 'assistant', content: '' }, targetIndex, true);
        botDomObj.wrapper.querySelector('.message-actions').style.display = 'none';
        botDomObj.contentNode.innerHTML = '<div class="result-thinking"><span></span><span></span><span></span></div>';
        DOM.chatMessages.appendChild(botDomObj.wrapper);
    }
    let streamThinkOpen = false;
    let streamThinkPointerHandled = false;
    function _toggleStreamThink(summary, event) {
        const thinkBlock = summary.closest('.think-block');
        const msgEl = botDomObj.wrapper.querySelector('.message.bot');
        const previousHeight = msgEl ? msgEl.getBoundingClientRect().height : 0;
        streamThinkOpen = thinkBlock ? !thinkBlock.open : !streamThinkOpen;
        if (thinkBlock) thinkBlock.open = streamThinkOpen;
        event.preventDefault();
        _animateBubbleHeight(previousHeight);
    }
    botDomObj.contentNode.addEventListener('pointerdown', (event) => {
        const summary = event.target.closest('.think-summary');
        if (!summary || !botDomObj.contentNode.contains(summary)) return;
        streamThinkPointerHandled = true;
        _toggleStreamThink(summary, event);
    });
    botDomObj.contentNode.addEventListener('click', (event) => {
        const summary = event.target.closest('.think-summary');
        if (!summary || !botDomObj.contentNode.contains(summary)) return;
        if (streamThinkPointerHandled) {
            streamThinkPointerHandled = false;
            event.preventDefault();
            return;
        }
        _toggleStreamThink(summary, event);
    });

    let _streamTimer = null;
    let _pendingStreamContent = '';
    let _thinkRenderedOnce = false;
    let _firstTokenArrived = false;
    let _bubbleGrowthAnimation = null;
    const _streamTextByTarget = new Map();
    function _ensureStreamingState() {
        if (_firstTokenArrived) return;
        _firstTokenArrived = true;
        const thinkingDots = botDomObj.contentNode.querySelector('.result-thinking');
        if (thinkingDots) thinkingDots.remove();
        const msgEl = botDomObj.wrapper.querySelector('.message.bot');
        if (msgEl) msgEl.classList.add('result-streaming');
    }
    function _getStreamTarget() {
        const reply = botDomObj.contentNode.querySelector('.reply-content');
        if (reply) return { key: 'reply', element: reply };
        const thinkContent = botDomObj.contentNode.querySelector('.think-content');
        if (thinkContent) return { key: 'think', element: thinkContent };
        return { key: 'main', element: botDomObj.contentNode };
    }
    function _markNewStreamText(element, previousText) {
        const currentText = element.textContent || '';
        let start = 0;
        const maxStart = Math.min(previousText.length, currentText.length);
        while (start < maxStart && previousText[start] === currentText[start]) start++;
        if (start >= currentText.length) return currentText;
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
                if (node.parentElement && node.parentElement.closest('button, svg')) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        const textNodes = [];
        let node;
        while ((node = walker.nextNode())) textNodes.push(node);
        let offset = 0;
        textNodes.forEach(textNode => {
            const text = textNode.nodeValue;
            const nextOffset = offset + text.length;
            if (nextOffset <= start) {
                offset = nextOffset;
                return;
            }
            const localStart = Math.max(0, start - offset);
            const span = document.createElement('span');
            span.className = 'stream-new-chunk';
            span.textContent = text.slice(localStart);
            if (localStart === 0) {
                textNode.parentNode.replaceChild(span, textNode);
            } else {
                textNode.nodeValue = text.slice(0, localStart);
                textNode.parentNode.insertBefore(span, textNode.nextSibling);
            }
            offset = nextOffset;
        });
        return currentText;
    }
    function _triggerPopIn() {
        const target = _getStreamTarget();
        const previousText = _streamTextByTarget.get(target.key) || '';
        const currentText = _markNewStreamText(target.element, previousText);
        _streamTextByTarget.set(target.key, currentText);
    }
    function _updateStreamContent(c) {
        const hasClosedThink = c && CLOSED_THINK_BLOCK_PATTERN.test(c);
        const existingThink = botDomObj.contentNode.querySelector('.think-block');
        const existingReply = botDomObj.contentNode.querySelector('.reply-content');
        if (hasClosedThink && existingThink) {
            const thinkMatch = c.match(CLOSED_THINK_BLOCK_PATTERN);
            const replyContent = c.replace(CLOSED_THINK_BLOCK_PATTERN, '').trim();
            const thinkingNow = !replyContent;
            const summary = existingThink.querySelector('.think-summary');
            const thinkContent = existingThink.querySelector('.think-content');
            if (summary) summary.innerHTML = `${thinkingNow ? '' : '<svg class="think-icon" viewBox="0 0 24 24" width="16" height="16"><path d="M9.55 17.05 4.9 12.4l1.42-1.42 3.23 3.23 8.13-8.13 1.42 1.42-9.55 9.55Z"/></svg>'} ${thinkingNow ? '思考中...' : '思考过程'}`;
            if (thinkContent) thinkContent.innerHTML = renderMarkdownToHtml(thinkMatch[1]);
            existingThink.open = streamThinkOpen;
            if (replyContent) {
                if (existingReply) existingReply.innerHTML = renderMarkdownToHtml(replyContent);
                else botDomObj.contentNode.insertAdjacentHTML('beforeend', `<div class="reply-content">${renderMarkdownToHtml(replyContent)}</div>`);
            }
            if (shouldProcessMath(c)) renderMath(botDomObj.contentNode);
            if (c.includes('<pre') || c.includes('```')) highlightCodeBlocks(botDomObj.contentNode);
            _thinkRenderedOnce = true;
            return;
        }
        _thinkRenderedOnce = !!hasClosedThink;
        botDomObj.contentNode.innerHTML = renderContentWithThink(c, true);
        if (shouldProcessMath(c)) renderMath(botDomObj.contentNode);
        if (c && (c.includes('<pre') || c.includes('```'))) highlightCodeBlocks(botDomObj.contentNode);
        const nextThinkBlock = botDomObj.contentNode.querySelector('.think-block');
        if (nextThinkBlock) nextThinkBlock.open = streamThinkOpen;
    }
    function _animateBubbleHeight(previousHeight) {
        const msgEl = botDomObj.wrapper.querySelector('.message.bot');
        if (!msgEl || !previousHeight) return;
        const nextHeight = msgEl.getBoundingClientRect().height;
        if (Math.abs(nextHeight - previousHeight) < 0.5) return;
        if (_bubbleGrowthAnimation) _bubbleGrowthAnimation.cancel();
        msgEl.style.height = `${nextHeight}px`;
        msgEl.style.overflow = 'hidden';
        const animation = msgEl.animate([
            { height: `${previousHeight}px` },
            { height: `${nextHeight}px` }
        ], { duration: 280, easing: 'linear' });
        _bubbleGrowthAnimation = animation;
        animation.onfinish = () => {
            if (_bubbleGrowthAnimation !== animation) return;
            msgEl.style.height = '';
            msgEl.style.overflow = '';
            _bubbleGrowthAnimation = null;
        };
        animation.oncancel = () => {
            if (_bubbleGrowthAnimation !== animation) return;
            _bubbleGrowthAnimation = null;
        };
    }
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
            _ensureStreamingState();
            const msgEl = botDomObj.wrapper.querySelector('.message.bot');
            if (_bubbleGrowthAnimation) {
                _bubbleGrowthAnimation.cancel();
                _bubbleGrowthAnimation = null;
                if (msgEl) {
                    msgEl.style.height = '';
                    msgEl.style.overflow = '';
                }
            }
            const previousHeight = msgEl ? msgEl.getBoundingClientRect().height : 0;
            _updateStreamContent(c);
            _triggerPopIn();
            _animateBubbleHeight(previousHeight);
            if (autoScroll) scrollToBottom();
        }, 300);
    }

    let botReply = '';
    let reasoningBuffer = '';
    const maxRetries = 3;

    for (let retry = 0; retry <= maxRetries; retry++) {
        try {
            botReply = '';
            reasoningBuffer = '';

            const requestBody = { model: state.selectedModel, messages: apiMessages, stream: currentChat.stream !== false, temperature: currentChat.temperature !== undefined ? currentChat.temperature : 0.7 };
            if (currentChat.maxTokens) requestBody.max_tokens = currentChat.maxTokens;

            const response = await fetch(`${API_BASE}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.apiKey}` },
                body: JSON.stringify(requestBody),
                signal: abortController.signal
            });

            if (!response.ok) {
                let errDetail = `HTTP ${response.status}`;
                try { const errBody = await response.json(); errDetail += ': ' + (errBody.error?.message || errBody.message || JSON.stringify(errBody).slice(0, 200)); } catch(e) {}
                throw new Error(errDetail);
            }
            _ensureStreamingState();

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
                _updateStreamContent(c);
                if (autoScroll) scrollToBottom();
            }
            const msgEl = botDomObj.wrapper.querySelector('.message.bot');
            if (_bubbleGrowthAnimation) _bubbleGrowthAnimation.cancel();
            if (msgEl) {
                msgEl.classList.remove('result-streaming');
                msgEl.style.height = '';
                msgEl.style.overflow = '';
            }
            break;
        } catch (error) {
            if (error.name === 'AbortError') {
                break;
            }
            if (retry < maxRetries) {
                await new Promise(r => setTimeout(r, retry * 3000));
            } else {
                const retryNote = botReply ? `\n\n已有部分回复，错误: ${error.message}` : `请求失败，已重试 ${maxRetries} 次。错误: ${error.message}`;
                botDomObj.contentNode.innerHTML = `<div class="error-message"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="currentColor"/></svg><span>${retryNote}</span></div>`;
                showToast("消息请求失败，请重试");
            }
        }
    }

    if (botReply || reasoningBuffer) {
        currentChat.messages.push({ role: 'assistant', content: reasoningBuffer ? `<think>${reasoningBuffer}</think>\n\n${botReply}` : botReply });
        saveState();
    }
    const msgEl = botDomObj.wrapper.querySelector('.message.bot');
    if (_bubbleGrowthAnimation) _bubbleGrowthAnimation.cancel();
    if (msgEl) {
        msgEl.classList.remove('result-streaming');
        msgEl.style.height = '';
        msgEl.style.overflow = '';
    }
    botDomObj.wrapper.classList.remove('bubble-reenter');

    const isReuse = !!(options && options.reuseWrapper);
    // 复用气泡重试时，流式渲染已直接更新 DOM，跳过 renderMessages 全量重建以保留原气泡
    if (!isReuse) {
        renderMessages();
    }

    abortController = null;
    updateSendButton(false);
    updateTrimIndicator();
    if (!isReuse) DOM.userInput.focus();

    if (currentChat.autoFixEnglish && botReply) {
        autoFixLastAssistantMessage(currentChat).catch(() => {});
    }

    let refused = false;
    if (currentChat.autoRetryOnRefuse && botReply) {
        refused = await checkRefuseAndRetry(currentChat, botDomObj.wrapper).catch(() => false);
    }

    // 重试复用气泡：若未触发再次重试，则最终同步渲染以恢复操作按钮与版本戳
    if (isReuse && !refused) {
        renderMessages();
        DOM.userInput.focus();
    }

    // 未重试时才检查队列（重试中由最内层非重试调用处理队列）
    if (!refused && messageQueue.length > 0 && !isProcessingQueue) {
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

async function checkRefuseAndRetry(chat, reuseWrapper) {
    if (chat.id !== state.currentChatId) return;
    const lastIdx = chat.messages.length - 1;
    if (lastIdx < 0) return;
    const msg = chat.messages[lastIdx];
    if (!msg || msg.role !== 'assistant') return;

    const modelToUse = state.refuseModel || state.selectedModel;
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
        if (!response.ok) return false;
        const data = await response.json();
        let text = data.choices?.[0]?.message?.content?.trim() || '';
        text = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) text = jsonMatch[0];
        let result;
        try { result = JSON.parse(text); } catch (e) { return false; }
        if (result && result.refused === true) {
            showToast('检测到拒绝回答，正在自动重试...');
            await autoRetryRefuse(chat, lastIdx, reuseWrapper).catch(() => {});
            return true;
        }
    } catch (error) {}
    return false;
}

async function autoRetryRefuse(chat, index, wrapper) {
    if (!wrapper || !wrapper.isConnected) return;
    // 移除被拒绝的 assistant 消息（保留之前的 user 消息），不移除气泡 DOM
    chat.messages = chat.messages.slice(0, index);
    saveState();

    // 线性缩小原气泡到初始生成状态
    wrapper.classList.remove('bubble-reenter');
    wrapper.classList.add('bubble-resetting');

    // 等待缩小动画结束
    await new Promise(resolve => {
        let done = false;
        const onEnd = () => {
            if (done) return;
            done = true;
            wrapper.removeEventListener('animationend', onEnd);
            resolve();
        };
        wrapper.addEventListener('animationend', onEnd);
        setTimeout(onEnd, 400);
    });

    // 复用同一个气泡继续请求（重新流式生成）
    await executeChatRequest(chat, null, { reuseWrapper: wrapper });
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
