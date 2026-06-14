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

function openChatSettings() {
    DOM.contextMenu.style.display = 'none';
    const chat = state.chats.find(c => c.id === contextMenuChatId);
    if (!chat) return;

    DOM.chatMaxTokensInput.value = chat.maxTokens || 0;
    refreshCustomSelect(DOM.chatMaxTokensInput);
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
