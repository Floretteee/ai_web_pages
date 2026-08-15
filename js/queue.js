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

// 队列面板预览：截断长文本，避免撑爆面板
function queueItemShortPreview(item, maxLen = 80) {
    const text = queueItemPreview(item).replace(/\s+/g, ' ').trim();
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '…';
}

// per-chat 消息队列领域模型。
// 每个 chat 拥有独立的队列与暂停状态；处理以 chat 为粒度加锁，全局
// 同时只允许一个请求（abortController）在途。
const QueueStore = (() => {
    const queues = new Map();          // chatId -> { items, pauseReason, failedItem }
    const processing = new Set();      // 正在处理的 chatId（含手动重生成路径）
    const listeners = new Set();

    function _queue(chatId) {
        let q = queues.get(chatId);
        if (!q) {
            q = { items: [], pauseReason: null, failedItem: null };
            queues.set(chatId, q);
        }
        return q;
    }

    function emit() {
        listeners.forEach(fn => { try { fn(); } catch (e) {} });
    }

    function getSnapshot(chatId) {
        const q = _queue(chatId);
        return {
            chatId,
            items: q.items.slice(),
            pauseReason: q.pauseReason,
            failedItem: q.failedItem ? { ...q.failedItem } : null,
            paused: q.pauseReason !== null,
            busy: processing.has(chatId)
        };
    }

    function isPaused(chatId) { return _queue(chatId).pauseReason !== null; }
    function isBusy(chatId) { return processing.has(chatId); }
    function isAnyBusy() { return processing.size > 0; }
    function hasPending(chatId) { const q = _queue(chatId); return q.items.length > 0 || q.failedItem !== null; }

    function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

    function markBusy(chatId) { processing.add(chatId); }
    function unmarkBusy(chatId) { processing.delete(chatId); }

    function persist(chatId) {
        const q = queues.get(chatId);
        if (!q) return;
        saveQueueState({ chatId, items: q.items, pauseReason: q.pauseReason, failedItem: q.failedItem })
            .catch(e => console.warn('Queue persist failed:', e));
    }

    function enqueue(chatId, content, opts = {}) {
        const q = _queue(chatId);
        const item = normalizeQueueItem({ chatId, content });
        if (opts.front) q.items.unshift(item); else q.items.push(item);
        persist(chatId);
        emit();
        return item;
    }

    function remove(chatId, id) {
        const q = _queue(chatId);
        const before = q.items.length;
        q.items = q.items.filter(it => it.id !== id);
        if (q.items.length === before) return false;
        persist(chatId);
        emit();
        return true;
    }

    function move(chatId, id, delta) {
        const q = _queue(chatId);
        const idx = q.items.findIndex(it => it.id === id);
        const to = idx + delta;
        if (idx < 0 || to < 0 || to >= q.items.length) return false;
        const [item] = q.items.splice(idx, 1);
        q.items.splice(to, 0, item);
        persist(chatId);
        emit();
        return true;
    }

    function updateItem(chatId, id, content) {
        const q = _queue(chatId);
        const idx = q.items.findIndex(it => it.id === id);
        if (idx < 0) return false;
        q.items[idx] = normalizeQueueItem({ ...q.items[idx], content });
        persist(chatId);
        emit();
        return true;
    }

    // 移除队列中与给定 id 集合匹配的项（含失败项），用于重放截断时清理旧队列项
    function purgeIds(chatId, ids) {
        const q = _queue(chatId);
        if (!ids || !ids.size) return false;
        const before = q.items.length;
        q.items = q.items.filter(it => !ids.has(it.id));
        const removedFailed = q.failedItem && ids.has(q.failedItem.id);
        if (removedFailed) q.failedItem = null;
        if (before !== q.items.length || removedFailed) {
            persist(chatId);
            emit();
            return true;
        }
        return false;
    }

    function pause(chatId, reason) {
        const q = _queue(chatId);
        q.pauseReason = reason || 'user';
        persist(chatId);
        emit();
    }

    function resume(chatId) {
        const q = _queue(chatId);
        q.pauseReason = null;
        persist(chatId);
        emit();
    }

    async function resumeAndProcess(chatId) {
        resume(chatId);
        await process(chatId);
    }

    function discardChat(chatId) {
        if (queues.delete(chatId)) {
            deleteQueueState(chatId).catch(e => console.warn('Queue delete failed:', e));
            emit();
        }
    }

    // 回滚该队列项对应的 user 占位消息与错误消息（同一 _queueItemId）
    function rollbackQueueMessage(chat, item) {
        if (!chat || !item) return;
        const before = chat.messages.length;
        chat.messages = chat.messages.filter(m => m._queueItemId !== item.id);
        if (chat.messages.length !== before) item.userAppended = false;
        saveState();
        if (chat.id === state.currentChatId) renderMessages();
    }

    // 失败落库：assistant 错误消息，避免被 renderMessages 重建抹掉
    async function _recordError(chat, item, result) {
        if (!chat) return;
        if (chat.messages.some(m => m.isError && m._queueItemId === item.id)) return;
        const detail = result && result.error ? (result.error.message || String(result.error)) : '';
        const reason = result && result.aborted ? '已停止生成' : '消息发送失败';
        const content = detail ? `${reason}：${detail}` : reason;
        chat.messages.push({ role: 'assistant', isError: true, content, _queueItemId: item.id });
        saveState();
        if (chat.id === state.currentChatId) renderMessages();
    }

    function _queueItemText(content) {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return content.find(p => p && p.type === 'text')?.text || '';
        }
        return '';
    }

    // 处理单个 chat 的队列：串行消费至暂停/失败/清空。
    // 失败时保留队头（不 shift），置 failedItem 并落库错误消息；
    // 恢复只能走 retryFailed（重试队头）或 clearQueue（显式放弃）。
    async function process(chatId) {
        const q = _queue(chatId);
        if (processing.has(chatId)) return { ok: false, skipped: true, reason: 'busy' };
        if (q.pauseReason !== null) return { ok: false, skipped: true, reason: 'paused' };
        if (q.items.length === 0) return { ok: true, skipped: true, reason: 'empty' };
        if (!state.apiKey || !state.selectedModel) {
            showToast('请先配置 API Key 和模型');
            return { ok: false, skipped: true, reason: 'not-configured' };
        }

        processing.add(chatId);
        updateSendButton(true);
        let result = { ok: true, aborted: false, failed: false, error: null };
        try {
            while (q.items.length && q.pauseReason === null) {
                const activeItem = q.items[0];
                const chat = state.chats.find(c => c.id === chatId);
                if (!chat) {
                    q.items.shift();
                    persist(chatId); emit();
                    showToast('队列目标对话不存在，已跳过该消息');
                    continue;
                }

                await ensureAutoChecksBeforeSend(chat);
                const prepared = buildContextWithTrim(chat, activeItem.content);
                activeItem.trimmed = prepared.trimmed;
                if (prepared.trimmed) showToast(`此队列消息将丢弃前 ${prepared.skippedRounds} 轮对话`, { duration: 4000 });

                const existingUser = chat.messages.some(m => m._queueItemId === activeItem.id);
                if (!existingUser) {
                    const isFirstMessage = chat.messages.length === 0;
                    chat.messages.push({ role: 'user', content: cloneQueueContent(activeItem.content), _queueItemId: activeItem.id });
                    activeItem.userAppended = true;
                    if (isFirstMessage) {
                        try { generateTitle(chat.id, _queueItemText(activeItem.content) || '分析图片'); } catch (e) {}
                    }
                }
                persist(chatId); saveState(); emit();
                if (chat.id === state.currentChatId) renderMessages();

                result = await executeChatRequest(chat, prepared.messages, { suppressQueueAutoProcess: true });

                if (!result.ok) {
                    q.failedItem = activeItem;
                    q.pauseReason = result.aborted ? 'user' : 'failure';
                    await _recordError(chat, activeItem, result);
                    persist(chatId); emit();
                    break;
                }
                q.items.shift();
                q.failedItem = null;
                persist(chatId); emit();
            }
        } catch (error) {
            console.error('Queue processing failed:', error);
            const activeItem = q.items[0] || null;
            const chat = state.chats.find(c => c.id === chatId);
            if (activeItem) {
                q.failedItem = activeItem;
                q.pauseReason = 'failure';
                if (chat) await _recordError(chat, activeItem, { failed: true, error });
            }
            result = { ok: false, aborted: false, failed: true, error };
            showToast(`队列处理失败：${error.message || error}`);
            persist(chatId); emit();
        } finally {
            processing.delete(chatId);
            updateSendButton(false);
            persist(chatId); emit();
        }
        return result;
    }

    // 重试失败/暂停的队头消息：回滚占位后放回队头重新处理（必须生成，不可跳过）
    async function retryFailed(chatId) {
        const q = _queue(chatId);
        if (processing.has(chatId)) { showToast('队列正在处理中，请稍候'); return false; }
        if (q.pauseReason === null || !q.failedItem) return false;
        const item = q.failedItem;
        const chat = state.chats.find(c => c.id === chatId);
        if (!chat) {
            q.failedItem = null;
            q.pauseReason = q.items.length ? 'user' : null;
            persist(chatId); emit();
            showToast('暂停消息的目标对话已不存在，已清理');
            return false;
        }
        // 若用户已在气泡中编辑该消息，重试必须使用修改后的内容
        const edited = chat.messages.find(m => m._queueItemId === item.id);
        if (edited) {
            item.content = cloneQueueContent(edited.content);
            item.trimmed = false;
        }
        rollbackQueueMessage(chat, item);
        // 失败时队头仍保留在 items 中：就地替换为最新内容，避免重复入队
        const headIdx = q.items.findIndex(it => it.id === item.id);
        if (headIdx >= 0) q.items[headIdx] = item;
        else q.items.unshift(item);
        q.failedItem = null;
        q.pauseReason = null;
        persist(chatId); emit();
        await process(chatId);
        return true;
    }

    // 清空队列：回滚所有已写入 chat.messages 的占位/错误消息，解除暂停
    async function clearQueue(chatId) {
        const q = _queue(chatId);
        if (processing.has(chatId)) { showToast('队列正在处理中，无法清空'); return false; }
        if (!q.items.length && !q.failedItem) return true;
        const count = q.items.length + (q.failedItem ? 1 : 0);
        if (typeof showConfirm === 'function' && !(await showConfirm(`确定清空当前对话的 ${count} 条队列消息吗？`))) return false;
        if (processing.has(chatId)) { showToast('队列正在处理中，无法清空'); return false; }

        const chat = state.chats.find(c => c.id === chatId);
        if (chat) {
            const ids = new Set(q.items.map(it => it.id));
            if (q.failedItem) ids.add(q.failedItem.id);
            chat.messages = chat.messages.filter(m => !(m._queueItemId && ids.has(m._queueItemId)));
            saveState();
            if (chat.id === state.currentChatId) renderMessages();
        }
        queues.delete(chatId);
        deleteQueueState(chatId).catch(e => console.warn('Queue delete failed:', e));
        emit();
        showToast('队列已清空');
        return true;
    }

    // 从 IndexedDB 恢复，并迁移旧 localStorage 队列数据
    async function restore() {
        try {
            const states = await getQueueStates();
            for (const st of states) {
                const q = _queue(st.chatId);
                q.items = (st.items || []).map(it => normalizeQueueItem(it, st.chatId)).filter(Boolean);
                q.pauseReason = st.pauseReason || null;
                q.failedItem = st.failedItem ? normalizeQueueItem(st.failedItem, st.chatId) : null;
                if (!state.chats.some(c => c.id === st.chatId)) {
                    queues.delete(st.chatId);
                    continue;
                }
                if (q.failedItem) {
                    const chat = state.chats.find(c => c.id === st.chatId);
                    const hasMarker = chat && chat.messages.some(m => m._queueItemId === q.failedItem.id);
                    if (!hasMarker) q.failedItem.userAppended = false;
                    q.items = q.items.filter(it => it.id !== q.failedItem.id);
                    if (!q.pauseReason) q.pauseReason = 'user';
                }
            }
        } catch (e) {
            console.warn('Queue restore failed:', e);
            queues.clear();
        }

        try {
            const saved = JSON.parse(localStorage.getItem('ai_message_queue_v2') || 'null');
            if (saved && Array.isArray(saved.queue)) {
                const validChatIds = new Set(state.chats.map(chat => chat.id));
                for (const raw of saved.queue) {
                    const item = normalizeQueueItem(raw, state.currentChatId);
                    if (!item || !validChatIds.has(item.chatId)) continue;
                    const q = _queue(item.chatId);
                    if (!q.items.some(it => it.id === item.id)) q.items.push(item);
                }
                if (saved.failedItem) {
                    const item = normalizeQueueItem(saved.failedItem, state.currentChatId);
                    if (item && validChatIds.has(item.chatId)) {
                        const q = _queue(item.chatId);
                        if (!q.failedItem && !q.items.some(it => it.id === item.id)) {
                            q.failedItem = item;
                            if (q.pauseReason === null) q.pauseReason = 'user';
                        }
                    }
                }
                localStorage.removeItem('ai_message_queue_v2');
                if (typeof showToast === 'function') showToast('已迁移旧版消息队列');
            }
        } catch (e) {
            console.warn('Legacy queue migration failed:', e);
        }

        for (const chatId of queues.keys()) persist(chatId);
        emit();
    }

    return {
        getSnapshot, isPaused, isBusy, isAnyBusy, hasPending,
        onChange, markBusy, unmarkBusy,
        enqueue, remove, move, updateItem, purgeIds,
        pause, resume, resumeAndProcess, discardChat,
        process, retryFailed, clearQueue, restore
    };
})();

// ── 队列视图（DOM 渲染，依赖 QueueStore 快照） ──

let editingQueueItemId = null;

function toggleQueue() {
    document.getElementById('queuePanel').classList.toggle('collapsed');
}

function renderQueue() {
    const countEl = document.getElementById('queueCount');
    const listEl = document.getElementById('queueList');
    const panel = document.getElementById('queuePanel');
    const statusEl = document.getElementById('queueStatus');
    const clearBtn = document.getElementById('queueClearBtn');
    if (!countEl || !listEl || !panel) return;

    const chatId = state.currentChatId;
    const snap = chatId ? QueueStore.getSnapshot(chatId) : null;
    if (!snap || (!snap.items.length && !snap.paused)) {
        countEl.textContent = '0';
        panel.style.display = 'none';
        return;
    }
    if (snap.busy) {
        panel.classList.remove('collapsed');
    }
    countEl.textContent = snap.items.length;
    panel.style.display = 'block';
    panel.classList.toggle('paused', snap.paused);
    if (statusEl) {
        statusEl.textContent = snap.pauseReason === 'failure' ? '失败暂停' : '用户暂停';
        statusEl.style.display = snap.paused ? 'inline-flex' : 'none';
    }
    if (clearBtn) {
        clearBtn.style.display = snap.items.length ? 'inline-flex' : 'none';
        clearBtn.disabled = snap.busy;
    }
    if (editingQueueItemId && !snap.items.some(it => it.id === editingQueueItemId)) {
        editingQueueItemId = null;
    }
    if (!snap.items.length) {
        listEl.innerHTML = snap.pauseReason === 'failure'
            ? '<div class="queue-empty-hint">上一条消息发送失败。点击发送按钮重试，或清空队列。</div>'
            : '<div class="queue-empty-hint">生成已由用户停止。</div>';
        return;
    }

    const disabled = snap.busy;
    listEl.innerHTML = snap.items.map((item, i) => {
        if (item.id === editingQueueItemId) {
            const text = Array.isArray(item.content)
                ? (item.content.find(p => p && p.type === 'text')?.text || '')
                : (typeof item.content === 'string' ? item.content : '');
            return `<div class="queue-item queue-item-editing">
                <textarea id="queueEditArea" class="queue-edit-area" rows="3">${escapeHtml(text)}</textarea>
                <div class="queue-edit-actions">
                    <button class="queue-item-btn primary" onclick="saveQueueEdit()">保存</button>
                    <button class="queue-item-btn" onclick="cancelQueueEdit()">取消</button>
                </div>
            </div>`;
        }
        return `<div class="queue-item">
            <span class="queue-item-num">${i + 1}</span>
            <span class="queue-item-text">${escapeHtml(queueItemShortPreview(item))}${item.trimmed ? ' [上下文已裁剪]' : ''}</span>
            <button class="queue-item-btn" onclick="moveQueueItem('${escapeAttr(item.id)}', -1)" title="上移" ${disabled ? 'disabled' : ''}>↑</button>
            <button class="queue-item-btn" onclick="moveQueueItem('${escapeAttr(item.id)}', 1)" title="下移" ${disabled ? 'disabled' : ''}>↓</button>
            <button class="queue-item-btn" onclick="editQueueItem('${escapeAttr(item.id)}')" title="编辑" ${disabled ? 'disabled' : ''}>✎</button>
            <button class="queue-item-remove" onclick="removeQueueItem('${escapeAttr(item.id)}')" title="移除" ${disabled ? 'disabled' : ''}>
                <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
        </div>`;
    }).join('');
}

function removeQueueItem(id) {
    const chatId = state.currentChatId;
    if (QueueStore.isBusy(chatId)) return showToast('队列正在处理中，无法移除');
    QueueStore.remove(chatId, id);
}

function moveQueueItem(id, delta) {
    const chatId = state.currentChatId;
    if (QueueStore.isBusy(chatId)) return showToast('队列正在处理中，无法调换');
    QueueStore.move(chatId, id, delta);
}

function editQueueItem(id) {
    const chatId = state.currentChatId;
    if (QueueStore.isBusy(chatId)) return showToast('队列正在处理中，无法编辑');
    editingQueueItemId = id;
    renderQueue();
    const textarea = document.getElementById('queueEditArea');
    if (textarea) { textarea.focus(); textarea.select(); }
}

function saveQueueEdit() {
    const chatId = state.currentChatId;
    const id = editingQueueItemId;
    const textarea = document.getElementById('queueEditArea');
    if (!id || !textarea) return;
    const newText = textarea.value;
    const snap = QueueStore.getSnapshot(chatId);
    const item = snap.items.find(it => it.id === id);
    if (!item) return;
    let content;
    if (Array.isArray(item.content)) {
        content = item.content.map(part => part.type === 'text' ? { ...part, text: newText } : part);
    } else {
        content = newText;
    }
    QueueStore.updateItem(chatId, id, content);
    editingQueueItemId = null;
    renderQueue();
    showToast('队列消息已更新');
}

function cancelQueueEdit() {
    editingQueueItemId = null;
    renderQueue();
}

async function clearQueueClick() {
    const chatId = state.currentChatId;
    const ok = await QueueStore.clearQueue(chatId);
    if (ok) editingQueueItemId = null;
}

async function retryLastAndResume() {
    await QueueStore.retryFailed(state.currentChatId);
}

function addToQueue() {
    const chatId = state.currentChatId;
    const text = DOM.userInput.value.trim();
    if (!text && !state.attachments.length) return showToast('请先输入消息或添加附件');
    const content = cloneMessageContent(buildMessageContent(text));
    QueueStore.enqueue(chatId, content);
    DOM.userInput.value = '';
    DOM.userInput.style.height = '52px';
    if (state.attachments.length) clearAttachments();
    renderQueue();
    updateTrimIndicator();
    showToast('已加入队列');
}