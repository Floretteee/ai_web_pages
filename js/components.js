const Components = (() => {
    function createToast(message, options = {}) {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        toast.textContent = message;
        container.appendChild(toast);
        const duration = options.duration || 2500;
        setTimeout(() => {
            toast.style.animation = 'toastLeave 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards';
            toast.addEventListener('animationend', () => toast.remove());
        }, duration);
        return toast;
    }

    function createConfirm(message, options = {}) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'custom-modal-overlay';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-label', options.ariaLabel || '确认');

            const modal = document.createElement('div');
            modal.className = 'custom-modal';

            const text = document.createElement('p');
            text.textContent = message;

            const actions = document.createElement('div');
            actions.className = 'custom-modal-actions';

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'custom-modal-btn-cancel';
            cancelBtn.textContent = options.cancelText || '取消';

            const confirmBtn = document.createElement('button');
            confirmBtn.className = 'custom-modal-btn-confirm';
            confirmBtn.textContent = options.confirmText || '确定';

            let resolved = false;
            const close = (result) => {
                if (resolved) return;
                resolved = true;
                overlay.classList.remove('active');
                setTimeout(() => overlay.remove(), 300);
                resolve(result);
            };

            cancelBtn.onclick = () => close(false);
            confirmBtn.onclick = () => close(true);

            const handleKeydown = (e) => {
                if (e.key === 'Escape') { close(false); }
                else if (e.key === 'Enter' && document.activeElement === confirmBtn) { close(true); }
            };
            overlay.addEventListener('keydown', handleKeydown);

            actions.appendChild(cancelBtn);
            actions.appendChild(confirmBtn);
            modal.appendChild(text);
            modal.appendChild(actions);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            requestAnimationFrame(() => {
                overlay.classList.add('active');
                confirmBtn.focus();
            });

            const trapFocus = (e) => {
                if (e.key !== 'Tab') return;
                const focusable = overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
                if (focusable.length === 0) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey) {
                    if (document.activeElement === first) { e.preventDefault(); last.focus(); }
                } else {
                    if (document.activeElement === last) { e.preventDefault(); first.focus(); }
                }
            };
            overlay.addEventListener('keydown', trapFocus);

            const observer = new MutationObserver(() => {
                if (!document.body.contains(overlay)) {
                    observer.disconnect();
                    overlay.removeEventListener('keydown', handleKeydown);
                    overlay.removeEventListener('keydown', trapFocus);
                }
            });
            observer.observe(document.body, { childList: true });
        });
    }

    const _selectInstances = new Map();

    function createCustomSelect(nativeSelect, options = {}) {
        if (!nativeSelect || _selectInstances.has(nativeSelect)) return _selectInstances.get(nativeSelect);

        const wrapper = document.createElement('div');
        wrapper.className = 'custom-select';
        wrapper.setAttribute('role', 'combobox');
        wrapper.setAttribute('aria-haspopup', 'listbox');
        wrapper.setAttribute('aria-expanded', 'false');
        wrapper.setAttribute('aria-owns', '');

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'custom-select-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');

        const triggerLabel = document.createElement('span');
        const triggerSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        triggerSvg.setAttribute('viewBox', '0 0 24 24');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z');
        triggerSvg.appendChild(path);

        trigger.appendChild(triggerLabel);
        trigger.appendChild(triggerSvg);

        const menu = document.createElement('div');
        menu.className = 'custom-select-menu';
        menu.setAttribute('role', 'listbox');
        menu.setAttribute('tabindex', '-1');

        wrapper.appendChild(trigger);
        wrapper.appendChild(menu);

        nativeSelect.classList.add('native-select');
        nativeSelect.insertAdjacentElement('afterend', wrapper);

        const instance = { nativeSelect, wrapper, trigger, triggerLabel, menu, isOpen: false, activeIndex: -1 };
        _selectInstances.set(nativeSelect, instance);

        function setOpen(open) {
            instance.isOpen = open;
            wrapper.classList.toggle('open', open);
            trigger.setAttribute('aria-expanded', String(open));
            wrapper.setAttribute('aria-expanded', String(open));
            if (open) {
                const options = menu.querySelectorAll('.custom-select-option');
                if (options.length > 0) {
                    const selectedOption = menu.querySelector('.custom-select-option.active');
                    instance.activeIndex = selectedOption ? Array.from(options).indexOf(selectedOption) : 0;
                    updateActiveDescendant();
                }
            } else {
                instance.activeIndex = -1;
                trigger.removeAttribute('aria-activedescendant');
            }
        }

        function updateActiveDescendant() {
            const options = menu.querySelectorAll('.custom-select-option');
            if (instance.activeIndex >= 0 && instance.activeIndex < options.length) {
                const activeOption = options[instance.activeIndex];
                trigger.setAttribute('aria-activedescendant', activeOption.id);
                activeOption.scrollIntoView({ block: 'nearest' });
            }
        }

        trigger.addEventListener('click', (event) => {
            event.stopPropagation();
            if (instance.isOpen) {
                closeAllCustomSelects();
            } else {
                closeAllCustomSelects();
                setOpen(true);
            }
        });

        trigger.addEventListener('keydown', (event) => {
            const options = menu.querySelectorAll('.custom-select-option');
            switch (event.key) {
                case 'ArrowDown':
                    event.preventDefault();
                    if (!instance.isOpen) { closeAllCustomSelects(); setOpen(true); }
                    instance.activeIndex = Math.min(instance.activeIndex + 1, options.length - 1);
                    highlightOption(options);
                    break;
                case 'ArrowUp':
                    event.preventDefault();
                    if (!instance.isOpen) { closeAllCustomSelects(); setOpen(true); }
                    instance.activeIndex = Math.max(instance.activeIndex - 1, 0);
                    highlightOption(options);
                    break;
                case 'Enter':
                case ' ':
                    event.preventDefault();
                    if (instance.isOpen && instance.activeIndex >= 0 && instance.activeIndex < options.length) {
                        selectOption(options[instance.activeIndex]);
                    } else if (!instance.isOpen) {
                        closeAllCustomSelects();
                        setOpen(true);
                    }
                    break;
                case 'Escape':
                    event.preventDefault();
                    closeAllCustomSelects();
                    break;
                case 'Home':
                    event.preventDefault();
                    instance.activeIndex = 0;
                    highlightOption(options);
                    break;
                case 'End':
                    event.preventDefault();
                    instance.activeIndex = options.length - 1;
                    highlightOption(options);
                    break;
            }
        });

        function highlightOption(options) {
            options.forEach((opt, i) => {
                opt.classList.toggle('highlighted', i === instance.activeIndex);
            });
            updateActiveDescendant();
        }

        function selectOption(optionBtn) {
            nativeSelect.value = optionBtn.dataset.value;
            nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
            refreshCustomSelect(nativeSelect);
            closeAllCustomSelects();
            trigger.focus();
        }

        refreshCustomSelect(nativeSelect);
        return instance;
    }

    function refreshCustomSelect(nativeSelect) {
        const instance = _selectInstances.get(nativeSelect);
        if (!instance) return;
        const { triggerLabel, menu } = instance;
        const selected = nativeSelect.options[nativeSelect.selectedIndex] || nativeSelect.options[0];
        triggerLabel.textContent = selected ? selected.textContent : '请选择';
        menu.innerHTML = '';
        Array.from(nativeSelect.options).forEach((option, index) => {
            const isActive = option.value === nativeSelect.value;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'custom-select-option' + (isActive ? ' active' : '');
            btn.setAttribute('role', 'option');
            btn.setAttribute('aria-selected', String(isActive));
            btn.setAttribute('data-value', escapeAttr(option.value));
            btn.id = `select-option-${nativeSelect.id || 'anon'}-${index}`;
            btn.textContent = option.textContent;
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                nativeSelect.value = option.value;
                nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
                refreshCustomSelect(nativeSelect);
                closeAllCustomSelects();
                instance.trigger.focus();
            });
            btn.addEventListener('mouseenter', () => {
                const options = menu.querySelectorAll('.custom-select-option');
                instance.activeIndex = Array.from(options).indexOf(btn);
                options.forEach(o => o.classList.remove('highlighted'));
                btn.classList.add('highlighted');
            });
            menu.appendChild(btn);
        });
    }

    function refreshAllCustomSelects() {
        _selectInstances.forEach((_, nativeSelect) => refreshCustomSelect(nativeSelect));
    }

    function closeAllCustomSelects() {
        _selectInstances.forEach((instance) => {
            instance.isOpen = false;
            instance.wrapper.classList.remove('open');
            instance.trigger.setAttribute('aria-expanded', 'false');
            instance.wrapper.setAttribute('aria-expanded', 'false');
            instance.activeIndex = -1;
            instance.trigger.removeAttribute('aria-activedescendant');
            const options = instance.menu.querySelectorAll('.custom-select-option');
            options.forEach(o => o.classList.remove('highlighted'));
        });
    }

    function initCustomSelects(selector) {
        const sel = selector || '.settings-panel select, .chat-settings-panel select';
        document.querySelectorAll(sel).forEach(buildCustomSelect);
    }

    function buildCustomSelect(nativeSelect) {
        return createCustomSelect(nativeSelect);
    }

    function createContextMenu(options = {}) {
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', options.ariaLabel || '上下文菜单');

        const items = options.items || [];
        let focusIndex = -1;

        items.forEach((item, idx) => {
            if (item.divider) {
                const divider = document.createElement('div');
                divider.className = 'context-menu-divider';
                divider.setAttribute('role', 'separator');
                menu.appendChild(divider);
                return;
            }
            const menuItem = document.createElement('div');
            menuItem.className = 'context-menu-item';
            menuItem.setAttribute('role', 'menuitem');
            menuItem.setAttribute('tabindex', '-1');
            if (item.icon) menuItem.innerHTML = item.icon;
            const span = document.createElement('span');
            span.textContent = item.label;
            menuItem.appendChild(span);
            if (item.onClick) {
                menuItem.addEventListener('click', (e) => {
                    item.onClick(e);
                    hideContextMenu(menu);
                });
            }
            menu.appendChild(menuItem);
        });

        function show(x, y) {
            menu.style.display = 'block';
            menu.style.left = x + 'px';
            menu.style.top = y + 'px';

            requestAnimationFrame(() => {
                const rect = menu.getBoundingClientRect();
                if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
                if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
            });

            focusIndex = -1;
            const closeHandler = (ev) => {
                if (!menu.contains(ev.target)) hideContextMenu(menu);
                document.removeEventListener('click', closeHandler);
                document.removeEventListener('keydown', keyHandler);
            };
            setTimeout(() => {
                document.addEventListener('click', closeHandler);
                document.addEventListener('keydown', keyHandler);
            }, 0);
        }

        function keyHandler(e) {
            const menuItems = menu.querySelectorAll('.context-menu-item[role="menuitem"]');
            if (e.key === 'Escape') {
                hideContextMenu(menu);
                e.preventDefault();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                focusIndex = (focusIndex + 1) % menuItems.length;
                menuItems[focusIndex]?.focus();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                focusIndex = focusIndex <= 0 ? menuItems.length - 1 : focusIndex - 1;
                menuItems[focusIndex]?.focus();
            }
        }

        document.body.appendChild(menu);
        return { element: menu, show, hide: () => hideContextMenu(menu) };
    }

    function hideContextMenu(menu) {
        menu.style.display = 'none';
    }

    return {
        createToast,
        createConfirm,
        createCustomSelect,
        buildCustomSelect,
        refreshCustomSelect,
        refreshAllCustomSelects,
        closeAllCustomSelects,
        initCustomSelects,
        createContextMenu,
        hideContextMenu
    };
})();

function showToast(message, options) { return Components.createToast(message, options); }
function showConfirm(message, options) { return Components.createConfirm(message, options); }
function buildCustomSelect(select) { return Components.buildCustomSelect(select); }
function refreshCustomSelect(select) { return Components.refreshCustomSelect(select); }
function refreshAllCustomSelects() { return Components.refreshAllCustomSelects(); }
function closeCustomSelects() { return Components.closeAllCustomSelects(); }
function initCustomSelects(selector) { return Components.initCustomSelects(selector); }
function showContextMenu(e, chatId) {
    e.preventDefault();
    contextMenuChatId = chatId || state.currentChatId;
    const menu = DOM.contextMenu;
    menu.style.display = 'block';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';

    requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
        if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
    });

    const closeMenu = (ev) => {
        if (!menu.contains(ev.target)) {
            menu.style.display = 'none';
            document.removeEventListener('click', closeMenu);
            document.removeEventListener('keydown', menuKeyHandler);
        }
    };
    let menuFocusIndex = -1;
    const menuKeyHandler = (ev) => {
        const items = menu.querySelectorAll('.context-menu-item');
        if (ev.key === 'Escape') {
            menu.style.display = 'none';
            document.removeEventListener('click', closeMenu);
            document.removeEventListener('keydown', menuKeyHandler);
            ev.preventDefault();
        } else if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            menuFocusIndex = (menuFocusIndex + 1) % items.length;
            items[menuFocusIndex]?.focus();
        } else if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            menuFocusIndex = menuFocusIndex <= 0 ? items.length - 1 : menuFocusIndex - 1;
            items[menuFocusIndex]?.focus();
        }
    };
    setTimeout(() => {
        document.addEventListener('click', closeMenu);
        document.addEventListener('keydown', menuKeyHandler);
    }, 0);
}
