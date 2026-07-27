function cloneQueueContent(content) {
    if (typeof content === 'string') return content;
    return JSON.parse(JSON.stringify(content));
}

function createQueueId() {
    return `q_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeQueueItem(item, fallbackChatId = state.currentChatId) {
    if (item === null || item === undefined) return null;
    if (typeof item === 'string' || Array.isArray(item)) {
        return { id: createQueueId(), chatId: fallbackChatId, content: cloneQueueContent(item), trimmed: false };
    }
    if (typeof item !== 'object') return null;
    const content = item.content !== undefined ? item.content : '';
    return {
        ...item,
        id: item.id || createQueueId(),
        chatId: item.chatId || fallbackChatId,
        content: cloneQueueContent(content),
        trimmed: !!item.trimmed
    };
}

function queueItemPreview(item) {
    const content = item && item.content;
    if (typeof content === 'string') return content || '（空消息）';
    if (Array.isArray(content)) {
        const text = content.filter(p => p && p.type === 'text').map(p => p.text || '').join('\n').trim();
        const images = content.filter(p => p && p.type === 'image_url').length;
        return `${text}${images ? `${text ? '\n' : ''}[${images} 张图片]` : ''}` || '（附件消息）';
    }
    return String(content ?? '');
}

function enqueueContent(chatId, content, front = false) {
    const item = normalizeQueueItem({ chatId, content });
    if (front) messageQueue.unshift(item); else messageQueue.push(item);
    persistQueueState();
    return item;
}

function addToQueue() {
    const text = DOM.userInput.value.trim();
    if (!text && !state.attachments.length) return showToast('请先输入消息或添加附件');
    const content = cloneMessageContent(buildMessageContent(text));
    enqueueContent(state.currentChatId, content);
    DOM.userInput.value = '';
    DOM.userInput.style.height = '52px';
    if (state.attachments.length) clearAttachments();
    renderQueue();
    showToast('已加入队列');
}

function removeFromQueue(id) {
    const index = messageQueue.findIndex(item => normalizeQueueItem(item).id === id);
    if (index >= 0) messageQueue.splice(index, 1);
    persistQueueState();
    renderQueue();
}

function toggleQueue() {
    document.getElementById('queuePanel').classList.toggle('collapsed');
}

function setQueuePause(reason) {
    queuePauseReason = reason;
    syncQueuePaused();
    persistQueueState();
    renderQueue();
}

function renderQueue() {
    messageQueue = messageQueue.map(item => normalizeQueueItem(item)).filter(Boolean);
    const countEl = document.getElementById('queueCount');
    const listEl = document.getElementById('queueList');
    const panel = document.getElementById('queuePanel');
    const statusEl = document.getElementById('queueStatus');
    if (!countEl || !listEl || !panel) return;
    countEl.textContent = messageQueue.length;
    syncQueuePaused();
    if (statusEl) {
        statusEl.textContent = queuePauseReason === 'failure' ? '失败暂停' : '用户暂停';
        statusEl.style.display = queuePaused ? 'inline-flex' : 'none';
    }
    panel.classList.toggle('paused', queuePaused);
    if (!messageQueue.length && !queuePaused && !failedQueueItem) {
        panel.style.display = 'none';
        return;
    }
    panel.style.display = 'block';
    if (!messageQueue.length) {
        listEl.innerHTML = queuePauseReason === 'failure'
            ? '<div class="queue-empty-hint">上一条消息发送失败。点击重试或强制继续。</div>'
            : '<div class="queue-empty-hint">生成已由用户停止。</div>';
        return;
    }
    listEl.innerHTML = messageQueue.map((item, i) => `
        <div class="queue-item">
            <span class="queue-item-num">${i + 1}</span>
            <span class="queue-item-text">${escapeHtml(queueItemPreview(item))}${item.trimmed ? ' [上下文已裁剪]' : ''}</span>
            <button class="queue-item-remove" onclick="removeFromQueue('${escapeAttr(item.id)}')" title="移除">
                <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
        </div>`).join('');
    listEl.querySelectorAll('.queue-item-text').forEach(el => {
        el.style.wordBreak = 'break-all'; el.style.overflowWrap = 'break-word'; el.style.whiteSpace = 'pre-wrap';
    });
}

async function processQueue() {
    if (isProcessingQueue || isSendingMessage) return { ok: false, aborted: false, failed: false, skipped: true, reason: 'busy', error: null };
    if (queuePaused) return { ok: false, aborted: false, failed: false, skipped: true, reason: 'paused', error: null };
    if (!messageQueue.length) return { ok: true, aborted: false, failed: false, skipped: true, reason: 'empty', error: null };
    isProcessingQueue = true;
    isSendingMessage = true;
    updateSendButton(true);
    let result = { ok: true, aborted: false, failed: false, error: null };
    let activeItem = null;
    let activeChat = null;
    try {
        while (messageQueue.length && !queuePaused) {
            activeItem = normalizeQueueItem(messageQueue[0]);
            messageQueue[0] = activeItem;
            activeChat = state.chats.find(c => c.id === activeItem.chatId);
            if (!activeChat) {
                messageQueue.shift(); persistQueueState(); renderQueue();
                showToast('队列目标对话不存在，已跳过该消息');
                activeItem = null;
                continue;
            }
            await ensureAutoChecksBeforeSend(activeChat);
            const prepared = buildContextWithTrim(activeChat, activeItem.content);
            activeItem.trimmed = prepared.trimmed;
            if (prepared.trimmed) showToast(`此队列消息将丢弃前 ${prepared.skippedRounds} 轮对话`, { duration: 4000 });
            const existingUser = activeChat.messages.some(m => m._queueItemId === activeItem.id);
            if (!existingUser) activeChat.messages.push({ role: 'user', content: cloneQueueContent(activeItem.content), _queueItemId: activeItem.id });
            activeItem.userAppended = true;
            messageQueue.shift();
            persistQueueState(); saveState(); renderQueue();
            if (activeChat.id === state.currentChatId) renderMessages();
            result = await executeChatRequest(activeChat, prepared.messages, { suppressQueueAutoProcess: true });
            if (!result.ok) {
                failedQueueItem = activeItem;
                setQueuePause(result.aborted ? 'user' : 'failure');
                break;
            }
            failedQueueItem = null;
            activeItem = null;
            activeChat = null;
            persistQueueState();
        }
    } catch (error) {
        console.error('Queue processing failed:', error);
        if (activeItem) {
            messageQueue = messageQueue.filter(item => normalizeQueueItem(item).id !== activeItem.id);
            failedQueueItem = activeItem;
        } else if (messageQueue.length) {
            failedQueueItem = normalizeQueueItem(messageQueue.shift());
            messageQueue = messageQueue.filter(item => normalizeQueueItem(item).id !== failedQueueItem.id);
        }
        result = { ok: false, aborted: false, failed: true, error };
        if (failedQueueItem) setQueuePause('failure');
        showToast(`队列处理失败：${error.message || error}`);
    } finally {
        isProcessingQueue = false;
        isSendingMessage = false;
        persistQueueState(); renderQueue(); updateSendButton(false);
    }
    return result;
}

function rollbackFailedQueueMessage(item) {
    if (!item) return;
    const chat = state.chats.find(c => c.id === item.chatId);
    if (!chat) return;
    const before = chat.messages.length;
    chat.messages = chat.messages.filter(m => m._queueItemId !== item.id);
    if (chat.messages.length !== before) item.userAppended = false;
    saveState();
    if (chat.id === state.currentChatId) renderMessages();
}

function forceContinueQueue() {
    if (!queuePaused) return;
    const item = failedQueueItem;
    if (item) {
        messageQueue = messageQueue.filter(entry => normalizeQueueItem(entry).id !== item.id);
        rollbackFailedQueueMessage(item);
    }
    failedQueueItem = null;
    setQueuePause(null);
    updateSendButton(false);
    if (messageQueue.length) processQueue();
}

async function retryLastAndResume() {
    if (abortController || isSendingMessage || isProcessingQueue || !queuePaused || !failedQueueItem) return;
    const item = failedQueueItem;
    const chat = state.chats.find(c => c.id === item.chatId);
    if (!chat) {
        failedQueueItem = null;
        setQueuePause(messageQueue.length ? 'user' : null);
        return showToast('暂停消息的目标对话已不存在，已清理');
    }
    rollbackFailedQueueMessage(item);
    messageQueue = messageQueue.filter(entry => normalizeQueueItem(entry).id !== item.id);
    messageQueue.unshift(item);
    failedQueueItem = null;
    queuePauseReason = null;
    syncQueuePaused(); persistQueueState();
    const result = await processQueue();
    if (!result.ok && result.failed && failedQueueItem) setQueuePause('failure');
}
