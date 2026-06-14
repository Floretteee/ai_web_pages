let abortController = null;
let messageQueue = [];
let isProcessingQueue = false;
let autoScroll = true;
let contextMenuChatId = null;

let state = {
    apiKey: localStorage.getItem('ai_api_key') || '', selectedModel: localStorage.getItem('ai_selected_model') || '',
    titleModel: localStorage.getItem('ai_title_model') || '',
    systemPrompt: localStorage.getItem('ai_system_prompt') || '',
    userPrefix: localStorage.getItem('ai_user_prefix') || '',
    selectedPreset: localStorage.getItem('ai_selected_preset') || 'custom',
    htmlStyle: localStorage.getItem('ai_html_style') || 'autumn',
    filterMode: localStorage.getItem('ai_filter_mode') || (localStorage.getItem('ai_filter_think') !== 'false' ? 'think' : 'none'),
    exportRole: localStorage.getItem('ai_export_role') || 'both',
    chats: JSON.parse(localStorage.getItem('ai_chats')) || [], currentChatId: localStorage.getItem('ai_current_chat_id') || null,
    attachment: null, editingIndex: -1
};

const DOM = {};

function initDOM() {
    Object.assign(DOM, {
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
        contextMenu: document.getElementById('contextMenu'), filterModeSelect: document.getElementById('filterModeSelect'),
        exportRoleSelect: document.getElementById('exportRoleSelect'),
        chatSettingsBackdrop: document.getElementById('chatSettingsBackdrop'),
        chatSettingsContainer: document.getElementById('chatSettingsContainer'),
        chatMaxTokensInput: document.getElementById('chatMaxTokensInput'),
        chatTemperatureRange: document.getElementById('chatTemperatureRange'),
        chatTemperatureDisplay: document.getElementById('chatTemperatureDisplay'),
        chatStreamToggle: document.getElementById('chatStreamToggle')
    });
}

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
    state.filterMode = DOM.filterModeSelect.value;
    state.exportRole = DOM.exportRoleSelect.value;

    if (_saveSettingsTimer) clearTimeout(_saveSettingsTimer);
    _saveSettingsTimer = setTimeout(() => {
        _saveSettingsTimer = null;
        localStorage.setItem('ai_api_key', state.apiKey); localStorage.setItem('ai_selected_model', state.selectedModel);
        localStorage.setItem('ai_title_model', state.titleModel); localStorage.setItem('ai_system_prompt', state.systemPrompt);
        localStorage.setItem('ai_user_prefix', state.userPrefix); localStorage.setItem('ai_selected_preset', state.selectedPreset);
        localStorage.setItem('ai_html_style', state.htmlStyle); localStorage.setItem('ai_filter_mode', state.filterMode);
        localStorage.setItem('ai_export_role', state.exportRole);
        refreshAllCustomSelects();
        updatePrefixBadge();
    }, 100);
}

function flushPendingSettingsSave() {
    if (_saveSettingsTimer) {
        clearTimeout(_saveSettingsTimer);
        _saveSettingsTimer = null;
        localStorage.setItem('ai_api_key', state.apiKey);
        localStorage.setItem('ai_selected_model', state.selectedModel);
        localStorage.setItem('ai_title_model', state.titleModel);
        localStorage.setItem('ai_system_prompt', state.systemPrompt);
        localStorage.setItem('ai_user_prefix', state.userPrefix);
        localStorage.setItem('ai_selected_preset', state.selectedPreset);
        localStorage.setItem('ai_html_style', state.htmlStyle);
        localStorage.setItem('ai_filter_mode', state.filterMode);
        localStorage.setItem('ai_export_role', state.exportRole);
    }
}

function flushPendingStateSave() {
    if (_saveTimer) {
        clearTimeout(_saveTimer);
        _saveTimer = null;
        _saveStateSync();
    }
}
