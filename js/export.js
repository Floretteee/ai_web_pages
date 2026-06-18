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
                    parsed.forEach(c => {
                        if (c.systemPrompt === undefined) c.systemPrompt = '';
                        if (c.userPrefix === undefined) c.userPrefix = '';
                        if (c.selectedPreset === undefined) c.selectedPreset = 'custom';
                    });
                    state.chats = parsed; state.currentChatId = parsed[0]?.id || null;
                    saveState(); renderChatList(); renderMessages(); updatePrefixBadge(); showToast("历史记录导入成功！");
                }
            } else { showToast("非法的记录格式"); }
        } catch (err) { showToast("JSON 文件解析失败，请检查文件"); }
        e.target.value = "";
    }; reader.readAsText(file);
}

function exportChatMarkdown() {
    DOM.contextMenu.style.display = 'none';
    const chat = state.chats.find(c => c.id === contextMenuChatId);
    if (!chat) return;

    const filterMode = state.filterMode;
    const exportRole = state.exportRole;

    let md = `# ${chat.title || '新对话'}\n\n`;
    chat.messages.forEach(msg => {
        if (msg.role === 'system') return;
        if (exportRole !== 'both' && msg.role !== exportRole) return;

        const content = Array.isArray(msg.content)
            ? msg.content.find(c => c.type === 'text')?.text || ''
            : msg.content;

        const displayContent = filterExportContent(content, filterMode);

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

function exportChatTXT(novelMode) {
    DOM.contextMenu.style.display = 'none';
    const chat = state.chats.find(c => c.id === contextMenuChatId);
    if (!chat) return;

    const filterMode = state.filterMode;
    const exportRole = state.exportRole;

    let txt = '';
    if (novelMode) {
        txt += `${chat.title || '新对话'}\n\n`;
    }

    let chapterNum = 0;
    chat.messages.forEach(msg => {
        if (msg.role === 'system') return;
        if (exportRole !== 'both' && msg.role !== exportRole) return;

        const content = Array.isArray(msg.content)
            ? msg.content.find(c => c.type === 'text')?.text || ''
            : msg.content;

        const displayContent = filterExportContent(content, filterMode);
        if (!displayContent) return;

        if (novelMode) {
            chapterNum++;
            txt += `第${numberToChinese(chapterNum)}章\n\n${displayContent}\n\n`;
        } else {
            if (exportRole === 'both') {
                txt += `${msg.role === 'user' ? '用户' : '助手'}：\n\n`;
            }
            txt += `${displayContent}\n\n`;
        }
    });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
    const suffix = novelMode ? '小说' : '纯文本';
    a.download = `${chat.title || '对话'}_${suffix}_${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
    showToast(novelMode ? '已导出 TXT（小说）' : '已导出 TXT（纯文本）');
}

function numberToChinese(n) {
    const digits = ['零','一','二','三','四','五','六','七','八','九'];
    const units = ['','十','百','千'];
    const bigUnits = ['','万','亿'];

    if (n === 0) return digits[0];
    if (n < 0) return '负' + numberToChinese(-n);

    let result = '';
    let bigIdx = 0;

    while (n > 0) {
        let segment = n % 10000;
        n = Math.floor(n / 10000);
        let segStr = '';
        let zeroFlag = false;

        for (let i = 0; i < 4 && (segment > 0 || i === 0); i++) {
            let d = segment % 10;
            segment = Math.floor(segment / 10);
            if (d === 0) {
                zeroFlag = true;
            } else {
                if (zeroFlag) { segStr = digits[0] + segStr; zeroFlag = false; }
                segStr = digits[d] + units[i] + segStr;
            }
        }

        if (segStr) {
            result = segStr + bigUnits[bigIdx] + result;
        } else if (result) {
            result = digits[0] + result;
        }
        bigIdx++;
    }

    if (result.startsWith('一十')) result = result.substring(1);
    return result;
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
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { background: #f5f0e8; color: #5c4b37; font-family: 'Noto Serif SC', 'Source Han Serif SC', "Songti SC", serif; font-weight: 500; padding: 40px 15px; max-width: 1000px; margin: 0 auto; -webkit-text-size-adjust: 100%; font-size: 16px; line-height: 1.8; }
            h1 { text-align: center; color: #8b6914; border-bottom: 2px solid #d4a843; padding-bottom: 16px; margin-bottom: 32px; font-size: 24px; font-weight: 700; }
            .export-meta { text-align: center; color: #8b7355; margin: -18px 0 30px; font-size: 14px; }
            .conversation { display: block; }
            .msg { display: block; margin: 24px 0; }
            .user { text-align: right; }
            .assistant { text-align: left; }
            .role { font-weight: 700; margin-bottom: 8px; font-size: 13px; color: #8b6914; }
            .assistant .role { color: #6b8e23; }
            .content { line-height: 1.8; font-weight: 500; }
            .content p, .content ul, .content ol, .content blockquote, .content pre, .content table { margin: 0.75em 0; }
            .content h1, .content h2, .content h3, .content h4, .content h5, .content h6 { margin: 1em 0 0.45em; color: #6f5515; line-height: 1.35; }
            .content ul, .content ol { padding-left: 1.5em; }
            .content img { max-width: 100%; height: auto; }
            table { width: 100%; border-collapse: collapse; word-wrap: break-word; }
            th, td { border: 1px solid #d8c8aa; padding: 8px 10px; }
            pre { background: #e8e0d0; padding: 12px; overflow-x: auto; margin: 8px 0; }
            code { font-family: Menlo, Monaco, Consolas, "Courier New", monospace; font-size: 14px; }
            blockquote { border-left: 3px solid #d4a843; padding-left: 12px; color: #8b7355; margin: 12px 0; }
            @media (min-width: 768px) {
                body { font-size: 18px; }
                h1 { font-size: 28px; }
            }
            @media print {
                body { padding: 20px; }
            }
        `;
    } else {
        bodyClass = 'github';
        css = `
            body { background: #fff; color: #24292e; font-family: -apple-system, "Helvetica Neue", Helvetica, "PingFang SC", "Heiti SC", "Microsoft YaHei", "Noto Sans SC", sans-serif; font-weight: 500; padding: 40px 20px; max-width: 800px; margin: 0 auto; -webkit-text-size-adjust: 100%; font-size: 16px; line-height: 1.6; }
            h1 { border-bottom: 1px solid #eaecef; padding-bottom: 16px; font-weight: 700; font-size: 24px; }
            .export-meta { color: #57606a; margin: -6px 0 24px; font-size: 14px; }
            .conversation { display: block; }
            .msg { display: block; margin: 12px 0; padding: 16px; }
            .user { background: #f6f8fa; text-align: right; }
            .user .role { text-align: left; }
            .assistant { background: #fff; }
            .role { font-weight: 600; margin-bottom: 8px; color: #0366d6; }
            .content { line-height: 1.6; text-align: left; }
            .content p, .content ul, .content ol, .content blockquote, .content pre, .content table { margin: 0.75em 0; }
            .content h1, .content h2, .content h3, .content h4, .content h5, .content h6 { margin: 1em 0 0.45em; line-height: 1.35; }
            .content ul, .content ol { padding-left: 1.5em; }
            .content img { max-width: 100%; height: auto; }
            table { width: 100%; border-collapse: collapse; word-wrap: break-word; }
            th, td { border: 1px solid #d0d7de; padding: 8px 10px; }
            pre { background: #f6f8fa; padding: 16px; overflow-x: auto; text-align: left; }
            code { font-family: Menlo, Monaco, Consolas, "Courier New", monospace; font-size: 14px; }
            blockquote { border-left: 4px solid #dfe2e5; padding-left: 16px; color: #6a737d; margin: 16px 0; text-align: left; }
            @media print {
                body { padding: 20px; }
            }
        `;
    }

    let messagesHtml = '';
    const filterMode = state.filterMode;
    const exportRole = state.exportRole;

    chat.messages.forEach(msg => {
        if (msg.role === 'system') return;
        if (exportRole !== 'both' && msg.role !== exportRole) return;

        const content = Array.isArray(msg.content)
            ? msg.content.find(c => c.type === 'text')?.text || ''
            : (msg.content || '');

        const displayContent = filterExportContent(content, filterMode);

        if (!displayContent) return;

        const roleLabel = msg.role === 'user' ? '用户' : '助手';
        const messageHtml = renderMarkdownToNativeHtml(displayContent);
        const labelId = `message-${messagesHtml.length}-${msg.role}`;

        if (msg.role === 'user') {
            messagesHtml += '<div class="msg user" aria-labelledby="' + labelId + '"><h2 class="role" id="' + labelId + '">' + roleLabel + '</h2><div class="content">' + messageHtml + '</div></div>';
        } else if (msg.role === 'assistant') {
            messagesHtml += '<div class="msg assistant" aria-labelledby="' + labelId + '"><h2 class="role" id="' + labelId + '">' + roleLabel + '</h2><div class="content">' + messageHtml + '</div></div>';
        }
    });

    const title = (chat.title || '新对话').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
    const exportDate = new Date().toLocaleString('zh-CN');
    const html = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <meta name="description" content="AI 对话记录：' + title + '">\n    <meta name="generator" content="Fimall Chat">\n    <title>' + title + '</title>\n    <style>' + css + '</style>\n</head>\n<body class="' + bodyClass + '">\n    <div role="main">\n        <article class="reader-article" itemscope itemtype="https://schema.org/Article">\n            <header>\n                <h1 itemprop="headline">' + title + '</h1>\n                <p class="export-meta">导出时间：<time datetime="' + new Date().toISOString() + '" itemprop="datePublished">' + escapeHtml(exportDate) + '</time></p>\n            </header>\n            <div class="conversation" itemprop="articleBody" aria-label="对话内容">\n                ' + messagesHtml + '\n            </div>\n        </article>\n    </div>\n</body>\n</html>';

    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = (chat.title || '对话').replace(/[<>:"/\\|?*]/g, '_') + '_' + new Date().toISOString().slice(0,10) + '.html';
    a.click();
    showToast("已导出 HTML");
}
