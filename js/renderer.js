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
    if (markdown && (markdown.includes('<pre') || markdown.includes('```'))) highlightCodeBlocks(element);
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
    const thinkAnimSvg = `<svg class="think-icon thinking" viewBox="0 0 24 24" width="16" height="16"><path d="M11.7 6.1c-.45-1.25-1.55-2.1-2.85-2.1A3.05 3.05 0 0 0 5.8 7.05v.18A3.15 3.15 0 0 0 4 10.05c0 1.02.48 1.92 1.23 2.5A3.28 3.28 0 0 0 8.45 16.5h.85v1.2a1.7 1.7 0 0 0 3.4 0V5.95c0-1.08-.88-1.95-1.95-1.95h-.4m1.35 6.05H9.4m3.3 3.15H9.05m3.25-6.1H9.9m2.4 8.75H9.3m3-9.75c.45-1.25 1.55-2.1 2.85-2.1a3.05 3.05 0 0 1 3.05 3.05v.18A3.15 3.15 0 0 1 20 10.05c0 1.02-.48 1.92-1.23 2.5a3.28 3.28 0 0 1-3.22 3.95h-.85v1.2a1.7 1.7 0 0 1-3.4 0V5.95c0-1.08.88-1.95 1.95-1.95h.4m-1.35 6.05h2.3m-3.3 3.15h3.65m-3.25-6.1h2.4m-2.4 8.75h3" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    const thinkMatch = content && content.match(CLOSED_THINK_BLOCK_PATTERN);
    if (thinkMatch) {
        const remainingContent = content.replace(CLOSED_THINK_BLOCK_PATTERN, '').trim();
        const thinkingNow = isStreaming && !remainingContent;
        thinkHtml = `<details class="think-block">
            <summary class="think-summary">${thinkingNow ? thinkAnimSvg : thinkSvg} ${thinkingNow ? '思考中...' : '思考过程'}</summary>
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
                    <summary class="think-summary">${thinkAnimSvg} 思考中...</summary>
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
