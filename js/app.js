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

function switchChat(id) { state.currentChatId = id; state.editingIndex = -1; setVisibleCount(id, MESSAGE_PAGE_SIZE); autoScroll = true; saveState(); renderChatList(); renderMessages(); updateTrimIndicator(); closeSettings(); closeSidebar(); }

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

function createMessageDOM(msg, index, isNew = false) {
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${msg.role === 'user' ? 'user' : 'bot'}`;
    if (isNew) wrapper.classList.add('animate-enter');

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
    const sameChat = _lastRenderChatId === state.currentChatId;
    const isAppendOnly = sameChat
        && state.editingIndex === -1
        && _lastRenderEditIdx === -1
        && existingWrappers.length > 0
        && visibleMsgs.length > existingWrappers.length
        && !!existingLoadMore === hasMore
        && visibleMsgs.slice(0, existingWrappers.length).every((msg) => {
            const oldText = msg._lastRenderedContent;
            const newText = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            return oldText === newText;
        });

    if (isAppendOnly) {
        for (let i = existingWrappers.length; i < visibleMsgs.length; i++) {
            const realIdx = startIdx + i;
            const domObj = createMessageDOM(visibleMsgs[i], realIdx, true);
            DOM.chatMessages.appendChild(domObj.wrapper);
            visibleMsgs[i]._lastRenderedContent = typeof visibleMsgs[i].content === 'string' ? visibleMsgs[i].content : JSON.stringify(visibleMsgs[i].content);
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
            msg._lastRenderedContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        });
    }

    _lastRenderMsgCount = msgs.length;
    _lastRenderEditIdx = state.editingIndex;
    _lastRenderChatId = state.currentChatId;

    setTimeout(() => { if (autoScroll) scrollToBottom(); }, 50);
}

function buildContextWithTrim(chat, newUserContent = null) {
    const limit = chat && chat.contextLimit ? chat.contextLimit : 0;
    const systemMsg = state.systemPrompt ? { role: 'system', content: state.systemPrompt } : null;
    const newMsg = newUserContent !== null ? { role: 'user', content: newUserContent } : null;

    const conversationMsgs = chat.messages.map(m => ({ role: m.role, content: m.content }));

    let messages = systemMsg ? [systemMsg] : [];
    messages.push(...conversationMsgs);
    if (newMsg) messages.push(newMsg);

    if (!limit) return { messages, trimmed: false, skippedRounds: 0 };

    const msgTokens = (msg) => {
        const base = estimateTokens(msg.content) + 4;
        return (msg.role === 'user' && state.userPrefix) ? base + estimateTokens(state.userPrefix) : base;
    };

    let total = messages.reduce((sum, m) => sum + msgTokens(m), 0);
    if (total <= limit) return { messages, trimmed: false, skippedRounds: 0 };

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

    const trimmed = skippedRounds > 0 || startIdx > (systemMsg ? 1 : 0);
    const result = [];
    if (systemMsg) result.push(systemMsg);
    for (let i = startIdx; i < messages.length; i++) {
        if (!newMsg || messages[i] !== newMsg) result.push(messages[i]);
    }
    if (newMsg) result.push(newMsg);
    return { messages: result, trimmed, skippedRounds };
}

function updateTrimIndicator() {
    if (!DOM.trimBadge || !state.currentChatId) return;
    const chat = state.chats.find(c => c.id === state.currentChatId);
    if (!chat) return;

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

function handleKeydown(e) {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); sendMessage(); }
    } else {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    }
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
