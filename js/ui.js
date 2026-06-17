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

function openSettings() {
    closeSidebar();
    DOM.settingsBackdrop.classList.remove('exiting');
    DOM.settingsContainer.classList.remove('exiting');
    DOM.settingsBackdrop.classList.add('show');
    DOM.settingsContainer.classList.add('show');
    DOM.settingsContainer.setAttribute('aria-hidden', 'false');
}
function closeSettings() {
    if (!DOM.settingsContainer.classList.contains('show')) return;
    DOM.settingsContainer.classList.add('exiting');
    DOM.settingsBackdrop.classList.add('exiting');
    DOM.settingsContainer.classList.remove('show');
    DOM.settingsContainer.setAttribute('aria-hidden', 'true');
    DOM.settingsBackdrop.classList.remove('show');
    closeCustomSelects();
    setTimeout(() => {
        DOM.settingsContainer.classList.remove('exiting');
        DOM.settingsBackdrop.classList.remove('exiting');
    }, 200);
}
function toggleSettings() { DOM.settingsContainer.classList.contains('show') ? closeSettings() : openSettings(); }
function toggleSidebar() {
    const open = DOM.sidebar.classList.contains('open');
    if (open) {
        closeSidebar();
    } else {
        DOM.sidebar.classList.remove('exiting');
        DOM.sidebarBackdrop.classList.remove('exiting');
        DOM.sidebar.classList.add('open');
        DOM.sidebarBackdrop.classList.add('show');
    }
}
function closeSidebar() {
    if (!DOM.sidebar.classList.contains('open')) return;
    DOM.sidebar.classList.add('exiting');
    DOM.sidebarBackdrop.classList.add('exiting');
    DOM.sidebar.classList.remove('open');
    DOM.sidebarBackdrop.classList.remove('show');
    setTimeout(() => {
        DOM.sidebar.classList.remove('exiting');
        DOM.sidebarBackdrop.classList.remove('exiting');
    }, 200);
}

let _vvRafId = 0;
function keepMobileComposerVisible() {
    if (window.innerWidth > 768) return;
    if (_vvRafId) return;
    _vvRafId = requestAnimationFrame(() => {
        _vvRafId = 0;
        const vv = window.visualViewport;
        if (vv) {
            document.documentElement.style.height = vv.height + 'px';
        }
        document.querySelector('.input-wrapper')?.scrollIntoView({ block: 'end', inline: 'nearest' });
    });
}
const throttledKeepMobileVisible = keepMobileComposerVisible;

let _scrollRafId = 0;
function scrollToBottom() {
    if (_scrollRafId) return;
    _scrollRafId = requestAnimationFrame(() => {
        _scrollRafId = 0;
        DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
        updateScrollButton();
    });
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

function openChatSettings() {
    DOM.contextMenu.style.display = 'none';
    const chat = state.chats.find(c => c.id === contextMenuChatId);
    if (!chat) return;

    DOM.chatMaxTokensInput.value = chat.maxTokens || 0;
    refreshCustomSelect(DOM.chatMaxTokensInput);
    DOM.chatContextLimitInput.value = chat.contextLimit || 131072;
    refreshCustomSelect(DOM.chatContextLimitInput);
    DOM.chatTemperatureRange.value = chat.temperature !== undefined ? chat.temperature : 0.7;
    DOM.chatTemperatureDisplay.textContent = DOM.chatTemperatureRange.value;
    DOM.chatStreamToggle.checked = chat.stream !== false;

    DOM.chatSettingsBackdrop.classList.remove('exiting');
    DOM.chatSettingsContainer.classList.remove('exiting');
    DOM.chatSettingsBackdrop.classList.add('show');
    DOM.chatSettingsContainer.classList.add('show');
    DOM.chatSettingsContainer.setAttribute('aria-hidden', 'false');
}

function closeChatSettings() {
    if (!DOM.chatSettingsContainer.classList.contains('show')) return;
    DOM.chatSettingsContainer.classList.add('exiting');
    DOM.chatSettingsBackdrop.classList.add('exiting');
    DOM.chatSettingsContainer.classList.remove('show');
    DOM.chatSettingsContainer.setAttribute('aria-hidden', 'true');
    DOM.chatSettingsBackdrop.classList.remove('show');
    setTimeout(() => {
        DOM.chatSettingsContainer.classList.remove('exiting');
        DOM.chatSettingsBackdrop.classList.remove('exiting');
    }, 200);
}

function updateChatTemperatureDisplay() {
    DOM.chatTemperatureDisplay.textContent = DOM.chatTemperatureRange.value;
    saveChatSettings();
}

function saveChatSettings() {
    const chat = state.chats.find(c => c.id === contextMenuChatId);
    if (!chat) return;
    const newLimit = parseInt(DOM.chatContextLimitInput.value) || 0;
    const oldLimit = chat.contextLimit || 0;
    if (newLimit > oldLimit) chat.contextLimitWarned = false;
    chat.maxTokens = parseInt(DOM.chatMaxTokensInput.value) || 0;
    chat.contextLimit = newLimit;
    chat.temperature = parseFloat(DOM.chatTemperatureRange.value);
    chat.stream = DOM.chatStreamToggle.checked;
    saveState();
    updateTrimIndicator();
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
    updateTrimIndicator();
}

function setTheme(theme) {
    state.theme = theme;
    saveSettingsToDB(getPersistedSettings()).catch(e => console.warn('IndexedDB settings save failed:', e));
    applyTheme(theme);
}

function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'dark') {
        root.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
        root.removeAttribute('data-theme');
    } else {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            root.setAttribute('data-theme', 'dark');
        } else {
            root.removeAttribute('data-theme');
        }
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
        meta.content = root.getAttribute('data-theme') === 'dark' ? '#0f0f10' : '#f7f7f7';
    }
}

function initTheme() {
    const saved = state.theme || 'system';
    if (DOM.themeSelect) DOM.themeSelect.value = saved;
    applyTheme(saved);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if ((state.theme || 'system') === 'system') {
            applyTheme('system');
        }
    });
}
