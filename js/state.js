let abortController = null;
let messageQueue = [];
let isProcessingQueue = false;
let isSendingMessage = false;
let queuePauseReason = null;
let queuePaused = false;
let failedQueueItem = null;
const QUEUE_STORAGE_KEY = 'ai_message_queue_v2';

function syncQueuePaused() {
    queuePaused = queuePauseReason !== null;
}

let _queuePersistWarningShown = false;
function persistQueueState() {
    syncQueuePaused();
    try {
        localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify({
            queue: messageQueue,
            pauseReason: queuePauseReason,
            failedItem: failedQueueItem
        }));
        return true;
    } catch (e) {
        console.warn('Queue persistence failed:', e);
        if (!_queuePersistWarningShown) {
            _queuePersistWarningShown = true;
            if (typeof showToast === 'function') showToast('队列保存失败，附件可能过大；刷新页面可能丢失待发送消息');
        }
        return false;
    }
}

function restoreQueueState() {
    try {
        const saved = JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) || 'null');
        if (!saved || !Array.isArray(saved.queue)) return;
        const validChatIds = new Set(state.chats.map(chat => chat.id));
        messageQueue = saved.queue
            .map(item => normalizeQueueItem(item, state.currentChatId))
            .filter(item => item && validChatIds.has(item.chatId));
        failedQueueItem = saved.failedItem ? normalizeQueueItem(saved.failedItem, state.currentChatId) : null;
        if (failedQueueItem && !validChatIds.has(failedQueueItem.chatId)) failedQueueItem = null;
        if (failedQueueItem) {
            const chat = state.chats.find(c => c.id === failedQueueItem.chatId);
            const hasMarker = chat && chat.messages.some(m => m._queueItemId === failedQueueItem.id);
            if (!hasMarker) {
                if (failedQueueItem.userAppended && typeof showToast === 'function') showToast('旧版暂停消息缺少重试标记，将按未写入消息处理');
                failedQueueItem.userAppended = false;
            }
            messageQueue = messageQueue.filter(item => item.id !== failedQueueItem.id);
        }
        queuePauseReason = saved.pauseReason === 'failure' && failedQueueItem ? 'failure' :
            (saved.pauseReason === 'user' || messageQueue.length || failedQueueItem ? 'user' : null);
        syncQueuePaused();
        persistQueueState();
    } catch (e) {
        console.warn('Queue restore failed:', e);
        messageQueue = [];
        queuePauseReason = null;
        failedQueueItem = null;
        syncQueuePaused();
        if (typeof showToast === 'function') showToast('队列恢复失败，已忽略损坏的队列数据');
    }
}
let autoScroll = true;
let contextMenuChatId = null;

let state = {
    apiKey: '', selectedModel: '',
    titleModel: '',
    refuseModel: '',
    polishModel: '',
    htmlStyle: 'autumn',
    filterMode: 'think',
    exportRole: 'both',
    theme: 'system',
    maxAttachmentMB: 5,
    ttsEnabled: true,
    ttsVoice: 'zh-CN-XiaoxiaoNeural',
    chats: [], currentChatId: null,
    attachments: [], editingIndex: -1
};

const DOM = {};

function initDOM() {
    Object.assign(DOM, {
        chatList: document.getElementById('chatList'), chatMessages: document.getElementById('chatMessages'),
        userInput: document.getElementById('userInput'), apiKeyInput: document.getElementById('apiKeyInput'),
        modelSelect: document.getElementById('modelSelect'), titleModelSelect: document.getElementById('titleModelSelect'),
        refuseModelSelect: document.getElementById('refuseModelSelect'),
        sendBtn: document.getElementById('sendBtn'),
        settingsContainer: document.getElementById('settingsContainer'),
        queueBtn: document.getElementById('queueBtn'),
        attachmentPreview: document.getElementById('attachmentPreview'), chatHeaderTitle: document.getElementById('chatHeaderTitle'),
        inputPrefixBadge: document.getElementById('inputPrefixBadge'), sidebar: document.getElementById('sidebar'),
        sidebarBackdrop: document.getElementById('sidebarBackdrop'), htmlStyleSelect: document.getElementById('htmlStyleSelect'),
        mainChat: document.querySelector('.main-chat'),
        settingsBackdrop: document.getElementById('settingsBackdrop'),
        contextMenu: document.getElementById('contextMenu'), filterModeSelect: document.getElementById('filterModeSelect'),
        exportRoleSelect: document.getElementById('exportRoleSelect'),
        maxAttachmentMBInput: document.getElementById('maxAttachmentMBInput'),
        chatSettingsBackdrop: document.getElementById('chatSettingsBackdrop'),
        chatSettingsContainer: document.getElementById('chatSettingsContainer'),
        chatPresetSelect: document.getElementById('chatPresetSelect'),
        chatSystemPromptInput: document.getElementById('chatSystemPromptInput'),
        chatUserPrefixInput: document.getElementById('chatUserPrefixInput'),
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
        ctxPolishLabel: document.getElementById('ctxPolishLabel'),
        ctxPolishIconOn: document.getElementById('ctxPolishIconOn'),
        ctxPolishIconOff: document.getElementById('ctxPolishIconOff'),
        polishModelSelect: document.getElementById('polishModelSelect'),
        themeSelect: document.getElementById('themeSelect'),
        ttsEnabledSelect: document.getElementById('ttsEnabledSelect'),
        ttsVoiceSelect: document.getElementById('ttsVoiceSelect')
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
        polishModel: settings.polishModel || '',
        htmlStyle: settings.htmlStyle || 'autumn',
        filterMode: settings.filterMode || 'think',
        exportRole: settings.exportRole || 'both',
        theme: settings.theme || 'system',
        maxAttachmentMB: Number.isFinite(settings.maxAttachmentMB) && settings.maxAttachmentMB > 0 ? settings.maxAttachmentMB : 5,
        ttsEnabled: settings.ttsEnabled !== false,
        ttsVoice: settings.ttsVoice || 'zh-CN-XiaoxiaoNeural',
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

// One-time migration: prompt settings moved from global to per-chat.
// Reads the old global prompt values (from DB settings or legacy localStorage),
// copies them into existing chats lacking the new fields, then strips the
// global keys. Also backfills defaults for any chat missing the fields.
async function migratePromptsToChats() {
    let globalSystemPrompt = '';
    let globalUserPrefix = '';
    let globalSelectedPreset = 'custom';
    let foundGlobal = false;

    try {
        const settings = await getSettings();
        if (settings.systemPrompt !== undefined || settings.userPrefix !== undefined || settings.selectedPreset !== undefined) {
            foundGlobal = true;
            globalSystemPrompt = settings.systemPrompt || '';
            globalUserPrefix = settings.userPrefix || '';
            globalSelectedPreset = settings.selectedPreset || 'custom';
        }
    } catch (e) {
        console.warn('Prompt migration: settings read failed:', e);
    }

    if (!foundGlobal) {
        const lsSystem = localStorage.getItem('ai_system_prompt');
        const lsPrefix = localStorage.getItem('ai_user_prefix');
        const lsPreset = localStorage.getItem('ai_selected_preset');
        if (lsSystem !== null || lsPrefix !== null || lsPreset !== null) {
            foundGlobal = true;
            globalSystemPrompt = lsSystem || '';
            globalUserPrefix = lsPrefix || '';
            globalSelectedPreset = lsPreset || 'custom';
        }
    }

    let changed = false;
    for (const chat of state.chats) {
        if (chat.systemPrompt === undefined && chat.userPrefix === undefined && chat.selectedPreset === undefined) {
            // Chat predates per-chat prompts: inherit the old global value (one-time).
            chat.systemPrompt = foundGlobal ? globalSystemPrompt : '';
            chat.userPrefix = foundGlobal ? globalUserPrefix : '';
            chat.selectedPreset = foundGlobal ? globalSelectedPreset : 'custom';
            changed = true;
        } else {
            // Partial/imported chat: backfill any missing field with blank defaults.
            if (chat.systemPrompt === undefined) { chat.systemPrompt = ''; changed = true; }
            if (chat.userPrefix === undefined) { chat.userPrefix = ''; changed = true; }
            if (chat.selectedPreset === undefined) { chat.selectedPreset = 'custom'; changed = true; }
        }
    }

    if (changed) {
        _saveStateSync();
    }

    if (foundGlobal) {
        try {
            await deleteSettingsKeys(['systemPrompt', 'userPrefix', 'selectedPreset']);
        } catch (e) {
            console.warn('Prompt migration: settings cleanup failed:', e);
        }
    }
}

function getPersistedSettings() {
    return {
        apiKey: state.apiKey,
        selectedModel: state.selectedModel,
        titleModel: state.titleModel,
        refuseModel: state.refuseModel,
        polishModel: state.polishModel,
        htmlStyle: state.htmlStyle,
        filterMode: state.filterMode,
        exportRole: state.exportRole,
        theme: state.theme,
        maxAttachmentMB: state.maxAttachmentMB,
        ttsEnabled: state.ttsEnabled,
        ttsVoice: state.ttsVoice,
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
    state.polishModel = DOM.polishModelSelect.value;
    state.htmlStyle = DOM.htmlStyleSelect.value;
    state.filterMode = DOM.filterModeSelect.value;
    state.exportRole = DOM.exportRoleSelect.value;
    if (DOM.maxAttachmentMBInput) {
        const v = parseFloat(DOM.maxAttachmentMBInput.value);
        state.maxAttachmentMB = Number.isFinite(v) && v > 0 ? v : 5;
    }
    if (DOM.ttsEnabledSelect) state.ttsEnabled = DOM.ttsEnabledSelect.value === 'on';
    if (DOM.ttsVoiceSelect) state.ttsVoice = DOM.ttsVoiceSelect.value;

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
