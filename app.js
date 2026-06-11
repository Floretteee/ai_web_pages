const API_BASE = "https://api.fimall.cfd/v1";
const THINK_TAG_PATTERN = /<\/?\s*think(?:ing)?\b[^>]*>/i;
const CLOSED_THINK_BLOCK_PATTERN = /<\s*think(?:ing)?\b[^>]*>([\s\S]*?)<\/\s*think(?:ing)?\s*>/i;
const CLOSED_THINK_BLOCK_PATTERN_GLOBAL = /<\s*think(?:ing)?\b[^>]*>[\s\S]*?<\/\s*think(?:ing)?\s*>/gi;
const STANDARD_HTML_TAGS = new Set('a abbr address area article aside audio b bdi bdo blockquote br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr i iframe img input ins kbd label legend li main map mark menu meter nav object ol optgroup option output p picture pre progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr'.split(' '));

const loadedAssets = new Map();

function loadScriptOnce(src) {
    if (loadedAssets.has(src)) return loadedAssets.get(src);
    const promise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.defer = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
    loadedAssets.set(src, promise);
    return promise;
}

function loadStylesheetOnce(href) {
    if (loadedAssets.has(href) || document.querySelector(`link[href="${href}"]`)) return loadedAssets.get(href) || Promise.resolve();
    const promise = new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.onload = resolve;
        link.onerror = reject;
        document.head.appendChild(link);
    });
    loadedAssets.set(href, promise);
    return promise;
}

function ensureKatexAssets() {
    if (typeof window.renderMathInElement === 'function') return Promise.resolve();
    return Promise.all([
        loadStylesheetOnce('vendor/katex/katex.min.css'),
        loadScriptOnce('vendor/katex/katex.min.js')
    ]).then(() => loadScriptOnce('vendor/katex/auto-render.min.js'));
}

function escapeNonStandardHtmlTags(text) {
    return String(text || '').replace(/<\/?\s*([a-zA-Z][\w:-]*)\b[^>]*>/g, (tag, name) => {
        return STANDARD_HTML_TAGS.has(name.toLowerCase()) ? tag : escapeHtml(tag);
    });
}

function highlightCodeBlocks(container) {
    if (!window.hljs || !container) return;
    container.querySelectorAll('pre code:not(.hljs)').forEach((block) => {
        try { window.hljs.highlightElement(block); } catch (e) {}
    });
}

function shouldProcessMath(text) {
    return text && (text.includes('$') || text.includes('\\['));
}

function renderMath(container) {
    if (!container) return;
    ensureKatexAssets().then(() => {
        if (typeof window.renderMathInElement !== 'function') return;
        try {
            window.renderMathInElement(container, { delimiters: [ {left:'$$', right:'$$', display:true}, {left:'$', right:'$', display:false}, {left:'\\[', right:'\\]', display:true} ], throwOnError: false });
        } catch(e) {}
    }).catch(() => {});
}

function renderMarkdownToHtml(markdown) {
    const source = escapeNonStandardHtmlTags(markdown || '');
    const mathBlocks = [];
    let protectedContent = source.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
        const idx = mathBlocks.length;
        mathBlocks.push({ display: true, math });
        return `DOMD_MATH_BLOCK_${idx}_END`;
    });
    protectedContent = protectedContent.replace(/\$([^\$\n]+?)\$/g, (_, math) => {
        const idx = mathBlocks.length;
        mathBlocks.push({ display: false, math });
        return `DOMD_MATH_INLINE_${idx}_END`;
    });

    let html = '';
    if (window.DOMDMarkdown && typeof window.DOMDMarkdown.renderToHtml === 'function') {
        html = window.DOMDMarkdown.renderToHtml(protectedContent);
    } else {
        const container = document.createElement('div');
        container.textContent = protectedContent;
        html = container.innerHTML;
    }
    mathBlocks.forEach((item, idx) => {
        const token = item.display ? `DOMD_MATH_BLOCK_${idx}_END` : `DOMD_MATH_INLINE_${idx}_END`;
        const mathText = item.display ? `$$${item.math}$$` : `$${item.math}$`;
        html = html.replaceAll(token, escapeHtml(mathText));
    });
    return DOMPurify.sanitize(html);
}

function renderMarkdownIntoElement(element, markdown) {
    element.innerHTML = renderMarkdownToHtml(markdown);
    if (shouldProcessMath(markdown)) renderMath(element);
    if (markdown && (markdown.includes('<pre') || markdown.includes('```'))) highlightCodeBlocks(element);
}

function isSafeExportUrl(url) {
    const value = String(url || '').trim().replace(/[\u0000-\u001F\u007F\s]+/g, '');
    if (!value) return '';
    if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(value)) return value;
    if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(value)) return value;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return '';
    return value;
}

function renderMarkdownInlineNative(text) {
    const tokens = [];
    const pushToken = (html) => {
        const token = `EXPORTHTMLTOKEN${tokens.length}END`;
        tokens.push({ token, html });
        return token;
    };

    let source = String(text || '');
    source = source.replace(/`([^`]+)`/g, (_, code) => pushToken(`<code>${escapeHtml(code)}</code>`));
    source = source.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, url, titleAttr) => {
        const safeUrl = isSafeExportUrl(url);
        if (!safeUrl) return escapeHtml(alt || '');
        const title = titleAttr ? ` title="${escapeHtml(titleAttr)}"` : '';
        return pushToken(`<img src="${escapeHtml(safeUrl)}" alt="${escapeHtml(alt || '')}"${title} loading="lazy">`);
    });
    source = source.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, label, url, titleAttr) => {
        const safeUrl = isSafeExportUrl(url);
        const safeLabel = escapeHtml(label || '');
        if (!safeUrl) return safeLabel;
        const title = titleAttr ? ` title="${escapeHtml(titleAttr)}"` : '';
        return pushToken(`<a href="${escapeHtml(safeUrl)}"${title}>${safeLabel}</a>`);
    });

    let html = escapeHtml(source);
    html = html
        .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/~~([^~]+)~~/g, '<del>$1</del>')
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        .replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>')
        .replace(/\n/g, '<br>');

    tokens.forEach(({ token, html: tokenHtml }) => {
        html = html.replaceAll(token, tokenHtml);
    });
    return html;
}

function isMarkdownBlockStart(line, nextLine = '') {
    return /^\s*$/.test(line)
        || /^#{1,6}\s+/.test(line)
        || /^\s*(```|~~~)/.test(line)
        || /^\s*>\s?/.test(line)
        || /^\s*(?:[-+*]|\d+[.)])\s+/.test(line)
        || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)
        || (line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(nextLine));
}

function renderMarkdownTableNative(lines, startIndex) {
    const headerLine = lines[startIndex];
    const separatorLine = lines[startIndex + 1] || '';
    if (!headerLine.includes('|') || !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(separatorLine)) return null;

    const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
    const headers = splitRow(headerLine);
    const alignments = splitRow(separatorLine).map(cell => {
        const left = cell.startsWith(':');
        const right = cell.endsWith(':');
        if (left && right) return 'center';
        if (right) return 'right';
        return 'left';
    });
    const rows = [];
    let index = startIndex + 2;
    while (index < lines.length && lines[index].includes('|') && !/^\s*$/.test(lines[index])) {
        rows.push(splitRow(lines[index]));
        index += 1;
    }

    const renderCells = (cells, tag) => cells.map((cell, cellIndex) => {
        const align = alignments[cellIndex] || 'left';
        return `<${tag} style="text-align:${align}">${renderMarkdownInlineNative(cell)}</${tag}>`;
    }).join('');

    const html = `<table><thead><tr>${renderCells(headers, 'th')}</tr></thead><tbody>${rows.map(row => `<tr>${renderCells(row, 'td')}</tr>`).join('')}</tbody></table>`;
    return { html, nextIndex: index };
}

function renderMarkdownToNativeHtml(markdown) {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
        const line = lines[index];
        if (/^\s*$/.test(line)) {
            index += 1;
            continue;
        }

        const fenceMatch = line.match(/^\s*(```|~~~)\s*([^`]*)\s*$/);
        if (fenceMatch) {
            const fence = fenceMatch[1];
            const language = (fenceMatch[2] || '').trim().split(/\s+/)[0];
            const codeLines = [];
            index += 1;
            while (index < lines.length && !lines[index].startsWith(fence)) {
                codeLines.push(lines[index]);
                index += 1;
            }
            if (index < lines.length) index += 1;
            const className = language ? ` class="language-${escapeHtml(language)}"` : '';
            blocks.push(`<pre><code${className}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
            continue;
        }

        const table = renderMarkdownTableNative(lines, index);
        if (table) {
            blocks.push(table.html);
            index = table.nextIndex;
            continue;
        }

        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            blocks.push(`<h${level}>${renderMarkdownInlineNative(headingMatch[2].replace(/\s+#+\s*$/, ''))}</h${level}>`);
            index += 1;
            continue;
        }

        if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
            blocks.push('<hr>');
            index += 1;
            continue;
        }

        if (/^\s*>\s?/.test(line)) {
            const quoteLines = [];
            while (index < lines.length && (/^\s*>\s?/.test(lines[index]) || /^\s*$/.test(lines[index]))) {
                quoteLines.push(lines[index].replace(/^\s*>\s?/, ''));
                index += 1;
            }
            blocks.push(`<blockquote>${renderMarkdownToNativeHtml(quoteLines.join('\n'))}</blockquote>`);
            continue;
        }

        const listMatch = line.match(/^\s*((?:[-+*])|(?:\d+[.)]))\s+(.+)$/);
        if (listMatch) {
            const ordered = /\d/.test(listMatch[1]);
            const tag = ordered ? 'ol' : 'ul';
            const items = [];
            while (index < lines.length) {
                const itemMatch = lines[index].match(/^\s*((?:[-+*])|(?:\d+[.)]))\s+(.+)$/);
                if (!itemMatch || /\d/.test(itemMatch[1]) !== ordered) break;
                let itemText = itemMatch[2];
                let checkbox = '';
                const taskMatch = itemText.match(/^\[( |x|X)\]\s+(.+)$/);
                if (taskMatch) {
                    checkbox = `<input type="checkbox" disabled${taskMatch[1].toLowerCase() === 'x' ? ' checked' : ''}> `;
                    itemText = taskMatch[2];
                }
                items.push(`<li>${checkbox}${renderMarkdownInlineNative(itemText)}</li>`);
                index += 1;
            }
            blocks.push(`<${tag}>${items.join('')}</${tag}>`);
            continue;
        }

        const paragraphLines = [line];
        index += 1;
        while (index < lines.length && !isMarkdownBlockStart(lines[index], lines[index + 1] || '')) {
            paragraphLines.push(lines[index]);
            index += 1;
        }
        blocks.push(`<p>${renderMarkdownInlineNative(paragraphLines.join('\n'))}</p>`);
    }

    return blocks.join('\n');
}

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
    queueBtn: document.getElementById('queueBtn'),
    attachmentPreview: document.getElementById('attachmentPreview'), chatHeaderTitle: document.getElementById('chatHeaderTitle'),
    inputPrefixBadge: document.getElementById('inputPrefixBadge'), sidebar: document.getElementById('sidebar'),
    sidebarBackdrop: document.getElementById('sidebarBackdrop'), htmlStyleSelect: document.getElementById('htmlStyleSelect'),
    mainChat: document.querySelector('.main-chat'),
    settingsBackdrop: document.getElementById('settingsBackdrop'),
    contextMenu: document.getElementById('contextMenu'), filterThinkToggle: document.getElementById('filterThinkToggle'),
    exportRoleSelect: document.getElementById('exportRoleSelect'),
    chatSettingsBackdrop: document.getElementById('chatSettingsBackdrop'),
    chatSettingsContainer: document.getElementById('chatSettingsContainer'),
    chatMaxTokensInput: document.getElementById('chatMaxTokensInput'),
    chatTemperatureRange: document.getElementById('chatTemperatureRange'),
    chatTemperatureDisplay: document.getElementById('chatTemperatureDisplay'),
    chatStreamToggle: document.getElementById('chatStreamToggle')
};

const customSelects = new Map();

function escapeAttr(value) {
    return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function buildCustomSelect(select) {
    if (!select || customSelects.has(select)) return;
    const custom = document.createElement('div');
    custom.className = 'custom-select';
    custom.innerHTML = '<button type="button" class="custom-select-trigger" aria-haspopup="listbox" aria-expanded="false"><span></span><svg viewBox="0 0 24 24"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg></button><div class="custom-select-menu" role="listbox"></div>';
    select.classList.add('native-select');
    select.insertAdjacentElement('afterend', custom);
    customSelects.set(select, custom);

    custom.querySelector('.custom-select-trigger').addEventListener('click', (event) => {
        event.stopPropagation();
        const isOpen = custom.classList.contains('open');
        closeCustomSelects();
        if (!isOpen) {
            custom.classList.add('open');
            custom.querySelector('.custom-select-trigger').setAttribute('aria-expanded', 'true');
        }
    });

    refreshCustomSelect(select);
}

function refreshCustomSelect(select) {
    const custom = customSelects.get(select);
    if (!custom) return;
    const selected = select.options[select.selectedIndex] || select.options[0];
    custom.querySelector('.custom-select-trigger span').textContent = selected ? selected.textContent : '请选择';
    custom.querySelector('.custom-select-menu').innerHTML = Array.from(select.options).map(option => {
        const active = option.value === select.value ? ' active' : '';
        return `<button type="button" class="custom-select-option${active}" role="option" aria-selected="${active ? 'true' : 'false'}" data-value="${escapeAttr(option.value)}">${escapeAttr(option.textContent)}</button>`;
    }).join('');
    custom.querySelectorAll('.custom-select-option').forEach(optionBtn => {
        optionBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            select.value = optionBtn.dataset.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            refreshCustomSelect(select);
            closeCustomSelects();
        });
    });
}

function refreshAllCustomSelects() {
    customSelects.forEach((_, select) => refreshCustomSelect(select));
}

function closeCustomSelects() {
    customSelects.forEach(custom => {
        custom.classList.remove('open');
        custom.querySelector('.custom-select-trigger').setAttribute('aria-expanded', 'false');
    });
}

function initCustomSelects() {
    document.querySelectorAll('.settings-panel select').forEach(buildCustomSelect);
}

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
    initCustomSelects();

    if (state.chats.length === 0) createNewChat(false);
    else {
        if (!state.currentChatId || !state.chats.find(c => c.id === state.currentChatId)) state.currentChatId = state.chats[0].id;
        renderChatList(); renderMessages();
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
}

function throttle(fn, delay) {
    let timer = null;
    return (...args) => {
        if (timer) return;
        timer = setTimeout(() => { timer = null; fn(...args); }, delay);
    };
}

function keepMobileComposerVisible() {
    if (window.innerWidth > 768) return;
    const vv = window.visualViewport;
    if (vv) {
        document.documentElement.style.height = vv.height + 'px';
    }
    requestAnimationFrame(() => {
        document.querySelector('.input-wrapper')?.scrollIntoView({ block: 'end', inline: 'nearest' });
    });
}
const throttledKeepMobileVisible = throttle(keepMobileComposerVisible, 100);

function openSettings() {
    closeSidebar();
    DOM.settingsBackdrop.classList.add('show');
    DOM.settingsContainer.classList.add('show');
    DOM.settingsContainer.setAttribute('aria-hidden', 'false');
}
function closeSettings() {
    DOM.settingsContainer.classList.remove('show');
    DOM.settingsContainer.setAttribute('aria-hidden', 'true');
    DOM.settingsBackdrop.classList.remove('show');
    closeCustomSelects();
}
function toggleSettings() { DOM.settingsContainer.classList.contains('show') ? closeSettings() : openSettings(); }
function toggleSidebar() { DOM.sidebar.classList.toggle('open'); DOM.sidebarBackdrop.classList.toggle('show'); }
function closeSidebar() { DOM.sidebar.classList.remove('open'); DOM.sidebarBackdrop.classList.remove('show'); }
let _saveTimer = null;
function _saveStateSync() {
    const clean = state.chats.map(c => ({ ...c, messages: c.messages.map(m => {
        const { _lastRenderedContent, ...rest } = m;
        return rest;
    }) }));
    localStorage.setItem('ai_chats', JSON.stringify(clean));
    localStorage.setItem('ai_current_chat_id', state.currentChatId);
}
function saveState() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        _saveTimer = null;
        _saveStateSync();
    }, 50);
}

let _saveSettingsTimer = null;
function saveSettings() {
    state.apiKey = DOM.apiKeyInput.value.trim(); state.selectedModel = DOM.modelSelect.value;
    state.titleModel = DOM.titleModelSelect.value; 
    state.systemPrompt = DOM.systemPromptInput.value.trim();
    state.userPrefix = DOM.userPrefixInput.value;
    state.selectedPreset = DOM.presetSelect.value;
    state.htmlStyle = DOM.htmlStyleSelect.value;
    state.filterThink = DOM.filterThinkToggle.checked;
    state.exportRole = DOM.exportRoleSelect.value;

    if (_saveSettingsTimer) clearTimeout(_saveSettingsTimer);
    _saveSettingsTimer = setTimeout(() => {
        _saveSettingsTimer = null;
        localStorage.setItem('ai_api_key', state.apiKey); localStorage.setItem('ai_selected_model', state.selectedModel);
        localStorage.setItem('ai_title_model', state.titleModel); localStorage.setItem('ai_system_prompt', state.systemPrompt);
        localStorage.setItem('ai_user_prefix', state.userPrefix); localStorage.setItem('ai_selected_preset', state.selectedPreset);
        localStorage.setItem('ai_html_style', state.htmlStyle); localStorage.setItem('ai_filter_think', state.filterThink);
        localStorage.setItem('ai_export_role', state.exportRole);
        refreshAllCustomSelects();
        updatePrefixBadge();
    }, 100);
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
    if (render) closeSettings();
    const newChat = { id: Date.now().toString(), title: "新对话", messages: [], maxTokens: 0, temperature: 0.7, stream: true };
    state.chats.unshift(newChat); state.currentChatId = newChat.id; state.editingIndex = -1; saveState();
    if (render) { renderChatList(); renderMessages(); DOM.userInput.focus(); }
}

function switchChat(id) { state.currentChatId = id; state.editingIndex = -1; saveState(); renderChatList(); renderMessages(); closeSettings(); closeSidebar(); }

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

function renderMessages() {
    const currentChat = state.chats.find(c => c.id === state.currentChatId);
    if (!currentChat) return;
    DOM.chatHeaderTitle.textContent = currentChat.title || "新对话";

    const msgs = currentChat.messages.filter(m => m.role !== 'system');
    const existingWrappers = DOM.chatMessages.querySelectorAll(':scope > .message-wrapper');
    
    // 增量更新：如果只是末尾追加消息且没有编辑状态，只追加新DOM
    const isAppendOnly = state.editingIndex === -1
        && _lastRenderEditIdx === -1
        && existingWrappers.length > 0
        && msgs.length > existingWrappers.length
        && msgs.slice(0, existingWrappers.length).every((msg, i) => {
            const oldText = msg._lastRenderedContent;
            const newText = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            return oldText === newText;
        });

    if (isAppendOnly) {
        for (let i = existingWrappers.length; i < msgs.length; i++) {
            const domObj = createMessageDOM(msgs[i], i);
            DOM.chatMessages.appendChild(domObj.wrapper);
            // 新消息标记为已渲染
            msgs[i]._lastRenderedContent = typeof msgs[i].content === 'string' ? msgs[i].content : JSON.stringify(msgs[i].content);
        }
    } else {
        DOM.chatMessages.innerHTML = '';
        msgs.forEach((msg, index) => {
            const domObj = createMessageDOM(msg, index);
            DOM.chatMessages.appendChild(domObj.wrapper);
            msg._lastRenderedContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        });
    }
    
    _lastRenderMsgCount = msgs.length;
    _lastRenderEditIdx = state.editingIndex;

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
        }, 30);
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
                await new Promise(r => setTimeout(r, 2000));
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

function renderContentWithThink(content, isStreaming) {
    let mainContent = content || '';
    let thinkHtml = '';
    const thinkSvg = `<svg class="think-icon" viewBox="0 0 24 24" width="16" height="16"><path d="M9.55 17.05 4.9 12.4l1.42-1.42 3.23 3.23 8.13-8.13 1.42 1.42-9.55 9.55Z"/></svg>`;
    const thinkAnimSvg = `<svg class="think-icon thinking" viewBox="0 0 24 24" width="16" height="16"><path d="M11.7 6.1c-.45-1.25-1.55-2.1-2.85-2.1A3.05 3.05 0 0 0 5.8 7.05v.18A3.15 3.15 0 0 0 4 10.05c0 1.02.48 1.92 1.23 2.5A3.28 3.28 0 0 0 8.45 16.5h.85v1.2a1.7 1.7 0 0 0 3.4 0V5.95c0-1.08-.88-1.95-1.95-1.95h-.4m1.35 6.05H9.4m3.3 3.15H9.05m3.25-6.1H9.9m2.4 8.75H9.3m3-9.75c.45-1.25 1.55-2.1 2.85-2.1a3.05 3.05 0 0 1 3.05 3.05v.18A3.15 3.15 0 0 1 20 10.05c0 1.02-.48 1.92-1.23 2.5a3.28 3.28 0 0 1-3.22 3.95h-.85v1.2a1.7 1.7 0 0 1-3.4 0V5.95c0-1.08.88-1.95 1.95-1.95h.4m-1.35 6.05h2.3m-3.3 3.15h3.65m-3.25-6.1h2.4m-2.4 8.75h3" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    
    const thinkMatch = content && content.match(CLOSED_THINK_BLOCK_PATTERN);
    if (thinkMatch) {
        const remainingContent = content.replace(CLOSED_THINK_BLOCK_PATTERN, '').trim();
        const thinkingNow = isStreaming && !remainingContent;
        thinkHtml = `<details class="think-block">
            <summary class="think-summary">${thinkingNow ? thinkAnimSvg : thinkSvg} ${thinkingNow ? '思考中...' : '思考过程'}</summary>
            <div class="think-content markdown-body">${renderMarkdownToHtml(thinkMatch[1])}</div>
        </details>`;
        mainContent = remainingContent;
    } else if (isStreaming) {
        const openThinkMatch = content && content.match(/<\s*thinking?\b[^>]*>/i);
        if (openThinkMatch) {
            const thinkStart = openThinkMatch.index;
            const before = content.slice(0, thinkStart).trim();
            const inThink = content.slice(thinkStart + openThinkMatch[0].length);
            if (inThink) {
                thinkHtml = `<details class="think-block">
                    <summary class="think-summary">${thinkAnimSvg} 思考中...</summary>
                    <div class="think-content markdown-body">${renderMarkdownToHtml(inThink)}</div>
                </details>`;
            }
            mainContent = before;
        }
    }
    const mainHtml = mainContent ? renderMarkdownToHtml(mainContent) : '';
    const replyWrap = thinkHtml && mainHtml ? `<div class="reply-content">${mainHtml}</div>` : mainHtml;
    return thinkHtml + replyWrap;
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
            displayContent = content.replace(CLOSED_THINK_BLOCK_PATTERN_GLOBAL, '').trim();
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
            .export-meta { text-align: center; color: #8b7355; margin: -18px 0 30px; font-size: 0.9em; }
            .conversation { display: block; }
            .msg { display: block; margin: clamp(16px, 2.4vw, 28px) 0; }
            .user { text-align: right; }
            .assistant { text-align: left; }
            .role { font-weight: 700; margin-bottom: 8px; font-size: clamp(12px, 1.4vw, 14px); color: #8b6914; }
            .assistant .role { color: #6b8e23; }
            .content { line-height: 1.8; font-weight: 500; }
            .content p, .content ul, .content ol, .content blockquote, .content pre, .content table { margin: 0.75em 0; }
            .content h1, .content h2, .content h3, .content h4, .content h5, .content h6 { margin: 1em 0 0.45em; color: #6f5515; line-height: 1.35; }
            .content ul, .content ol { padding-left: 1.5em; }
            .content img { max-width: 100%; height: auto; border-radius: 6px; }
            table { width: 100%; border-collapse: collapse; overflow-wrap: anywhere; }
            th, td { border: 1px solid #d8c8aa; padding: 8px 10px; }
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
            .export-meta { color: #57606a; margin: -6px 0 24px; }
            .conversation { display: block; }
            .msg { display: block; margin: 12px 0; padding: 16px; border-radius: 8px; }
            .user { background: #f6f8fa; text-align: right; }
            .user .role { text-align: left; }
            .assistant { background: #fff; }
            .role { font-weight: 600; margin-bottom: 8px; color: #0366d6; }
            .content { line-height: 1.6; text-align: left; max-width: 85%; }
            .content p, .content ul, .content ol, .content blockquote, .content pre, .content table { margin: 0.75em 0; }
            .content h1, .content h2, .content h3, .content h4, .content h5, .content h6 { margin: 1em 0 0.45em; line-height: 1.35; }
            .content ul, .content ol { padding-left: 1.5em; }
            .content img { max-width: 100%; height: auto; border-radius: 6px; }
            table { width: 100%; border-collapse: collapse; overflow-wrap: anywhere; }
            th, td { border: 1px solid #d0d7de; padding: 8px 10px; }
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
            displayContent = displayContent.replace(CLOSED_THINK_BLOCK_PATTERN_GLOBAL, '').trim();
        }
        
        if (!displayContent) return;
        
        const roleLabel = msg.role === 'user' ? '用户' : '助手';
        const messageHtml = renderMarkdownToNativeHtml(displayContent);
        const labelId = `message-${messagesHtml.length}-${msg.role}`;

        if (msg.role === 'user') {
            messagesHtml += '<section class="msg user" aria-labelledby="' + labelId + '"><h2 class="role" id="' + labelId + '">' + roleLabel + '</h2><div class="content">' + messageHtml + '</div></section>';
        } else if (msg.role === 'assistant') {
            messagesHtml += '<section class="msg assistant" aria-labelledby="' + labelId + '"><h2 class="role" id="' + labelId + '">' + roleLabel + '</h2><div class="content">' + messageHtml + '</div></section>';
        }
    });
    
    const title = (chat.title || '新对话').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
    const exportDate = new Date().toLocaleString('zh-CN');
    const html = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <meta name="description" content="AI 对话记录：' + title + '">\n    <meta name="generator" content="Fimall Chat">\n    <title>' + title + '</title>\n    <style>' + css + '</style>\n</head>\n<body class="' + bodyClass + '">\n    <main>\n        <article class="reader-article">\n            <header>\n                <h1>' + title + '</h1>\n                <p class="export-meta">导出时间：<time datetime="' + new Date().toISOString() + '">' + escapeHtml(exportDate) + '</time></p>\n            </header>\n            <section class="conversation" aria-label="对话内容">\n                ' + messagesHtml + '\n            </section>\n        </article>\n    </main>\n</body>\n</html>';
    
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

// 聊天设置功能
function openChatSettings() {
    DOM.contextMenu.style.display = 'none';
    const chat = state.chats.find(c => c.id === contextMenuChatId);
    if (!chat) return;

    DOM.chatMaxTokensInput.value = chat.maxTokens || 0;
    DOM.chatTemperatureRange.value = chat.temperature !== undefined ? chat.temperature : 0.7;
    DOM.chatTemperatureDisplay.textContent = DOM.chatTemperatureRange.value;
    DOM.chatStreamToggle.checked = chat.stream !== false;

    DOM.chatSettingsBackdrop.classList.add('show');
    DOM.chatSettingsContainer.classList.add('show');
    DOM.chatSettingsContainer.setAttribute('aria-hidden', 'false');
}

function closeChatSettings() {
    DOM.chatSettingsContainer.classList.remove('show');
    DOM.chatSettingsContainer.setAttribute('aria-hidden', 'true');
    DOM.chatSettingsBackdrop.classList.remove('show');
}

function updateChatTemperatureDisplay() {
    DOM.chatTemperatureDisplay.textContent = DOM.chatTemperatureRange.value;
    saveChatSettings();
}

function saveChatSettings() {
    const chat = state.chats.find(c => c.id === contextMenuChatId);
    if (!chat) return;
    chat.maxTokens = parseInt(DOM.chatMaxTokensInput.value) || 0;
    chat.temperature = parseFloat(DOM.chatTemperatureRange.value);
    chat.stream = DOM.chatStreamToggle.checked;
    saveState();
}

// 点击其他地方关闭右键菜单
document.addEventListener('click', (e) => {
    if (DOM.contextMenu) DOM.contextMenu.style.display = 'none';
    closeCustomSelects();
    if (DOM.chatSettingsContainer && DOM.chatSettingsContainer.classList.contains('show') && !DOM.chatSettingsContainer.contains(e.target) && !e.target.closest('.context-menu-item')) {
        closeChatSettings();
    }
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

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((error) => {
            console.warn('Service worker registration failed:', error);
        });
    });
}

DOM.userInput.addEventListener('input', function() { this.style.height = '52px'; this.style.height = (this.scrollHeight) + 'px'; if (this.value === '') this.style.height = '52px'; });
registerServiceWorker();

// 页面关闭前刷新待处理的存储
window.addEventListener('beforeunload', () => {
    if (_saveTimer) { clearTimeout(_saveTimer); _saveStateSync(); }
    if (_saveSettingsTimer) { clearTimeout(_saveSettingsTimer); localStorage.setItem('ai_api_key', state.apiKey); localStorage.setItem('ai_selected_model', state.selectedModel); localStorage.setItem('ai_title_model', state.titleModel); localStorage.setItem('ai_system_prompt', state.systemPrompt); localStorage.setItem('ai_user_prefix', state.userPrefix); localStorage.setItem('ai_selected_preset', state.selectedPreset); localStorage.setItem('ai_html_style', state.htmlStyle); localStorage.setItem('ai_filter_think', state.filterThink); localStorage.setItem('ai_export_role', state.exportRole); }
});

// 标签页切换恢复
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
        if (_saveTimer) { clearTimeout(_saveTimer); _saveStateSync(); }
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

init();
