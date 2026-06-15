function handleFileUpload(event) {
    const file = event.target.files[0]; if (!file) return;
    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
            state.attachment = e.target.result;
            DOM.attachmentPreview.innerHTML = `<div class="img-wrap"><img src="${e.target.result}"><button class="remove-btn" onclick="clearAttachment()">×</button></div>`;
            DOM.attachmentPreview.style.display = 'flex';
        }; reader.readAsDataURL(file);
    } else {
        const reader = new FileReader();
        reader.onload = (e) => { DOM.userInput.value += (DOM.userInput.value ? '\n\n' : '') + `\`\`\`${file.name.split('.').pop()}\n${e.target.result}\n\`\`\`\n`; DOM.userInput.dispatchEvent(new Event('input')); };
        reader.readAsText(file);
    } event.target.value = '';
}
function clearAttachment() { state.attachment = null; DOM.attachmentPreview.innerHTML = ''; DOM.attachmentPreview.style.display = 'none'; updateTrimIndicator(); }

function createNewChat(render = true) {
    if (render) closeSettings();
    const newChat = { id: Date.now().toString(), title: "新对话", messages: [], maxTokens: 0, contextLimit: 131072, contextLimitWarned: false, temperature: 0.7, stream: true };
    state.chats.unshift(newChat); state.currentChatId = newChat.id; state.editingIndex = -1; saveState();
    if (render) { renderChatList(); renderMessages(); updateTrimIndicator(); DOM.userInput.focus(); }
}

function switchChat(id) { state.currentChatId = id; state.editingIndex = -1; setVisibleCount(id, MESSAGE_PAGE_SIZE); autoScroll = true; saveState(); renderChatList(); renderMessages(); updateTrimIndicator(); closeSettings(); closeSidebar(); clearSearch(); }

async function deleteChat(id, event) {
    event.stopPropagation();
    if (!(await showConfirm("确定要永久删除这个对话吗？"))) return;
    state.chats = state.chats.filter(c => c.id !== id);
    if(state.currentChatId === id) state.currentChatId = state.chats.length ? state.chats[0].id : null;
    if(state.chats.length === 0) createNewChat(false);
    saveState(); renderChatList(); renderMessages();
}

async function clearCurrentChat() {
    if (!(await showConfirm("确定清空当前对话的所有消息吗？此操作无法撤销。"))) return;
    const chat = state.chats.find(c => c.id === state.currentChatId);
    if(chat) { chat.messages = []; state.editingIndex = -1; saveState(); renderMessages(); updateTrimIndicator(); showToast("对话已清空"); }
}

function renderChatList() {
    DOM.chatList.innerHTML = '';
    state.chats.forEach(chat => {
        const div = document.createElement('div');
        div.className = `chat-item ${chat.id === state.currentChatId ? 'active' : ''}`;
        div.textContent = chat.title; div.title = chat.title;
        div.onclick = () => switchChat(chat.id);
        div.oncontextmenu = (e) => showContextMenu(e, chat.id);

        const delBtn = document.createElement('button');
        delBtn.className = 'delete-chat-btn'; delBtn.title = "删除对话";
        delBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
        delBtn.onclick = (e) => deleteChat(chat.id, e);
        div.appendChild(delBtn);
        DOM.chatList.appendChild(div);
    });
}

function copyMessage(index) {
    const chat = state.chats.find(c => c.id === state.currentChatId);
    let content = chat.messages[index].content;
    if(Array.isArray(content)) content = content.find(c=>c.type==='text')?.text || '';
    navigator.clipboard.writeText(content).then(() => showToast("已复制到剪贴板"));
}

async function deleteMessage(index) {
    if (!(await showConfirm("确定删除此条消息吗？"))) return;
    const chat = state.chats.find(c => c.id === state.currentChatId);
    chat.messages.splice(index, 1); saveState(); renderMessages(); updateTrimIndicator();
}

function startEdit(index) { state.editingIndex = index; renderMessages(); }
function cancelEdit() { state.editingIndex = -1; renderMessages(); }
function saveEdit(index, newText) {
    const chat = state.chats.find(c => c.id === state.currentChatId);
    if (Array.isArray(chat.messages[index].content)) {
        let textPart = chat.messages[index].content.find(c => c.type === 'text');
        if(textPart) textPart.text = newText;
    } else { chat.messages[index].content = newText; }
    chat.messages[index]._renderVersion = (chat.messages[index]._renderVersion || 0) + 1;
    state.editingIndex = -1; saveState(); renderMessages(); updateTrimIndicator(); showToast("修改已保存");
}

async function retryMessage(index) {
    if (abortController) return showToast("请等待当前请求完成");
    const chat = state.chats.find(c => c.id === state.currentChatId);
    const msg = chat.messages[index];

    if (index < chat.messages.length - 1) {
        const confirmMsg = msg.role === 'user'
            ? "重试将保留此消息并删除之后的所有消息，确定吗？"
            : "重试将删除此条消息及之后的所有消息，确定吗？";
        if (!(await showConfirm(confirmMsg))) return;
    }

    // user消息保留当前消息，assistant消息移除当前消息
    chat.messages = msg.role === 'user'
        ? chat.messages.slice(0, index + 1)
        : chat.messages.slice(0, index);

    state.editingIndex = -1;
    saveState();
    renderMessages();
    await executeChatRequest(chat);
}

async function translateAssistantEnglishTokens(index) {
    const chat = state.chats.find(c => c.id === state.currentChatId);
    if (!chat) return;
    const msg = chat.messages[index];
    if (!msg || msg.role !== 'assistant') return;
    if (!state.apiKey || !state.selectedModel) {
        showToast("请先配置 API Key 和模型");
        return;
    }

    const plainText = getMessagePlainText(msg);
    const tokens = extractEnglishTokens(plainText);
    if (!tokens.length) {
        showToast("未发现需要翻译的英文单词");
        return;
    }

    showToast(`正在翻译 ${tokens.length} 个英文词...`);
    const modelToUse = state.titleModel || state.selectedModel;
    try {
        const prompt = `你是中英翻译。下面是一段中文回复中混入的错误英文 token，请将每个英文词翻译成最贴合上下文的简短中文（1-6 字）。仅返回 JSON 对象，键为英文词（保持原大小写），值为中文翻译。不要添加多余解释。\n\n英文词列表：\n${JSON.stringify(tokens)}`;
        const response = await fetch(`${API_BASE}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.apiKey}` },
            body: JSON.stringify({
                model: modelToUse,
                messages: [{ role: 'user', content: prompt }],
                stream: false,
                temperature: 0.2,
                response_format: { type: 'json_object' }
            })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        let text = data.choices?.[0]?.message?.content?.trim() || '';
        text = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) text = jsonMatch[0];
        let map;
        try { map = JSON.parse(text); } catch (e) { throw new Error('翻译结果解析失败'); }
        if (!map || typeof map !== 'object') throw new Error('翻译结果格式错误');

        let original = msg.content;
        if (Array.isArray(original)) {
            const part = original.find(c => c.type === 'text');
            if (part) part.text = applyTranslationMap(part.text || '', map);
        } else if (typeof original === 'string') {
            msg.content = applyTranslationMap(original, map);
        }
        msg._renderVersion = (msg._renderVersion || 0) + 1;
        saveState();
        renderMessages();
        const replaced = Object.keys(map).filter(k => map[k]).length;
        showToast(`已替换 ${replaced} 个英文词`);
    } catch (error) {
        showToast("翻译失败：" + (error.message || ''));
    }
}

function showMessageContextMenu(event, index) {
    event.preventDefault();
    event.stopPropagation();
    const chat = state.chats.find(c => c.id === state.currentChatId);
    if (!chat) return;
    const msg = chat.messages[index];
    if (!msg) return;

    const items = [
        { label: '复制', icon: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>', onClick: () => copyMessage(index) },
        { label: '修改', icon: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>', onClick: () => startEdit(index) },
        { label: '重试', icon: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>', onClick: () => retryMessage(index) },
        { label: '删除', icon: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>', onClick: () => deleteMessage(index) }
    ];

    if (msg.role === 'assistant') {
        const plain = getMessagePlainText(msg);
        if (plain && calcChineseRatio(plain) >= 0.85 && extractEnglishTokens(plain).length > 0) {
            items.push({ divider: true });
            items.push({
                label: '翻译错误英文',
                icon: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>',
                onClick: () => translateAssistantEnglishTokens(index)
            });
        }
    }

    const menu = Components.createContextMenu({ items, ariaLabel: '消息操作菜单' });
    menu.show(event.pageX, event.pageY);
}

function createMessageDOM(msg, index, isNew = false) {
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${msg.role === 'user' ? 'user' : 'bot'}`;
    if (isNew) wrapper.classList.add('animate-enter');
    wrapper.addEventListener('contextmenu', (e) => {
        if (e.target.closest('a, button, input, textarea, select, pre code')) return;
        if (index === state.editingIndex) return;
        showMessageContextMenu(e, index);
    });

    if (index === state.editingIndex) {
        let textValue = msg.content;
        if(Array.isArray(textValue)) textValue = textValue.find(c=>c.type==='text')?.text || '';
        const editArea = document.createElement('textarea');
        editArea.className = 'edit-area'; editArea.value = textValue;
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'edit-actions';
        actionsDiv.innerHTML = `<button class="btn-outline" style="width: auto; padding: 8px 16px;" onclick="cancelEdit()">取消</button><button class="new-chat-btn" style="margin-bottom:0; padding:8px 16px;" onclick="saveEdit(${index}, this.parentElement.previousElementSibling.value)">保存</button>`;
        wrapper.appendChild(editArea); wrapper.appendChild(actionsDiv);
        return { wrapper, contentNode: editArea };
    }

    const contentNode = document.createElement('div');
    contentNode.className = `message ${msg.role === 'user' ? 'user' : 'bot'} markdown-body`;

    let displayContent = msg.content;
    if (Array.isArray(msg.content)) {
        const textPart = msg.content.find(c => c.type === 'text')?.text || '';
        const imgPart = msg.content.find(c => c.type === 'image_url')?.image_url?.url || '';
        displayContent = imgPart ? `![上传图片](${imgPart})\n\n${textPart}` : textPart;
    }

    if (displayContent && THINK_TAG_PATTERN.test(displayContent)) {
        contentNode.innerHTML = renderContentWithThink(displayContent, false);
        if (shouldProcessMath(displayContent)) renderMath(contentNode);
        highlightCodeBlocks(contentNode);
    } else {
        renderMarkdownIntoElement(contentNode, displayContent);
    }
    wrapper.appendChild(contentNode);

    const actions = document.createElement('div');
    actions.className = 'message-actions';
    actions.innerHTML = `
        <button class="action-icon" onclick="copyMessage(${index})" title="复制"><svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg></button>
        <button class="action-icon" onclick="startEdit(${index})" title="编辑"><svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></button>
        <button class="action-icon" onclick="retryMessage(${index})" title="重试"><svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg></button>
        <button class="action-icon" onclick="deleteMessage(${index})" title="删除"><svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
    `;
    wrapper.appendChild(actions);
    return { wrapper, contentNode };
}

let _lastRenderMsgCount = 0;
let _lastRenderEditIdx = -1;
let _lastRenderChatId = null;

const MESSAGE_PAGE_SIZE = 50;
const MESSAGE_PAGE_STEP = 50;
const _visibleCounts = new Map();

function getVisibleCount(chatId) {
    return _visibleCounts.get(chatId) || MESSAGE_PAGE_SIZE;
}

function setVisibleCount(chatId, count) {
    _visibleCounts.set(chatId, count);
}

function loadMoreHistory() {
    const chatId = state.currentChatId;
    const chat = state.chats.find(c => c.id === chatId);
    if (!chat) return;
    const total = chat.messages.filter(m => m.role !== 'system').length;
    const cur = getVisibleCount(chatId);
    setVisibleCount(chatId, Math.min(total, cur + MESSAGE_PAGE_STEP));

    const el = DOM.chatMessages;
    const prevHeight = el.scrollHeight;
    const prevTop = el.scrollTop;
    renderMessages();
    requestAnimationFrame(() => {
        const newHeight = el.scrollHeight;
        el.scrollTop = prevTop + (newHeight - prevHeight);
    });
}

function createLoadMoreButton(remaining) {
    const btn = document.createElement('button');
    btn.className = 'load-more-history-btn';
    btn.type = 'button';
    btn.textContent = `加载更早的消息（剩余 ${remaining} 条）`;
    btn.onclick = loadMoreHistory;
    return btn;
}

function renderMessages() {
    const currentChat = state.chats.find(c => c.id === state.currentChatId);
    if (!currentChat) return;
    DOM.chatHeaderTitle.textContent = currentChat.title || "新对话";

    const msgs = currentChat.messages.filter(m => m.role !== 'system');
    const visibleCount = Math.min(getVisibleCount(state.currentChatId), msgs.length);
    const startIdx = Math.max(0, msgs.length - visibleCount);
    const visibleMsgs = msgs.slice(startIdx);
    const hasMore = startIdx > 0;

    const existingWrappers = DOM.chatMessages.querySelectorAll(':scope > .message-wrapper');
    const existingLoadMore = DOM.chatMessages.querySelector(':scope > .load-more-history-btn');

    // 增量更新：仅当聊天未切换、只是末尾追加、未在编辑、可见区起始未变时才追加 DOM
    // 使用版本戳（_renderVersion）比对而非 JSON.stringify，避免大对话每次重渲染都序列化所有消息
    const sameChat = _lastRenderChatId === state.currentChatId;
    const isAppendOnly = sameChat
        && state.editingIndex === -1
        && _lastRenderEditIdx === -1
        && existingWrappers.length > 0
        && visibleMsgs.length > existingWrappers.length
        && !!existingLoadMore === hasMore
        && visibleMsgs.slice(0, existingWrappers.length).every((msg) => {
            return msg._renderVersion !== undefined && msg._renderVersion === msg._lastRenderedVersion;
        });

    if (isAppendOnly) {
        for (let i = existingWrappers.length; i < visibleMsgs.length; i++) {
            const realIdx = startIdx + i;
            const domObj = createMessageDOM(visibleMsgs[i], realIdx, true);
            DOM.chatMessages.appendChild(domObj.wrapper);
            if (visibleMsgs[i]._renderVersion === undefined) visibleMsgs[i]._renderVersion = 0;
            visibleMsgs[i]._lastRenderedVersion = visibleMsgs[i]._renderVersion;
        }
    } else {
        DOM.chatMessages.innerHTML = '';
        if (hasMore) {
            DOM.chatMessages.appendChild(createLoadMoreButton(startIdx));
        }
        const sameChatFull = _lastRenderChatId === state.currentChatId;
        const newCountThreshold = sameChatFull ? _lastRenderMsgCount : msgs.length;
        visibleMsgs.forEach((msg, i) => {
            const realIdx = startIdx + i;
            const isNew = sameChatFull && realIdx >= newCountThreshold;
            const domObj = createMessageDOM(msg, realIdx, isNew);
            DOM.chatMessages.appendChild(domObj.wrapper);
            if (msg._renderVersion === undefined) msg._renderVersion = 0;
            msg._lastRenderedVersion = msg._renderVersion;
        });
    }

    _lastRenderMsgCount = msgs.length;
    _lastRenderEditIdx = state.editingIndex;
    _lastRenderChatId = state.currentChatId;

    updateTokenCounter();

    setTimeout(() => { if (autoScroll) scrollToBottom(); }, 50);
}

function buildContextWithTrim(chat, newUserContent = null) {
    const limit = chat && chat.contextLimit ? chat.contextLimit : 0;
    const systemMsg = state.systemPrompt ? { role: 'system', content: state.systemPrompt } : null;
    const newMsg = newUserContent !== null ? { role: 'user', content: newUserContent } : null;

    let conversationMsgs = chat.messages.map(m => ({ role: m.role, content: m.content }));

    let dropped20 = 0;
    if (chat && chat.dropFront20 && conversationMsgs.length > 0) {
        dropped20 = Math.floor(conversationMsgs.length * 0.2);
        if (dropped20 > 0) conversationMsgs = conversationMsgs.slice(dropped20);
    }

    let messages = systemMsg ? [systemMsg] : [];
    messages.push(...conversationMsgs);
    if (newMsg) messages.push(newMsg);

    if (!limit) return { messages, trimmed: dropped20 > 0, skippedRounds: 0, dropped20 };

    const msgTokens = (msg) => {
        const base = estimateTokens(msg.content) + 4;
        return (msg.role === 'user' && state.userPrefix) ? base + estimateTokens(state.userPrefix) : base;
    };

    let total = messages.reduce((sum, m) => sum + msgTokens(m), 0);
    if (total <= limit) return { messages, trimmed: dropped20 > 0, skippedRounds: 0, dropped20 };

    // Trim whole conversation rounds from the beginning, while preserving system and the newest message.
    let startIdx = systemMsg ? 1 : 0;
    let skippedRounds = 0;
    const minKeepEnd = newMsg ? 1 : 0;

    while (total > limit && startIdx < messages.length - minKeepEnd - 1) {
        if (messages[startIdx]?.role === 'user' && messages[startIdx + 1]?.role === 'assistant') {
            total -= msgTokens(messages[startIdx]);
            total -= msgTokens(messages[startIdx + 1]);
            startIdx += 2;
            skippedRounds++;
        } else {
            total -= msgTokens(messages[startIdx]);
            startIdx++;
        }
    }

    const trimmed = skippedRounds > 0 || startIdx > (systemMsg ? 1 : 0) || dropped20 > 0;
    const result = [];
    if (systemMsg) result.push(systemMsg);
    for (let i = startIdx; i < messages.length; i++) {
        if (!newMsg || messages[i] !== newMsg) result.push(messages[i]);
    }
    if (newMsg) result.push(newMsg);
    return { messages: result, trimmed, skippedRounds, dropped20 };
}

function formatTokenCount(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + 'K';
    return String(n);
}

function updateTokenCounter() {
    if (!DOM.chatTokenCounter || !state.currentChatId) return;
    const chat = state.chats.find(c => c.id === state.currentChatId);
    if (!chat) return;

    const text = DOM.userInput ? DOM.userInput.value.trim() : '';
    let newContent = null;
    if (text || state.attachment) {
        newContent = state.attachment
            ? [{ type: 'text', text: text || '分析这张图片' }, { type: 'image_url', image_url: { url: state.attachment } }]
            : text;
    }
    const { messages } = buildContextWithTrim(chat, newContent);
    const tokens = estimateMessagesTokens(messages);
    const limit = chat.contextLimit || 0;
    DOM.chatTokenCounter.textContent = limit
        ? `${tokens}/${formatTokenCount(limit)}`
        : `${tokens}`;
    DOM.chatTokenCounter.classList.toggle('over-limit', limit > 0 && tokens > limit);
}

function updateTrimIndicator() {
    if (!state.currentChatId) return;
    const chat = state.chats.find(c => c.id === state.currentChatId);
    if (!chat) return;

    if (DOM.trimBadge) {
        const text = DOM.userInput.value.trim();
        const checkContent = text || state.attachment ? (text || '') : null;
        let newContent = null;
        if (checkContent !== null) {
            newContent = state.attachment
                ? [{ type: 'text', text: checkContent || '分析这张图片' }, { type: 'image_url', image_url: { url: state.attachment } }]
                : checkContent;
        }

        const { trimmed } = buildContextWithTrim(chat, newContent);
        DOM.trimBadge.classList.toggle('show', trimmed);
    }
    updateTokenCounter();
}

function toggleDropFront20() {
    DOM.contextMenu.style.display = 'none';
    const chat = state.chats.find(c => c.id === contextMenuChatId);
    if (!chat) return;
    chat.dropFront20 = !chat.dropFront20;
    chat.contextLimitWarned = false;
    saveState();
    updateTrimIndicator();
    showToast(chat.dropFront20 ? '已开启：固定丢弃前 20% 对话' : '已关闭：固定丢弃前 20% 对话');
}

function handleKeydown(e) {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); sendMessage(); }
    } else {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        toggleSearch(true);
    }
    if (e.key === 'Escape' && DOM.searchBar && DOM.searchBar.classList.contains('active')) {
        clearSearch();
    }
}

let _searchActive = false;
function toggleSearch(forceOpen) {
    const bar = DOM.searchBar;
    if (!bar) return;
    if (forceOpen || !bar.classList.contains('active')) {
        bar.classList.add('active');
        _searchActive = true;
        const input = document.getElementById('searchInput');
        if (input) input.focus();
    } else {
        clearSearch();
    }
}

function clearSearch() {
    const bar = DOM.searchBar;
    const input = document.getElementById('searchInput');
    const count = document.getElementById('searchCount');
    if (bar) bar.classList.remove('active');
    if (input) input.value = '';
    if (count) count.textContent = '';
    _searchActive = false;
    DOM.chatMessages.querySelectorAll('.message-wrapper.search-hidden').forEach(el => el.classList.remove('search-hidden'));
    DOM.chatMessages.querySelectorAll('.message-wrapper.search-highlight').forEach(el => el.classList.remove('search-highlight'));
}

let _searchRaf = 0;
function handleSearch(query) {
    if (_searchRaf) cancelAnimationFrame(_searchRaf);
    _searchRaf = requestAnimationFrame(() => {
        _searchRaf = 0;
        const q = query.trim().toLowerCase();
        const wrappers = DOM.chatMessages.querySelectorAll(':scope > .message-wrapper');
        let matchCount = 0;
        wrappers.forEach(w => {
            w.classList.remove('search-hidden', 'search-highlight');
            if (!q) return;
            const text = w.textContent.toLowerCase();
            if (text.includes(q)) {
                matchCount++;
                w.classList.add('search-highlight');
            } else {
                w.classList.add('search-hidden');
            }
        });
        const count = document.getElementById('searchCount');
        if (count) count.textContent = q ? `${matchCount} 条结果` : '';
    });
}

async function sendMessage() {
    const text = DOM.userInput.value.trim();
    if ((!text && !state.attachment) || !state.apiKey || !state.selectedModel) {
        if (!state.apiKey) showToast("请先在左侧设置中填写 API Key");
        return;
    }

    // 如果AI正在回复或队列正在处理，将消息加入队列
    if (abortController || isProcessingQueue || messageQueue.length > 0) {
        messageQueue.push(text);
        DOM.userInput.value = '';
        DOM.userInput.style.height = '52px';
        renderQueue();
        showToast("已加入队列，等待当前回复完成");
        return;
    }

    const currentChat = state.chats.find(c => c.id === state.currentChatId);
    const isFirstMessage = currentChat.messages.length === 0;

    let userMessageContent = text;
    if (state.attachment) {
        userMessageContent = [ { type: "text", text: text || "分析这张图片" }, { type: "image_url", image_url: { url: state.attachment } } ];
        clearAttachment();
    }

    const { messages: preparedMessages, trimmed, skippedRounds } = buildContextWithTrim(currentChat, userMessageContent);
    if (trimmed) {
        const wasWarned = currentChat.contextLimitWarned;
        if (!wasWarned) {
            showToast(`上下文将超过 Token 上限，本次请求将丢弃前 ${skippedRounds} 轮对话`, { duration: 4000 });
            currentChat.contextLimitWarned = true;
            saveState();
        }
    }

    currentChat.messages.push({ role: 'user', content: userMessageContent });
    DOM.userInput.value = ''; DOM.userInput.style.height = '52px'; state.editingIndex = -1; saveState(); renderMessages();

    if (isFirstMessage) generateTitle(currentChat.id, text || "分析图片");

    await executeChatRequest(currentChat, preparedMessages);
}

function forkChat() {
    DOM.contextMenu.style.display = 'none';
    const chatId = contextMenuChatId;
    const sourceIdx = state.chats.findIndex(c => c.id === chatId);
    if (sourceIdx === -1) return;
    const source = state.chats[sourceIdx];

    const baseTitle = (source.title || '新对话').replace(/\.\d+$/, '');
    const usedNumbers = new Set();
    state.chats.forEach(c => {
        if (!c.title) return;
        if (c.title === baseTitle) { usedNumbers.add(0); return; }
        const m = c.title.match(/^(.+)\.(\d+)$/);
        if (m && m[1] === baseTitle) usedNumbers.add(parseInt(m[2], 10));
    });
    let n = 1;
    while (usedNumbers.has(n)) n++;

    const cloned = JSON.parse(JSON.stringify({ ...source, messages: source.messages.map(m => {
        const { _lastRenderedContent, _lastRenderedVersion, _renderVersion, ...rest } = m;
        return rest;
    }) }));
    cloned.id = Date.now().toString();
    cloned.title = `${baseTitle}.${n}`;
    cloned.contextLimitWarned = false;

    state.chats.splice(sourceIdx + 1, 0, cloned);
    state.currentChatId = cloned.id;
    state.editingIndex = -1;
    setVisibleCount(cloned.id, MESSAGE_PAGE_SIZE);
    saveState();
    renderChatList();
    renderMessages();
    updateTrimIndicator();
    closeSidebar();
    showToast(`已 Fork 为「${cloned.title}」`);
}

function renameChat() {
    DOM.contextMenu.style.display = 'none';
    const chatId = contextMenuChatId;
    const chat = state.chats.find(c => c.id === chatId);
    if (!chat) return;

    // 判断是从标题还是列表触发
    const isFromHeader = chatId === state.currentChatId;
    const titleEl = isFromHeader ? DOM.chatHeaderTitle : null;
    const currentTitle = chat.title || '新对话';

    if (isFromHeader) {
        // 从标题触发：在标题位置编辑
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentTitle;
        input.className = 'rename-input';
        input.style.cssText = 'font-size:inherit;font-weight:inherit;width:200px;padding:4px 8px;border:1px solid #000;border-radius:4px;outline:none;';

        titleEl.textContent = '';
        titleEl.appendChild(input);
        input.focus();
        input.select();

        const save = () => {
            const newTitle = input.value.trim() || currentTitle;
            chat.title = newTitle;
            saveState();
            titleEl.textContent = newTitle;
            renderChatList();
        };

        input.addEventListener('blur', save);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { input.value = currentTitle; input.blur(); }
        });
    } else {
        // 从列表触发：使用prompt
        const newTitle = prompt("重命名对话", currentTitle);
        if (newTitle !== null && newTitle.trim()) {
            chat.title = newTitle.trim();
            saveState();
            renderChatList();
            if (chatId === state.currentChatId) {
                DOM.chatHeaderTitle.textContent = newTitle.trim();
            }
        }
    }
}

async function init() {
    initDOM();
    await loadChatsFromDB();

    DOM.apiKeyInput.value = state.apiKey;
    DOM.systemPromptInput.value = state.systemPrompt;
    DOM.userPrefixInput.value = state.userPrefix;
    DOM.htmlStyleSelect.value = state.htmlStyle;
    DOM.filterModeSelect.value = state.filterMode;
    DOM.exportRoleSelect.value = state.exportRole;

    DOM.presetSelect.innerHTML = '<option value="custom">自定义</option>';
    for (const key in PROMPT_PRESETS) {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = PROMPT_PRESETS[key].name;
        DOM.presetSelect.appendChild(opt);
    }
    DOM.presetSelect.value = state.selectedPreset;
    initCustomSelects();

    if (state.chats.length === 0) createNewChat(false);
    else {
        if (!state.currentChatId || !state.chats.find(c => c.id === state.currentChatId)) state.currentChatId = state.chats[0].id;
        renderChatList(); renderMessages(); updateTrimIndicator();
    }
    if (state.apiKey && state.selectedModel) {
        DOM.modelSelect.innerHTML = `<option value="${state.selectedModel}">${state.selectedModel}</option>`;
        DOM.titleModelSelect.innerHTML = `<option value="">跟随对话模型</option><option value="${state.titleModel}" selected>${state.titleModel}</option>`;
        refreshAllCustomSelects();
    }

    DOM.chatMessages.addEventListener('scroll', checkAutoScroll, { passive: true });
    DOM.chatMessages.addEventListener('pointerdown', keepMobileComposerVisible);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', throttledKeepMobileVisible, { passive: true });
        window.visualViewport.addEventListener('scroll', throttledKeepMobileVisible, { passive: true });
        keepMobileComposerVisible();
    }

    updatePrefixBadge();

    initTheme();

    DOM.userInput.addEventListener('input', function() {
        this.style.height = '52px';
        this.style.height = (this.scrollHeight) + 'px';
        if (this.value === '') this.style.height = '52px';
        updateTrimIndicator();
    });

    // 点击其他地方关闭右键菜单与聊天设置
    document.addEventListener('click', (e) => {
        if (DOM.contextMenu) DOM.contextMenu.style.display = 'none';
        closeCustomSelects();
        if (DOM.chatSettingsContainer && DOM.chatSettingsContainer.classList.contains('show') && !DOM.chatSettingsContainer.contains(e.target) && !e.target.closest('.context-menu-item')) {
            closeChatSettings();
        }
    });
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    // 监听 Service Worker 更新
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;

        // 提示用户新版本可用
        const updateBanner = document.createElement('div');
        updateBanner.className = 'update-banner';
        updateBanner.innerHTML = `
            <span>新版本可用</span>
            <button class="update-refresh-btn">点击刷新</button>
            <button class="update-dismiss-btn">×</button>
        `;
        document.body.appendChild(updateBanner);

        const refreshBtn = updateBanner.querySelector('.update-refresh-btn');
        const dismissBtn = updateBanner.querySelector('.update-dismiss-btn');

        refreshBtn.addEventListener('click', () => {
            window.location.reload();
        });

        dismissBtn.addEventListener('click', () => {
            updateBanner.remove();
        });
    });

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((error) => {
            console.warn('Service worker registration failed:', error);
        });
    });
}

window.addEventListener('beforeunload', () => {
    flushPendingStateSave();
    flushPendingSettingsSave();
});

// 标签页切换恢复
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
        flushPendingStateSave();
        return;
    }
    keepMobileComposerVisible();
    const el = DOM.chatMessages;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 150) {
        autoScroll = true;
        scrollToBottom();
    }
    if (typeof window.__streamFlush === 'function') {
        window.__streamFlush();
    }
});

registerServiceWorker();
init().catch(e => console.error('Init failed:', e));
