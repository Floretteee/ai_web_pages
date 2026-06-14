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

    countEl.textContent = messageQueue.length;

    if (messageQueue.length === 0) {
        panel.style.display = 'none';
        return;
    }

    panel.style.display = 'block';
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
    if (isProcessingQueue || messageQueue.length === 0) return;

    isProcessingQueue = true;
    const currentChat = state.chats.find(c => c.id === state.currentChatId);

    while (messageQueue.length > 0) {
        const text = messageQueue.shift();
        renderQueue();

        currentChat.messages.push({ role: 'user', content: text });
        saveState();
        renderMessages();

        await executeChatRequest(currentChat);
    }

    isProcessingQueue = false;
}
