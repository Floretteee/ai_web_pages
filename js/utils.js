const API_BASE = "https://api.fimall.cfd/v1";
const THINK_TAG_PATTERN = /<\/?\s*think(?:ing)?\b[^>]*>/i;
const CLOSED_THINK_BLOCK_PATTERN = /<\s*think(?:ing)?\b[^>]*>([\s\S]*?)<\/\s*think(?:ing)?\s*>/i;
const CLOSED_THINK_BLOCK_PATTERN_GLOBAL = /<\s*think(?:ing)?\b[^>]*>[\s\S]*?<\/\s*think(?:ing)?\s*>/gi;
const ALL_WRAPPER_TAG_PATTERN_GLOBAL = /<\s*([a-zA-Z][\w:-]*)(\s[^>]*)?>[\s\S]*?<\/\s*\1\s*>/gi;
const NONSTANDARD_TAG_PATTERN_GLOBAL = /<\s*([a-zA-Z][\w:-]*)(\s[^>]*)?>([\s\S]*?)<\/\s*\1\s*>/gi;

const STANDARD_HTML_TAGS = new Set('a abbr address area article aside audio b bdi bdo blockquote br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr i iframe img input ins kbd label legend li main map mark menu meter nav object ol optgroup option output p picture pre progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr'.split(' '));

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeAttr(value) {
    return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function throttle(fn, delay) {
    let timer = null;
    return (...args) => {
        if (timer) return;
        timer = setTimeout(() => { timer = null; fn(...args); }, delay);
    };
}

const loadedAssets = new Map();

function loadScriptOnce(src) {
    if (loadedAssets.has(src)) return loadedAssets.get(src);
    const promise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.defer = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
    loadedAssets.set(src, promise);
    return promise;
}

function loadStylesheetOnce(href) {
    if (loadedAssets.has(href) || document.querySelector(`link[href="${href}"]`)) return loadedAssets.get(href) || Promise.resolve();
    const promise = new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.onload = resolve;
        link.onerror = reject;
        document.head.appendChild(link);
    });
    loadedAssets.set(href, promise);
    return promise;
}

function ensureKatexAssets() {
    if (typeof window.renderMathInElement === 'function') return Promise.resolve();
    return Promise.all([
        loadStylesheetOnce('vendor/katex/katex.min.css'),
        loadScriptOnce('vendor/katex/katex.min.js')
    ]).then(() => loadScriptOnce('vendor/katex/auto-render.min.js'));
}

function isSafeExportUrl(url) {
    const value = String(url || '').trim().replace(/[\u0000-\u001F\u007F\s]+/g, '');
    if (!value) return '';
    if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(value)) return value;
    if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(value)) return value;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return '';
    return value;
}

function estimateTokens(content) {
    if (!content) return 0;
    if (Array.isArray(content)) {
        return content.reduce((sum, part) => {
            if (part.type === 'text') return sum + estimateTokens(part.text);
            if (part.type === 'image_url') return sum + 512;
            return sum;
        }, 0);
    }
    const str = String(content);
    if (!str) return 0;

    let cjk = 0;          // 常用汉字/全角符号 ≈ 1.5 token
    let cjkRare = 0;      // CJK 扩展区/罕用字 ≈ 3 token
    let ascii = 0;        // 英文/数字/常见标点
    let codeAscii = 0;    // 出现在代码块中的 ASCII（≈ 4.5 char/token）
    let other = 0;        // 其他 Unicode 字符（≈ 2 token）

    let inCode = 0;
    const codeFenceRe = /```/g;
    const fences = [];
    let m;
    while ((m = codeFenceRe.exec(str)) !== null) fences.push(m.index);
    const codeRanges = [];
    for (let i = 0; i + 1 < fences.length; i += 2) codeRanges.push([fences[i], fences[i + 1] + 3]);

    let inInlineCode = false;
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);

        let inFenced = false;
        for (const [s, e] of codeRanges) { if (i >= s && i < e) { inFenced = true; break; } }
        if (str[i] === '`' && !inFenced) inInlineCode = !inInlineCode;
        const isCode = inFenced || inInlineCode;

        if (code <= 127) {
            if (isCode) codeAscii++; else ascii++;
        } else if (code >= 0x4E00 && code <= 0x9FFF) {
            cjk++;
        } else if (code >= 0x3000 && code <= 0x33FF) {
            cjk++;
        } else if (code >= 0xFF00 && code <= 0xFFEF) {
            cjk++;
        } else if (code >= 0xD800 && code <= 0xDBFF) {
            cjkRare++;
            i++;
        } else if ((code >= 0x3400 && code <= 0x4DBF) || (code >= 0xF900 && code <= 0xFAFF)) {
            cjkRare++;
        } else {
            other++;
        }
    }

    const tokens = ascii / 4 + codeAscii / 4.5 + cjk * 1.5 + cjkRare * 3 + other / 2;
    return Math.max(1, Math.ceil(tokens));
}

function estimateMessagesTokens(messages) {
    return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}

function filterExportContent(content, mode) {
    if (!mode || mode === 'none' || typeof content !== 'string') return content;
    let result = content;
    if (mode === 'think') {
        result = result.replace(CLOSED_THINK_BLOCK_PATTERN_GLOBAL, '').trim();
    } else if (mode === 'all') {
        let changed = true;
        while (changed) {
            changed = false;
            result = result.replace(ALL_WRAPPER_TAG_PATTERN_GLOBAL, (match, tagName) => {
                if (STANDARD_HTML_TAGS.has(tagName.toLowerCase())) return match;
                changed = true;
                return '';
            });
        }
        result = result.trim();
    }
    return result;
}
