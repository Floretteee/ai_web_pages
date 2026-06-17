function escapeNonStandardHtmlTags(text) {
    return String(text || '').replace(/<\/?\s*([a-zA-Z][\w:-]*)\b[^>]*>/g, (tag, name) => {
        return STANDARD_HTML_TAGS.has(name.toLowerCase()) ? tag : escapeHtml(tag);
    });
}

function extractNonStandardCollapsibleTags(text, store) {
    let result = String(text || '');
    let changed = true;
    while (changed) {
        changed = false;
        result = result.replace(NONSTANDARD_TAG_PATTERN_GLOBAL, (match, tagName, _attrs, inner) => {
            if (STANDARD_HTML_TAGS.has(tagName.toLowerCase()) || tagName.toLowerCase() === 'think' || tagName.toLowerCase() === 'thinking') return match;
            changed = true;
            const idx = store.length;
            store.push({ tagName, inner });
            return `\x00NS_TAG_${idx}\x00`;
        });
    }
    return result;
}

function restoreNonStandardCollapsibleTags(html, store) {
    if (!store || !store.length) return html;
    return html.replace(/\x00NS_TAG_(\d+)\x00/g, (_, idx) => {
        const item = store[parseInt(idx, 10)];
        if (!item) return '';
        const label = escapeHtml(item.tagName);
        const innerHtml = renderMarkdownToHtml(item.inner);
        return `<details class="ns-tag-block think-block"><summary class="think-summary ns-tag-summary">${label}</summary><div class="think-content ns-tag-content markdown-body">${innerHtml}</div></details>`;
    });
}

function highlightCodeBlocks(container) {
    if (!window.hljs || !container) return;
    container.querySelectorAll('pre code:not(.hljs)').forEach((block) => {
        try { window.hljs.highlightElement(block); } catch (e) {}
    });
    addCopyButtons(container);
}

function addCopyButtons(container) {
    container.querySelectorAll('pre:not(.copy-btn-added)').forEach(pre => {
        pre.classList.add('copy-btn-added');
        const btn = document.createElement('button');
        btn.className = 'code-copy-btn';
        btn.title = '复制代码';
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
        btn.onclick = () => {
            const code = pre.querySelector('code');
            const text = code ? code.textContent : pre.textContent;
            navigator.clipboard.writeText(text).then(() => {
                btn.classList.add('copied');
                btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
                setTimeout(() => {
                    btn.classList.remove('copied');
                    btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
                }, 2000);
            }).catch(() => {});
        };
        pre.appendChild(btn);
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
    const nsTagStore = [];
    const afterExtract = extractNonStandardCollapsibleTags(markdown || '', nsTagStore);
    const source = escapeNonStandardHtmlTags(afterExtract);
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
    html = restoreNonStandardCollapsibleTags(html, nsTagStore);
    return DOMPurify.sanitize(html);
}

function renderMarkdownIntoElement(element, markdown) {
    element.innerHTML = renderMarkdownToHtml(markdown);
    if (shouldProcessMath(markdown)) renderMath(element);
    if (markdown && (markdown.includes('<pre') || markdown.includes('```'))) { highlightCodeBlocks(element); }
    else { addCopyButtons(element); }
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

function renderContentWithThink(content, isStreaming) {
    let mainContent = content || '';
    let thinkHtml = '';
    const thinkSvg = `<svg class="think-icon" viewBox="0 0 24 24" width="16" height="16"><path d="M9.55 17.05 4.9 12.4l1.42-1.42 3.23 3.23 8.13-8.13 1.42 1.42-9.55 9.55Z"/></svg>`;

    const thinkMatch = content && content.match(CLOSED_THINK_BLOCK_PATTERN);
    if (thinkMatch) {
        const remainingContent = content.replace(CLOSED_THINK_BLOCK_PATTERN, '').trim();
        const thinkingNow = isStreaming && !remainingContent;
        thinkHtml = `<details class="think-block">
            <summary class="think-summary">${thinkingNow ? '' : thinkSvg} ${thinkingNow ? '思考中...' : '思考过程'}</summary>
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
                    <summary class="think-summary">思考中...</summary>
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
