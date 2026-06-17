let abortController = null;
let messageQueue = [];
let isProcessingQueue = false;
let autoScroll = true;
let contextMenuChatId = null;

let state = {
    apiKey: '', selectedModel: '',
    titleModel: '',
    refuseModel: '',
    systemPrompt: '',
    userPrefix: '',
    selectedPreset: 'custom',
    htmlStyle: 'autumn',
    filterMode: 'think',
    exportRole: 'both',
    theme: 'system',
    chats: [], currentChatId: null,
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
    saveSettingsToDB(getPersistedSettings()).catch(e => console.warn('IndexedDB settings save failed:', e));
}

function saveState() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        _saveTimer = null;
        _saveStateSync();
    }, 50);
}

async function migrateLegacyChats() {
    const lsData = localStorage.getItem('ai_chats');
    if (!lsData) return;
    try {
        const parsed = JSON.parse(lsData);
        if (Array.isArray(parsed) && parsed.length > 0) {
            const clean = parsed.map(c => ({ ...c, messages: c.messages.map(m => {
                const { _lastRenderedContent, _lastRenderedVersion, _renderVersion, ...rest } = m;
                return rest;
            }) }));
            state.chats = clean;
            await saveAllChats(clean);
        }
    } catch (e) {
        console.warn('Legacy chats migration failed:', e);
    }
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
    await migrateLegacyChats();
}

function applyLoadedSettings(settings) {
    Object.assign(state, {
        apiKey: settings.apiKey || '',
        selectedModel: settings.selectedModel || '',
        titleModel: settings.titleModel || '',
        refuseModel: settings.refuseModel || '',
        systemPrompt: settings.systemPrompt || '',
        userPrefix: settings.userPrefix || '',
        selectedPreset: settings.selectedPreset || 'custom',
        htmlStyle: settings.htmlStyle || 'autumn',
        filterMode: settings.filterMode || 'think',
        exportRole: settings.exportRole || 'both',
        theme: settings.theme || 'system',
        currentChatId: settings.currentChatId || null
    });
}

const LEGACY_STORAGE_KEYS = [
    'ai_api_key', 'ai_selected_model', 'ai_title_model', 'ai_refuse_model',
    'ai_system_prompt', 'ai_user_prefix', 'ai_selected_preset', 'ai_html_style',
    'ai_filter_mode', 'ai_filter_think', 'ai_export_role', 'ai_current_chat_id',
    'ai_theme', 'ai_chats'
];

function getLegacySettings() {
    const filterMode = localStorage.getItem('ai_filter_mode') || (localStorage.getItem('ai_filter_think') !== 'false' ? 'think' : 'none');
    return {
        apiKey: localStorage.getItem('ai_api_key') || '',
        selectedModel: localStorage.getItem('ai_selected_model') || '',
        titleModel: localStorage.getItem('ai_title_model') || '',
        refuseModel: localStorage.getItem('ai_refuse_model') || '',
        systemPrompt: localStorage.getItem('ai_system_prompt') || '',
        userPrefix: localStorage.getItem('ai_user_prefix') || '',
        selectedPreset: localStorage.getItem('ai_selected_preset') || 'custom',
        htmlStyle: localStorage.getItem('ai_html_style') || 'autumn',
        filterMode,
        exportRole: localStorage.getItem('ai_export_role') || 'both',
        theme: localStorage.getItem('ai_theme') || 'system',
        currentChatId: localStorage.getItem('ai_current_chat_id') || null
    };
}

function clearLegacyStorage() {
    for (const key of LEGACY_STORAGE_KEYS) {
        localStorage.removeItem(key);
    }
}

function hasLegacyStorage() {
    return LEGACY_STORAGE_KEYS.some(key => localStorage.getItem(key) !== null);
}

async function loadSettingsFromDB() {
    try {
        const settings = await getSettings();
        const hasSettings = Object.keys(settings).length > 0;
        if (hasSettings) {
            applyLoadedSettings(settings);
        } else if (hasLegacyStorage()) {
            const legacy = getLegacySettings();
            applyLoadedSettings(legacy);
            await saveSettingsToDB(legacy);
        }
    } catch (e) {
        console.warn('IndexedDB settings load failed:', e);
    }
}

function getPersistedSettings() {
    return {
        apiKey: state.apiKey,
        selectedModel: state.selectedModel,
        titleModel: state.titleModel,
        refuseModel: state.refuseModel,
        systemPrompt: state.systemPrompt,
        userPrefix: state.userPrefix,
        selectedPreset: state.selectedPreset,
        htmlStyle: state.htmlStyle,
        filterMode: state.filterMode,
        exportRole: state.exportRole,
        theme: state.theme,
        currentChatId: state.currentChatId
    };
}

let _saveSettingsTimer = null;
function persistSettings() {
    saveSettingsToDB(getPersistedSettings()).catch(e => console.warn('IndexedDB settings save failed:', e));
    if (_saveSettingsTimer) clearTimeout(_saveSettingsTimer);
    _saveSettingsTimer = setTimeout(() => {
        _saveSettingsTimer = null;
        refreshAllCustomSelects();
        updatePrefixBadge();
        updateTrimIndicator();
    }, 100);
}

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

    persistSettings();
}

function flushPendingSettingsSave() {
    if (_saveSettingsTimer) {
        clearTimeout(_saveSettingsTimer);
        _saveSettingsTimer = null;
        refreshAllCustomSelects();
        updatePrefixBadge();
        updateTrimIndicator();
    }
    saveSettingsToDB(getPersistedSettings()).catch(e => console.warn('IndexedDB settings save failed:', e));
}

async function flushPendingStateSave() {
    if (_saveTimer) {
        clearTimeout(_saveTimer);
        _saveTimer = null;
        _saveStateSync();
        await new Promise(r => setTimeout(r, 100));
    }
}
