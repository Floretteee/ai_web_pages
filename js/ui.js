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

const customSelects = new Map();

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
    document.querySelectorAll('.settings-panel select, .chat-settings-panel select').forEach(buildCustomSelect);
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
