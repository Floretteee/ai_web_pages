function addToQueue() {
    const text = DOM.userInput.value.trim();
    if (!text) return showToast("请先输入消息");

    messageQueue.push(text);
    DOM.userInput.value = '';
    DOM.userInput.style.height = '52px';
    renderQueue();
    showToast("已加入队列");
}

function removeFromQueue(index) {
    messageQueue.splice(index, 1);
    renderQueue();
}

function toggleQueue() {
    const panel = document.getElementById('queuePanel');
    panel.classList.toggle('collapsed');
}

function renderQueue() {
    const countEl = document.getElementById('queueCount');
    const listEl = document.getElementById('queueList');
    const panel = document.getElementById('queuePanel');
    const statusEl = document.getElementById('queueStatus');

    countEl.textContent = messageQueue.length;

    // 暂停状态指示
    if (statusEl) {
        if (queuePaused) {
            statusEl.textContent = '已暂停';
            statusEl.style.display = 'inline-flex';
        } else {
            statusEl.style.display = 'none';
        }
    }
    panel.classList.toggle('paused', queuePaused);

    // 队列为空且未暂停时隐藏面板
    if (messageQueue.length === 0 && !queuePaused) {
        panel.style.display = 'none';
        return;
    }

    panel.style.display = 'block';

    if (messageQueue.length === 0) {
        listEl.innerHTML = '<div class="queue-empty-hint">上一条消息发送失败，队列已暂停。点击重试或强制继续。</div>';
        return;
    }

    listEl.innerHTML = messageQueue.map((msg, i) => `
        <div class="queue-item">
            <span class="queue-item-num">${i + 1}</span>
            <span class="queue-item-text">${escapeHtml(msg)}</span>
            <button class="queue-item-remove" onclick="removeFromQueue(${i})" title="移除">
                <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
        </div>
    `).join('');
    // 强制队列项文字换行
    const queueTextEl = listEl.querySelector('.queue-item-text');
    if (queueTextEl) {
        queueTextEl.style.wordBreak = 'break-all';
        queueTextEl.style.overflowWrap = 'break-word';
        queueTextEl.style.whiteSpace = 'pre-wrap';
    }
}

async function processQueue() {
    if (isProcessingQueue || queuePaused || messageQueue.length === 0) return;

    isProcessingQueue = true;
    const currentChat = state.chats.find(c => c.id === state.currentChatId);

    while (messageQueue.length > 0) {
        if (queuePaused) break;

        const text = messageQueue.shift();
        renderQueue();

        await ensureAutoChecksBeforeSend(currentChat);

        const { messages: preparedMessages, trimmed, skippedRounds } = buildContextWithTrim(currentChat, text);
        if (trimmed && !currentChat.contextLimitWarned) {
            showToast(`上下文将超过 Token 上限，本次请求将丢弃前 ${skippedRounds} 轮对话`, { duration: 4000 });
            currentChat.contextLimitWarned = true;
            saveState();
        }

        currentChat.messages.push({ role: 'user', content: text });
        saveState();
        renderMessages();

        const ok = await executeChatRequest(currentChat, preparedMessages);
        // 本条消息发送失败：暂停队列，保留后续消息，等待重试或手动继续
        if (!ok) {
            break;
        }
    }

    isProcessingQueue = false;
    renderQueue();
}

// 强制继续队列：跳过对失败消息的重试，直接发送队列中的后续消息
function forceContinueQueue() {
    if (!queuePaused) return;
    queuePaused = false;
    updateSendButton(false);
    renderQueue();
    if (messageQueue.length > 0) {
        processQueue();
    }
}

// 重试上一条失败的消息，成功后自动继续队列
async function retryLastAndResume() {
    if (abortController) return;
    const chat = state.chats.find(c => c.id === state.currentChatId);
    if (!chat || chat.messages.length === 0) {
        queuePaused = false;
        updateSendButton(false);
        renderQueue();
        return;
    }
    queuePaused = false;
    // retryMessage 会重新生成最后一条消息；成功后 executeChatRequest 尾部会自动继续队列
    await retryMessage(chat.messages.length - 1);
    renderQueue();
}
