const API_BASE = "https://api.fimall.cfd/v1";
marked.setOptions({ highlight: function(c, l) { return hljs.highlight(c, { language: hljs.getLanguage(l) ? l : 'plaintext' }).value; }, breaks: true, gfm: true });

let abortController = null;
let messageQueue = [];
let isProcessingQueue = false;
let autoScroll = true;
let contextMenuChatId = null;

function showToast(message) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast'; toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'toastLeave 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards';
        toast.addEventListener('animationend', () => toast.remove());
    }, 2500);
}

function showConfirm(message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'custom-modal-overlay';
        
        const modal = document.createElement('div');
        modal.className = 'custom-modal';
        
        const text = document.createElement('p');
        text.textContent = message;
        
        const actions = document.createElement('div');
        actions.className = 'custom-modal-actions';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'custom-modal-btn-cancel';
        cancelBtn.textContent = '取消';
        
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'custom-modal-btn-confirm';
        confirmBtn.textContent = '确定';
        
        const close = (result) => {
            overlay.classList.remove('active');
            setTimeout(() => overlay.remove(), 300);
            resolve(result);
        };
        
        cancelBtn.onclick = () => close(false);
        confirmBtn.onclick = () => close(true);
        
        actions.appendChild(cancelBtn); actions.appendChild(confirmBtn);
        modal.appendChild(text); modal.appendChild(actions); overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        requestAnimationFrame(() => overlay.classList.add('active'));
    });
}

let state = {
    apiKey: localStorage.getItem('ai_api_key') || '', selectedModel: localStorage.getItem('ai_selected_model') || '',
    titleModel: localStorage.getItem('ai_title_model') || '', 
    systemPrompt: localStorage.getItem('ai_system_prompt') || '',
    userPrefix: localStorage.getItem('ai_user_prefix') || '',
    selectedPreset: localStorage.getItem('ai_selected_preset') || 'custom',
    htmlStyle: localStorage.getItem('ai_html_style') || 'autumn',
    filterThink: localStorage.getItem('ai_filter_think') !== 'false',
    exportRole: localStorage.getItem('ai_export_role') || 'both',
    chats: JSON.parse(localStorage.getItem('ai_chats')) || [], currentChatId: localStorage.getItem('ai_current_chat_id') || null,
    attachment: null, editingIndex: -1
};

const DOM = {
    chatList: document.getElementById('chatList'), chatMessages: document.getElementById('chatMessages'),
    userInput: document.getElementById('userInput'), apiKeyInput: document.getElementById('apiKeyInput'),
    modelSelect: document.getElementById('modelSelect'), titleModelSelect: document.getElementById('titleModelSelect'),
    presetSelect: document.getElementById('presetSelect'), systemPromptInput: document.getElementById('systemPromptInput'), 
    userPrefixInput: document.getElementById('userPrefixInput'), sendBtn: document.getElementById('sendBtn'),
    loadingIndicator: document.getElementById('loadingIndicator'), settingsContainer: document.getElementById('settingsContainer'),
    attachmentPreview: document.getElementById('attachmentPreview'), chatHeaderTitle: document.getElementById('chatHeaderTitle'),
    inputPrefixBadge: document.getElementById('inputPrefixBadge'), sidebar: document.getElementById('sidebar'),
    sidebarBackdrop: document.getElementById('sidebarBackdrop'), htmlStyleSelect: document.getElementById('htmlStyleSelect'),
    contextMenu: document.getElementById('contextMenu'), filterThinkToggle: document.getElementById('filterThinkToggle'),
    exportRoleSelect: document.getElementById('exportRoleSelect')
};

function updatePrefixBadge() {
    if (state.selectedPreset !== 'custom' && PROMPT_PRESETS[state.selectedPreset]) {
        let badgeText = PROMPT_PRESETS[state.selectedPreset].name.replace(/\s*\(.*\)/, '');
        DOM.inputPrefixBadge.textContent = badgeText;
        DOM.inputPrefixBadge.title = state.userPrefix;
        DOM.inputPrefixBadge.style.display = 'flex';
    } else {
        DOM.inputPrefixBadge.style.display = 'none';
    }
}

function init() {
    DOM.apiKeyInput.value = state.apiKey; 
    DOM.systemPromptInput.value = state.systemPrompt;
    DOM.userPrefixInput.value = state.userPrefix;
    DOM.htmlStyleSelect.value = state.htmlStyle;
    DOM.filterThinkToggle.checked = state.filterThink;
    DOM.exportRoleSelect.value = state.exportRole;

    DOM.presetSelect.innerHTML = '<option value="custom">自定义</option>';
    for (const key in PROMPT_PRESETS) {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = PROMPT_PRESETS[key].name;
        DOM.presetSelect.appendChild(opt);
    }
    DOM.presetSelect.value = state.selectedPreset;

    if (state.chats.length === 0) createNewChat(false);
    else {
        if (!state.currentChatId || !state.chats.find(c => c.id === state.currentChatId)) state.currentChatId = state.chats[0].id;
        renderChatList(); renderMessages();
    }
    if (state.apiKey && state.selectedModel) {
        DOM.modelSelect.innerHTML = `<option value="${state.selectedModel}">${state.selectedModel}</option>`;
        DOM.titleModelSelect.innerHTML = `<option value="">跟随对话模型</option><option value="${state.titleModel}" selected>${state.titleModel}</option>`;
    }
    
    // 添加滚动监听
    DOM.chatMessages.addEventListener('scroll', checkAutoScroll);
    
    updatePrefixBadge();
}

function toggleSettings() { DOM.settingsContainer.classList.toggle('show'); }
function toggleSidebar() { DOM.sidebar.classList.toggle('open'); DOM.sidebarBackdrop.classList.toggle('show'); }
function closeSidebar() { DOM.sidebar.classList.remove('open'); DOM.sidebarBackdrop.classList.remove('show'); }
function saveState() { localStorage.setItem('ai_chats', JSON.stringify(state.chats)); localStorage.setItem('ai_current_chat_id', state.currentChatId); }

function saveSettings() {
    state.apiKey = DOM.apiKeyInput.value.trim(); state.selectedModel = DOM.modelSelect.value;
    state.titleModel = DOM.titleModelSelect.value; 
    state.systemPrompt = DOM.systemPromptInput.value.trim();
    state.userPrefix = DOM.userPrefixInput.value;
    state.selectedPreset = DOM.presetSelect.value;
    state.htmlStyle = DOM.htmlStyleSelect.value;
    state.filterThink = DOM.filterThinkToggle.checked;
    state.exportRole = DOM.exportRoleSelect.value;

    localStorage.setItem('ai_api_key', state.apiKey); localStorage.setItem('ai_selected_model', state.selectedModel);
    localStorage.setItem('ai_title_model', state.titleModel); localStorage.setItem('ai_system_prompt', state.systemPrompt);
    localStorage.setItem('ai_user_prefix', state.userPrefix); localStorage.setItem('ai_selected_preset', state.selectedPreset);
    localStorage.setItem('ai_html_style', state.htmlStyle); localStorage.setItem('ai_filter_think', state.filterThink);
    localStorage.setItem('ai_export_role', state.exportRole);
    updatePrefixBadge();
}

function handlePresetChange() {
    const val = DOM.presetSelect.value;
    if (PROMPT_PRESETS[val]) {
        DOM.systemPromptInput.value = PROMPT_PRESETS[val].system;
        DOM.userPrefixInput.value = PROMPT_PRESETS[val].userPrefix;
    } else if (val === 'custom') {
        DOM.systemPromptInput.value = '';
        DOM.userPrefixInput.value = '';
    }
    saveSettings();
}

async function fetchModels() {
    if (!DOM.apiKeyInput.value.trim()) return showToast("请先填写 API Key");
    try {
        DOM.modelSelect.innerHTML = '<option value="">加载中...</option>';
        const res = await fetch(`${API_BASE}/models`, { headers: { 'Authorization': `Bearer ${DOM.apiKeyInput.value.trim()}` } });
        const data = await res.json();
        if (data && data.data) {
            DOM.modelSelect.innerHTML = ''; DOM.titleModelSelect.innerHTML = '<option value="">跟随对话模型</option>';
            data.data.forEach(m => { DOM.modelSelect.add(new Option(m.id, m.id)); DOM.titleModelSelect.add(new Option(m.id, m.id)); });
            if (state.selectedModel && data.data.find(m => m.id === state.selectedModel)) DOM.modelSelect.value = state.selectedModel;
            else { state.selectedModel = data.data[0].id; saveSettings(); }
            if (state.titleModel && data.data.find(m => m.id === state.titleModel)) DOM.titleModelSelect.value = state.titleModel;
            showToast("模型列表获取成功！");
        }
    } catch (error) { 
        DOM.modelSelect.innerHTML = '<option value="">获取失败</option>'; 
        showToast("获取模型失败，请检查网络或 Key");
    }
}

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
function clearAttachment() { state.attachment = null; DOM.attachmentPreview.innerHTML = ''; DOM.attachmentPreview.style.display = 'none'; }

function createNewChat(render = true) {
    const newChat = { id: Date.now().toString(), title: "新对话", messages: [] };
    state.chats.unshift(newChat); state.currentChatId = newChat.id; state.editingIndex = -1; saveState();
    if (render) { renderChatList(); renderMessages(); DOM.userInput.focus(); }
}

function switchChat(id) { state.currentChatId = id; state.editingIndex = -1; saveState(); renderChatList(); renderMessages(); closeSidebar(); }

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
    if(chat) { chat.messages = []; state.editingIndex = -1; saveState(); renderMessages(); showToast("对话已清空"); }
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
    chat.messages.splice(index, 1); saveState(); renderMessages();
}

function startEdit(index) { state.editingIndex = index; renderMessages(); }
function cancelEdit() { state.editingIndex = -1; renderMessages(); }
function saveEdit(index, newText) {
    const chat = state.chats.find(c => c.id === state.currentChatId);
    if (Array.isArray(chat.messages[index].content)) {
        let textPart = chat.messages[index].content.find(c => c.type === 'text');
        if(textPart) textPart.text = newText;
    } else { chat.messages[index].content = newText; }
    state.editingIndex = -1; saveState(); renderMessages(); showToast("修改已保存");
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

function createMessageDOM(msg, index) {
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${msg.role === 'user' ? 'user' : 'bot'}`;

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

    if (displayContent && displayContent.includes('<think>')) {
        contentNode.innerHTML = renderContentWithThink(displayContent, false);
    } else {
        const mathBlocks = [];
        let protectedContent = displayContent.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
            const idx = mathBlocks.length;
            mathBlocks.push(math);
            return `<span class="math-placeholder" data-math-idx="${idx}"></span>`;
        });
        protectedContent = protectedContent.replace(/\$([^\$\n]+?)\$/g, (_, math) => {
            const idx = mathBlocks.length;
            mathBlocks.push(math);
            return `<span class="math-inline-placeholder" data-math-idx="${idx}"></span>`;
        });
        contentNode.innerHTML = DOMPurify.sanitize(marked.parse(protectedContent));
        contentNode.querySelectorAll('.math-placeholder').forEach(el => {
            const idx = parseInt(el.dataset.mathIdx);
            el.outerHTML = `$$${mathBlocks[idx]}$$`;
        });
        contentNode.querySelectorAll('.math-inline-placeholder').forEach(el => {
            const idx = parseInt(el.dataset.mathIdx);
            el.outerHTML = `$${mathBlocks[idx]}$`;
        });
        try { renderMathInElement(contentNode, { delimiters: [ {left:'$$', right:'$$', display:true}, {left:'$', right:'$', display:false}, {left:'\\[', right:'\\]', display:true} ], throwOnError: false }); } catch(e){}
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

function renderMessages() {
    DOM.chatMessages.innerHTML = '';
    const currentChat = state.chats.find(c => c.id === state.currentChatId);
    if (!currentChat) return;
    DOM.chatHeaderTitle.textContent = currentChat.title || "新对话";

    currentChat.messages.forEach((msg, index) => {
        if (msg.role !== 'system') {
            const domObj = createMessageDOM(msg, index);
            DOM.chatMessages.appendChild(domObj.wrapper);
        }
    });
    setTimeout(() => { if (autoScroll) scrollToBottom(); }, 50);
}

function scrollToBottom() { 
    DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
    updateScrollButton();
}

function enableAutoScroll() {
    autoScroll = true;
    scrollToBottom();
    updateScrollButton();
}

function checkAutoScroll() {
    const el = DOM.chatMessages;
    const threshold = 100;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    
    if (!isNearBottom && autoScroll) {
        autoScroll = false;
    }
    
    if (isNearBottom) {
        autoScroll = true;
    }
    
    updateScrollButton();
}

function updateScrollButton() {
    const btn = document.getElementById('scrollBottomBtn');
    if (!autoScroll) {
        btn.classList.add('show');
    } else {
        btn.classList.remove('show');
    }
}

function scrollToBottomClick() {
    enableAutoScroll();
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

    // 如果AI正在回复，将消息加入队列
    if (abortController) {
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

    currentChat.messages.push({ role: 'user', content: userMessageContent });
    DOM.userInput.value = ''; DOM.userInput.style.height = '52px'; state.editingIndex = -1; saveState(); renderMessages();

    if (isFirstMessage) generateTitle(currentChat.id, text || "分析图片");

    await executeChatRequest(currentChat);
}

async function executeChatRequest(currentChat) {
    abortController = new AbortController();
    updateSendButton(true);
    DOM.loadingIndicator.style.display = 'block';
    if (autoScroll) scrollToBottom();

    let apiMessages = currentChat.messages.map(m => {
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

    if (state.systemPrompt) {
        apiMessages.unshift({ role: 'system', content: state.systemPrompt });
    }

    const targetIndex = currentChat.messages.length;
    const botDomObj = createMessageDOM({ role: 'assistant', content: '' }, targetIndex);
    botDomObj.wrapper.querySelector('.message-actions').style.display = 'none';
    DOM.chatMessages.appendChild(botDomObj.wrapper);

    function renderBotContent(fullContent) {
        botDomObj.contentNode.innerHTML = renderContentWithThink(fullContent, true);
    }
    
    let botReply = '';
    let reasoningBuffer = '';
    const maxRetries = 3;

    for (let retry = 0; retry <= maxRetries; retry++) {
        try {
            botReply = ''; 
            reasoningBuffer = '';
            DOM.loadingIndicator.innerHTML = retry > 0 ? `AI 正在思考 (重试 ${retry}/${maxRetries})<span></span>` : `AI 正在思考<span></span>`;

            const requestBody = { model: state.selectedModel, messages: apiMessages, stream: true };
            
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
                                const fullContent = reasoningBuffer
                                    ? `<think>${reasoningBuffer}</think>\n\n${botReply}`
                                    : botReply;
                                renderBotContent(fullContent);
                                if (autoScroll) scrollToBottom();
                            }
                        } catch (e) {}
                    }
                }
            }
            break; 
        } catch (error) {
            if (error.name === 'AbortError') {
                break;
            }
            if (retry < maxRetries) {
                await new Promise(r => setTimeout(r, 2000));
            } else {
                botDomObj.contentNode.innerHTML = DOMPurify.sanitize(marked.parse(botReply + `\n\n请求失败，已重试 ${maxRetries} 次。错误: ` + error.message));
                showToast("消息请求失败，请重试");
            }
        }
    }

    if (botReply || reasoningBuffer) {
        currentChat.messages.push({ role: 'assistant', content: reasoningBuffer ? `<think>${reasoningBuffer}</think>\n\n${botReply}` : botReply });
        saveState();
    }
    renderMessages();

    abortController = null;
    updateSendButton(false);
    DOM.loadingIndicator.style.display = 'none';
    DOM.userInput.focus();
    
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
        DOM.sendBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>';
        DOM.sendBtn.onclick = stopGeneration;
        DOM.sendBtn.classList.add('stop-btn');
    } else {
        DOM.sendBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg>';
        DOM.sendBtn.onclick = sendMessage;
        DOM.sendBtn.classList.remove('stop-btn');
    }
}

function renderContentWithThink(content, isStreaming) {
    let mainContent = content || '';
    let thinkHtml = '';
    const thinkSvg = `<svg class="think-icon" viewBox="0 0 24 24" width="16" height="16"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`;
    const thinkAnimSvg = `<svg class="think-icon thinking" viewBox="0 0 24 24" width="16" height="16"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"/><path d="M12 6v6l4 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    
    const thinkMatch = content && content.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
        thinkHtml = `<details class="think-block" open>
            <summary class="think-summary">${thinkSvg} 思考过程</summary>
            <div class="think-content markdown-body">${DOMPurify.sanitize(marked.parse(thinkMatch[1]))}</div>
        </details>`;
        mainContent = content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
    } else if (isStreaming) {
        const thinkStart = content && content.indexOf('<think>');
        if (thinkStart !== -1) {
            const before = content.slice(0, thinkStart).trim();
            const inThink = content.slice(thinkStart + 7);
            if (inThink) {
                thinkHtml = `<details class="think-block" open>
                    <summary class="think-summary">${thinkAnimSvg} 思考中...</summary>
                    <div class="think-content markdown-body">${DOMPurify.sanitize(marked.parse(inThink))}</div>
                </details>`;
            }
            mainContent = before;
        }
    }
    const mainHtml = mainContent ? DOMPurify.sanitize(marked.parse(mainContent)) : '';
    return thinkHtml + mainHtml;
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

function exportJSON() {
    if (state.chats.length === 0) return showToast("当前没有可导出的聊天记录");
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(state.chats, null, 2)], { type: "application/json" }));
    a.download = `fimall_chat_${new Date().toISOString().slice(0,10)}.json`; a.click();
}

function importJSON() { document.getElementById('importInput').click(); }
function handleFileImport(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const parsed = JSON.parse(event.target.result);
            if (Array.isArray(parsed)) {
                if (await showConfirm("导入将覆盖当前的全部聊天记录，是否继续？")) {
                    state.chats = parsed; state.currentChatId = parsed[0]?.id || null;
                    saveState(); renderChatList(); renderMessages(); showToast("历史记录导入成功！");
                }
            } else { showToast("非法的记录格式"); }
        } catch (err) { showToast("JSON 文件解析失败，请检查文件"); }
        e.target.value = "";
    }; reader.readAsText(file);
}

// 右键菜单功能
function showContextMenu(e, chatId) {
    e.preventDefault();
    contextMenuChatId = chatId || state.currentChatId;
    const menu = DOM.contextMenu;
    menu.style.display = 'block';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
    
    const closeMenu = (ev) => {
        if (!menu.contains(ev.target)) {
            menu.style.display = 'none';
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
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

function exportChatMarkdown() {
    DOM.contextMenu.style.display = 'none';
    const chat = state.chats.find(c => c.id === contextMenuChatId);
    if (!chat) return;
    
    const filterThink = state.filterThink;
    const exportRole = state.exportRole;
    
    let md = `# ${chat.title || '新对话'}\n\n`;
    chat.messages.forEach(msg => {
        if (msg.role === 'system') return;
        if (exportRole !== 'both' && msg.role !== exportRole) return;
        
        const content = Array.isArray(msg.content) 
            ? msg.content.find(c => c.type === 'text')?.text || '' 
            : msg.content;
        
        let displayContent = content;
        if (filterThink) {
            displayContent = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        }
        
        if (msg.role === 'user') {
            md += `## 用户\n\n${displayContent}\n\n`;
        } else if (msg.role === 'assistant') {
            md += `## 助手\n\n${displayContent}\n\n`;
        }
    });
    
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = `${chat.title || '对话'}_${new Date().toISOString().slice(0,10)}.md`;
    a.click();
    showToast("已导出 Markdown");
}

function exportChatHTML() {
    DOM.contextMenu.style.display = 'none';
    const chat = state.chats.find(c => c.id === contextMenuChatId);
    if (!chat) return;
    
    const style = state.htmlStyle;
    let css = '';
    let bodyClass = '';
    
    if (style === 'autumn') {
        bodyClass = 'autumn';
        css = `
            @import url('https://fonts.googleapis.cn/css2?family=Noto+Serif+SC:wght@400;600;700&display=swap');
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { background: #f5f0e8; color: #5c4b37; font-family: 'Noto Serif SC', 'Source Han Serif SC', "Songti SC", STSong, "华文宋体", SimSun, serif; font-weight: 500; padding: 40px 15px; max-width: 1000px; margin: 0 auto; text-rendering: optimizeLegibility; font-size: clamp(15px, 2vw, 18px); }
            h1 { text-align: center; color: #8b6914; border-bottom: 2px solid #d4a843; padding-bottom: 16px; margin-bottom: 32px; font-size: clamp(20px, 3.2vw, 28px); font-weight: 700; }
            .msg { margin: clamp(16px, 2.4vw, 28px) 0; }
            .user { text-align: right; }
            .assistant { text-align: left; }
            .role { font-weight: 700; margin-bottom: 8px; font-size: clamp(12px, 1.4vw, 14px); color: #8b6914; }
            .assistant .role { color: #6b8e23; }
            .content { line-height: 1.8; font-weight: 500; }
            pre { background: #e8e0d0; padding: 12px; border-radius: 4px; overflow-x: auto; margin: 8px 0; }
            code { font-family: 'Consolas', monospace; font-size: clamp(13px, 1.4vw, 15px); }
            blockquote { border-left: 3px solid #d4a843; padding-left: 12px; color: #8b7355; margin: 12px 0; }
            @media print {
                body { padding: 20px; }
            }
        `;
    } else {
        bodyClass = 'github';
        css = `
            body { background: #fff; color: #24292e; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif; font-weight: 500; padding: 40px 20px; max-width: 800px; margin: 0 auto; text-rendering: optimizeLegibility; }
            h1 { border-bottom: 1px solid #eaecef; padding-bottom: 16px; font-weight: 700; }
            .msg { margin: 12px 0; padding: 16px; border-radius: 8px; }
            .user { background: #f6f8fa; text-align: right; }
            .user .role { text-align: left; }
            .assistant { background: #fff; }
            .role { font-weight: 600; margin-bottom: 8px; color: #0366d6; }
            .content { line-height: 1.6; text-align: left; max-width: 85%; }
            pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; text-align: left; }
            code { font-family: 'SFMono-Regular', Consolas, monospace; font-size: 14px; }
            blockquote { border-left: 4px solid #dfe2e5; padding-left: 16px; color: #6a737d; margin: 16px 0; text-align: left; }
            @media print {
                body { padding: 20px; }
            }
        `;
    }
    
    let messagesHtml = '';
    const filterThink = state.filterThink;
    const exportRole = state.exportRole;
    
    chat.messages.forEach(msg => {
        if (msg.role === 'system') return;
        if (exportRole !== 'both' && msg.role !== exportRole) return;
        
        const content = Array.isArray(msg.content) 
            ? msg.content.find(c => c.type === 'text')?.text || '' 
            : (msg.content || '');
        
        let displayContent = content;
        if (filterThink && typeof displayContent === 'string') {
            displayContent = displayContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        }
        
        if (!displayContent) return;
        
        if (msg.role === 'user') {
            messagesHtml += '<div class="msg user"><div class="role">用户</div><div class="content">' + escapeHtml(displayContent) + '</div></div>';
        } else if (msg.role === 'assistant') {
            messagesHtml += '<div class="msg assistant"><div class="role">助手</div><div class="content">' + marked.parse(displayContent) + '</div></div>';
        }
    });
    
    const title = (chat.title || '新对话').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
    const html = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <meta name="description" content="AI 对话记录：' + title + '">\n    <meta name="generator" content="Fimall Chat">\n    <title>' + title + '</title>\n    <style>' + css + '</style>\n</head>\n<body class="' + bodyClass + '">\n    <article role="main">\n        <header>\n            <h1>' + title + '</h1>\n        </header>\n        <section>\n            ' + messagesHtml + '\n        </section>\n    </article>\n</body>\n</html>';
    
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = (chat.title || '对话').replace(/[<>:"/\\|?*]/g, '_') + '_' + new Date().toISOString().slice(0,10) + '.html';
    a.click();
    showToast("已导出 HTML");
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 点击其他地方关闭右键菜单
document.addEventListener('click', () => {
    if (DOM.contextMenu) DOM.contextMenu.style.display = 'none';
});

// 消息队列功能
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

DOM.userInput.addEventListener('input', function() { this.style.height = '52px'; this.style.height = (this.scrollHeight) + 'px'; if (this.value === '') this.style.height = '52px'; });
init();