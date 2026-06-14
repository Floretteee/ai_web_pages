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
