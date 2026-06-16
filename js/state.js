let abortController = null;
let messageQueue = [];
let isProcessingQueue = false;
let autoScroll = true;
let contextMenuChatId = null;

let state = {
    apiKey: localStorage.getItem('ai_api_key') || '', selectedModel: localStorage.getItem('ai_selected_model') || '',
    titleModel: localStorage.getItem('ai_title_model') || '',
    refuseModel: localStorage.getItem('ai_refuse_model') || '',
    systemPrompt: localStorage.getItem('ai_system_prompt') || '',
    userPrefix: localStorage.getItem('ai_user_prefix') || '',
    selectedPreset: localStorage.getItem('ai_selected_preset') || 'custom',
    htmlStyle: localStorage.getItem('ai_html_style') || 'autumn',
    filterMode: localStorage.getItem('ai_filter_mode') || (localStorage.getItem('ai_filter_think') !== 'false' ? 'think' : 'none'),
    exportRole: localStorage.getItem('ai_export_role') || 'both',
    chats: [], currentChatId: localStorage.getItem('ai_current_chat_id') || null,
    attachment: null, editingIndex: -1
};

const DOM = {};

function initDOM() {
    Object.assign(DOM, {
        chatList: document.getElementById('chatList'), chatMessages: document.getElementById('chatMessages'),
        userInput: document.getElementById('userInput'), apiKeyInput: document.getElementById('apiKeyInput'),
        modelSelect: document.getElementById('modelSelect'), titleModelSelect: document.getElementById('titleModelSelect'),
        refuseModelSelect: document.getElementById('refuseModelSelect'),
        presetSelect: document.getElementById('presetSelect'), systemPromptInput: document.getElementById('systemPromptInput'),
        userPrefixInput: document.getElementById('userPrefixInput'), sendBtn: document.getElementById('sendBtn'),
        settingsContainer: document.getElementById('settingsContainer'),
        queueBtn: document.getElementById('queueBtn'),
        attachmentPreview: document.getElementById('attachmentPreview'), chatHeaderTitle: document.getElementById('chatHeaderTitle'),
        inputPrefixBadge: document.getElementById('inputPrefixBadge'), sidebar: document.getElementById('sidebar'),
        sidebarBackdrop: document.getElementById('sidebarBackdrop'), htmlStyleSelect: document.getElementById('htmlStyleSelect'),
        mainChat: document.querySelector('.main-chat'),
        settingsBackdrop: document.getElementById('settingsBackdrop'),
        contextMenu: document.getElementById('contextMenu'), filterModeSelect: document.getElementById('filterModeSelect'),
        exportRoleSelect: document.getElementById('exportRoleSelect'),
        chatSettingsBackdrop: document.getElementById('chatSettingsBackdrop'),
        chatSettingsContainer: document.getElementById('chatSettingsContainer'),
        chatMaxTokensInput: document.getElementById('chatMaxTokensInput'),
        chatContextLimitInput: document.getElementById('chatContextLimitInput'),
        chatTemperatureRange: document.getElementById('chatTemperatureRange'),
        chatTemperatureDisplay: document.getElementById('chatTemperatureDisplay'),
        chatStreamToggle: document.getElementById('chatStreamToggle'),
        trimBadge: document.getElementById('trimBadge'),
        chatTokenCounter: document.getElementById('chatTokenCounter'),
        searchBar: document.getElementById('searchBar'),
        ctxDrop20Label: document.getElementById('ctxDrop20Label'),
        ctxDrop20IconOn: document.getElementById('ctxDrop20IconOn'),
        ctxDrop20IconOff: document.getElementById('ctxDrop20IconOff'),
        ctxAutoFixLabel: document.getElementById('ctxAutoFixLabel'),
        ctxAutoFixIconOn: document.getElementById('ctxAutoFixIconOn'),
        ctxAutoFixIconOff: document.getElementById('ctxAutoFixIconOff'),
        ctxAutoRetryRefuseLabel: document.getElementById('ctxAutoRetryRefuseLabel'),
        ctxAutoRetryRefuseIconOn: document.getElementById('ctxAutoRetryRefuseIconOn'),
        ctxAutoRetryRefuseIconOff: document.getElementById('ctxAutoRetryRefuseIconOff'),
        themeSelect: document.getElementById('themeSelect')
    });
}

let _saveTimer = null;
function _saveStateSync() {
    const clean = state.chats.map(c => ({ ...c, messages: c.messages.map(m => {
        const { _lastRenderedContent, _lastRenderedVersion, _renderVersion, ...rest } = m;
        return rest;
    }) }));
    saveAllChats(clean).catch(e => console.warn('IndexedDB save failed:', e));
    localStorage.setItem('ai_current_chat_id', state.currentChatId);
    try {
        localStorage.setItem('ai_chats', JSON.stringify(clean));
    } catch (e) {}
}

function saveState() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        _saveTimer = null;
        _saveStateSync();
    }, 50);
}

async function loadChatsFromDB() {
    try {
        const chats = await getAllChats();
        if (chats && chats.length > 0) {
            state.chats = chats;
            return;
        }
    } catch (e) {
        console.warn('IndexedDB load failed:', e);
    }
    const lsData = localStorage.getItem('ai_chats');
    if (lsData) {
        try {
            const parsed = JSON.parse(lsData);
            if (Array.isArray(parsed) && parsed.length > 0) {
                state.chats = parsed;
                const clean = parsed.map(c => ({ ...c, messages: c.messages.map(m => {
                    const { _lastRenderedContent, _lastRenderedVersion, _renderVersion, ...rest } = m;
                    return rest;
                }) }));
                saveAllChats(clean).catch(e => console.warn('IndexedDB migration save failed:', e));
                localStorage.removeItem('ai_chats');
            }
        } catch (e) {}
    }
}

let _saveSettingsTimer = null;
function saveSettings() {
    state.apiKey = DOM.apiKeyInput.value.trim(); state.selectedModel = DOM.modelSelect.value;
    state.titleModel = DOM.titleModelSelect.value;
    state.refuseModel = DOM.refuseModelSelect.value;
    state.systemPrompt = DOM.systemPromptInput.value.trim();
    state.userPrefix = DOM.userPrefixInput.value;
    state.selectedPreset = DOM.presetSelect.value;
    state.htmlStyle = DOM.htmlStyleSelect.value;
    state.filterMode = DOM.filterModeSelect.value;
    state.exportRole = DOM.exportRoleSelect.value;

    if (_saveSettingsTimer) clearTimeout(_saveSettingsTimer);
    _saveSettingsTimer = setTimeout(() => {
        _saveSettingsTimer = null;
        localStorage.setItem('ai_api_key', state.apiKey); localStorage.setItem('ai_selected_model', state.selectedModel);
        localStorage.setItem('ai_title_model', state.titleModel); localStorage.setItem('ai_refuse_model', state.refuseModel);
        localStorage.setItem('ai_system_prompt', state.systemPrompt);
        localStorage.setItem('ai_user_prefix', state.userPrefix); localStorage.setItem('ai_selected_preset', state.selectedPreset);
        localStorage.setItem('ai_html_style', state.htmlStyle); localStorage.setItem('ai_filter_mode', state.filterMode);
        localStorage.setItem('ai_export_role', state.exportRole);
        refreshAllCustomSelects();
        updatePrefixBadge();
        updateTrimIndicator();
    }, 100);
}

function flushPendingSettingsSave() {
    if (_saveSettingsTimer) {
        clearTimeout(_saveSettingsTimer);
        _saveSettingsTimer = null;
        localStorage.setItem('ai_api_key', state.apiKey);
        localStorage.setItem('ai_selected_model', state.selectedModel);
        localStorage.setItem('ai_title_model', state.titleModel);
        localStorage.setItem('ai_refuse_model', state.refuseModel);
        localStorage.setItem('ai_system_prompt', state.systemPrompt);
        localStorage.setItem('ai_user_prefix', state.userPrefix);
        localStorage.setItem('ai_selected_preset', state.selectedPreset);
        localStorage.setItem('ai_html_style', state.htmlStyle);
        localStorage.setItem('ai_filter_mode', state.filterMode);
        localStorage.setItem('ai_export_role', state.exportRole);
    }
}

async function flushPendingStateSave() {
    if (_saveTimer) {
        clearTimeout(_saveTimer);
        _saveTimer = null;
        _saveStateSync();
        await new Promise(r => setTimeout(r, 100));
    }
}
