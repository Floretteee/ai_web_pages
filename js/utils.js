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

function stripThinkBlocks(content) {
    if (typeof content !== 'string') return content;
    let result = content.replace(CLOSED_THINK_BLOCK_PATTERN_GLOBAL, '');
    const openMatch = result.match(/<\s*think(?:ing)?\b[^>]*>/i);
    if (openMatch) result = result.slice(0, openMatch.index);
    return result;
}

function estimateTokens(content, options) {
    options = options || {};
    if (!content) return 0;
    if (Array.isArray(content)) {
        return content.reduce((sum, part) => {
            if (part.type === 'text') return sum + estimateTokens(part.text, options);
            if (part.type === 'image_url') return sum + 512;
            return sum;
        }, 0);
    }
    let str = String(content);
    if (!str) return 0;
    if (options.includeThink !== true) str = stripThinkBlocks(str);
    if (!str) return 0;

    const codeRanges = [];
    const fenceRe = /(^|\n)[ \t]{0,3}(`{3,}|~{3,})[^\n]*/g;
    let fm;
    let openFence = null;
    while ((fm = fenceRe.exec(str)) !== null) {
        const startInFull = fm.index + fm[1].length;
        const endInFull = fm.index + fm[0].length;
        const marker = fm[2];
        if (!openFence) {
            openFence = { contentStart: endInFull, markerChar: marker[0], markerLen: marker.length };
        } else if (marker[0] === openFence.markerChar && marker.length >= openFence.markerLen) {
            codeRanges.push([openFence.contentStart, startInFull]);
            openFence = null;
        }
    }
    if (openFence) codeRanges.push([openFence.contentStart, str.length]);

    let ascii = 0;        // ASCII 字母/标点 ≈ 4 char/token
    let digit = 0;        // 数字 ≈ 2.5 char/token（BPE 常按 2-3 位分组）
    let space = 0;        // 空白 ≈ 6 char/token（常合并到相邻 token）
    let codeAscii = 0;    // 代码块 ASCII ≈ 3.5 char/token（符号密集）
    let codeDigit = 0;    // 代码块数字 ≈ 2.5 char/token
    let cjk = 0;          // 常用 CJK 每字 ≈ 1.5 token
    let cjkRare = 0;      // 罕用/扩展 CJK 每字 ≈ 3 token
    let other = 0;        // 其他 Unicode 每字 ≈ 2 token
    let lineBreaks = 0;   // 换行 ≈ 0.5 token

    let inInlineCode = false;
    let rangeIdx = 0;

    for (let i = 0; i < str.length; i++) {
        while (rangeIdx < codeRanges.length && i >= codeRanges[rangeIdx][1]) rangeIdx++;
        const inFenced = rangeIdx < codeRanges.length && i >= codeRanges[rangeIdx][0];

        const ch = str[i];
        const code = str.charCodeAt(i);

        if (ch === '\n') {
            inInlineCode = false;
            lineBreaks++;
            continue;
        }
        if (!inFenced && ch === '`') {
            inInlineCode = !inInlineCode;
        }
        const isCode = inFenced || inInlineCode;

        if (code <= 127) {
            if (code === 32 || code === 9) space++;
            else if (code >= 48 && code <= 57) { if (isCode) codeDigit++; else digit++; }
            else { if (isCode) codeAscii++; else ascii++; }
        } else if ((code >= 0x4E00 && code <= 0x9FFF) ||
                   (code >= 0x3000 && code <= 0x33FF) ||
                   (code >= 0xFF00 && code <= 0xFFEF)) {
            cjk++;
        } else if (code >= 0xD800 && code <= 0xDBFF) {
            cjkRare++;
            i++;
        } else if ((code >= 0x3400 && code <= 0x4DBF) ||
                   (code >= 0xF900 && code <= 0xFAFF)) {
            cjkRare++;
        } else {
            other++;
        }
    }

    const tokens =
        ascii / 4 +
        digit / 2.5 +
        space / 6 +
        codeAscii / 3.5 +
        codeDigit / 2.5 +
        cjk * 1.5 +
        cjkRare * 3 +
        other / 2 +
        lineBreaks * 0.5;

    return Math.max(1, Math.ceil(tokens));
}

function estimateMessagesTokens(messages, options) {
    return messages.reduce((sum, m) => sum + estimateTokens(m.content, options) + 4, 0);
}

function getMessagePlainText(msg) {
    if (!msg) return '';
    let content = msg.content;
    if (Array.isArray(content)) {
        content = content.find(c => c.type === 'text')?.text || '';
    }
    if (typeof content !== 'string') return '';
    return stripThinkBlocks(content);
}

function calcChineseRatio(text) {
    if (!text) return 0;
    let cjk = 0;
    let counted = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code <= 32) continue;
        counted++;
        if ((code >= 0x4E00 && code <= 0x9FFF) ||
            (code >= 0x3400 && code <= 0x4DBF) ||
            (code >= 0xF900 && code <= 0xFAFF) ||
            (code >= 0x3000 && code <= 0x33FF) ||
            (code >= 0xFF00 && code <= 0xFFEF)) {
            cjk++;
        }
    }
    return counted ? cjk / counted : 0;
}

function extractEnglishTokens(text) {
    if (!text || typeof text !== 'string') return [];
    let stripped = text.replace(/```[\s\S]*?```/g, '\x00');
    stripped = stripped.replace(/`[^`\n]+`/g, '\x00');
    stripped = stripped.replace(/!?\[[^\]]*\]\([^)]+\)/g, '\x00');
    stripped = stripped.replace(/<[^>]+>/g, '\x00');
    stripped = stripped.replace(/https?:\/\/\S+/g, '\x00');

    // 连续英文短语：英文字母为核心，允许内部出现空格/连字符/撇号/常见标点连接
    // 形如 "hello world", "state-of-the-art", "I'm fine"
    const phrasePattern = /[A-Za-z][A-Za-z'\-]*(?:[ \t]+[A-Za-z][A-Za-z'\-]*|[\-'][A-Za-z]+)*/g;
    const matches = stripped.match(phrasePattern) || [];

    const seen = new Set();
    const result = [];
    matches.forEach(raw => {
        const phrase = raw.trim();
        if (!phrase) return;
        if (phrase.length < 2) return;
        // 单个单词且全大写且≤3字母（如 ID, OK, AI），跳过
        if (!/\s/.test(phrase) && /^[A-Z]+$/.test(phrase) && phrase.length <= 3) return;
        const key = phrase.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        result.push(phrase);
    });
    return result;
}

function applyTranslationMap(text, map) {
    if (!text || !map || typeof text !== 'string') return text;
    const entries = Object.entries(map).filter(([k, v]) => k && v && typeof v === 'string');
    if (!entries.length) return text;
    // 先替换长短语，避免被短词先吃掉
    entries.sort((a, b) => b[0].length - a[0].length);

    const segments = [];
    const codePattern = /(```[\s\S]*?```|`[^`\n]+`|!?\[[^\]]*\]\([^)]+\)|<[^>]+>|https?:\/\/\S+)/g;
    let lastIdx = 0;
    let m;
    while ((m = codePattern.exec(text)) !== null) {
        if (m.index > lastIdx) segments.push({ text: text.slice(lastIdx, m.index), translate: true });
        segments.push({ text: m[0], translate: false });
        lastIdx = m.index + m[0].length;
    }
    if (lastIdx < text.length) segments.push({ text: text.slice(lastIdx), translate: true });

    const translated = segments.map(seg => {
        if (!seg.translate) return seg.text;
        let out = seg.text;
        entries.forEach(([phrase, zh]) => {
            const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[ \t]+/g, '[ \\t]+');
            const re = new RegExp('(?<![A-Za-z])' + escaped + '(?![A-Za-z])', 'g');
            out = out.replace(re, zh);
        });
        return out;
    });
    return translated.join('');
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
