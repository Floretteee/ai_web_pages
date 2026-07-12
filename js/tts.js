// Text-to-speech for assistant replies.
//
// Primary path: Microsoft Edge neural voices over a same-origin WebSocket proxy
// (functions/tts.js). Fallback: the browser's built-in Web Speech API, used when
// the proxy/Edge path fails or is unavailable (e.g. offline).
//
// Exposes a small global `TTS` controller used by the per-message read-aloud
// button. Only one utterance plays at a time; starting a new one stops the old.

const TTS = (() => {
    const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
    const GEC_VERSION = '1-143.0.3650';
    const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
    const PROXY_PATH = '/tts';
    const WS_TIMEOUT_MS = 30000;

    // Currently active playback session. Shape:
    // { index, source: 'edge'|'webspeech', audio?, url?, ws?, stop() }
    let active = null;
    // Listeners fired on state change so the UI can reflect play/stop.
    const listeners = new Set();

    function onStateChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    function emit() {
        const idx = active ? active.index : -1;
        listeners.forEach(fn => { try { fn(idx); } catch (e) {} });
    }

    function isSpeaking(index) {
        return !!active && (index === undefined || active.index === index);
    }

    function stop() {
        if (!active) return;
        const cur = active;
        active = null;
        try { cur.stop(); } catch (e) {}
        emit();
    }

    // --- Edge TTS -----------------------------------------------------------

    async function generateSecMsGec() {
        const unixSec = Math.floor(Date.now() / 1000);
        const ticks = unixSec + 11644473600;      // shift to Windows epoch (1601)
        const rounded = ticks - (ticks % 300);     // round down to 5-minute window
        const ns100 = rounded * 10000000;          // 100-nanosecond intervals
        const data = new TextEncoder().encode(`${ns100}${TOKEN}`);
        const digest = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(digest))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
            .toUpperCase();
    }

    function randomHex32() {
        return crypto.randomUUID().replace(/-/g, '');
    }

    function escapeXml(s) {
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    }

    function findSequence(arr, sub) {
        outer:
        for (let i = 0; i <= arr.length - sub.length; i++) {
            for (let j = 0; j < sub.length; j++) {
                if (arr[i + j] !== sub[j]) continue outer;
            }
            return i;
        }
        return -1;
    }

    // Resolve to an MP3 Blob, or reject if the Edge path is unavailable.
    async function synthesizeEdge(text, voice) {
        const secMsGec = await generateSecMsGec();
        const connId = randomHex32();
        const reqId = randomHex32();
        const proxyBase = `${location.origin.replace(/^http/, 'ws')}${PROXY_PATH}`;
        const url = `${proxyBase}?TrustedClientToken=${TOKEN}`
            + `&Sec-MS-GEC=${secMsGec}`
            + `&Sec-MS-GEC-Version=${GEC_VERSION}`
            + `&ConnectionId=${connId}`;

        return new Promise((resolve, reject) => {
            let ws;
            try {
                ws = new WebSocket(url);
            } catch (e) {
                reject(e);
                return;
            }
            ws.binaryType = 'arraybuffer';

            const chunks = [];
            const DELIM = new TextEncoder().encode('Path:audio\r\n');
            let settled = false;
            const timer = setTimeout(() => finish(new Error('TTS timeout')), WS_TIMEOUT_MS);

            function finish(err, blob) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                try { ws.close(); } catch (e) {}
                if (err) reject(err);
                else resolve(blob);
            }

            // Expose the socket so stop() can abort an in-flight synthesis.
            synthesizeEdge._lastWs = ws;

            ws.onopen = () => {
                const ts = new Date().toUTCString();
                ws.send(
                    'X-Timestamp:' + ts + '\r\n' +
                    'Content-Type:application/json; charset=utf-8\r\n' +
                    'Path:speech.config\r\n\r\n' +
                    JSON.stringify({
                        context: {
                            synthesis: {
                                audio: {
                                    metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
                                    outputFormat: OUTPUT_FORMAT
                                }
                            }
                        }
                    })
                );
                const lang = (voice || 'zh-CN').slice(0, 5);
                const ssml =
                    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
                    `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}">` +
                    `<voice name="${voice}"><prosody pitch="+0Hz" rate="+0%" volume="+0%">` +
                    `${escapeXml(text)}</prosody></voice></speak>`;
                ws.send(
                    `X-RequestId:${reqId}\r\n` +
                    'Content-Type:application/ssml+xml\r\n' +
                    'X-Timestamp:' + ts + '\r\n' +
                    'Path:ssml\r\n\r\n' + ssml
                );
            };

            ws.onmessage = (ev) => {
                if (typeof ev.data === 'string') {
                    if (ev.data.includes('Path:turn.end')) {
                        if (chunks.length === 0) { finish(new Error('No audio received')); return; }
                        const total = chunks.reduce((n, c) => n + c.length, 0);
                        const merged = new Uint8Array(total);
                        let off = 0;
                        for (const c of chunks) { merged.set(c, off); off += c.length; }
                        finish(null, new Blob([merged], { type: 'audio/mpeg' }));
                    }
                    return;
                }
                const buf = new Uint8Array(ev.data);
                const idx = findSequence(buf, DELIM);
                if (idx !== -1) chunks.push(buf.slice(idx + DELIM.length));
            };

            ws.onerror = () => finish(new Error('TTS WebSocket error'));
            ws.onclose = () => {
                if (settled) return;
                if (chunks.length > 0) {
                    const total = chunks.reduce((n, c) => n + c.length, 0);
                    const merged = new Uint8Array(total);
                    let off = 0;
                    for (const c of chunks) { merged.set(c, off); off += c.length; }
                    finish(null, new Blob([merged], { type: 'audio/mpeg' }));
                } else {
                    finish(new Error('TTS connection closed before audio'));
                }
            };
        });
    }

    // --- Web Speech fallback ------------------------------------------------

    function pickWebSpeechVoice(voice) {
        const voices = speechSynthesis.getVoices() || [];
        if (!voices.length) return null;
        const lang = (voice || 'zh-CN').slice(0, 5);
        return voices.find(v => v.lang && v.lang.toLowerCase() === lang.toLowerCase())
            || voices.find(v => v.lang && v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()))
            || null;
    }

    function speakWebSpeech(index, text, voice) {
        if (!('speechSynthesis' in window)) {
            throw new Error('Web Speech API unavailable');
        }
        speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        const v = pickWebSpeechVoice(voice);
        if (v) utter.voice = v;
        utter.lang = (voice || 'zh-CN').slice(0, 5);
        utter.onend = () => { if (active && active.index === index) stop(); };
        utter.onerror = () => { if (active && active.index === index) stop(); };
        active = {
            index,
            source: 'webspeech',
            stop() { try { speechSynthesis.cancel(); } catch (e) {} }
        };
        emit();
        speechSynthesis.speak(utter);
    }

    // --- Public API ---------------------------------------------------------

    // Toggle read-aloud for a message. If it is already speaking, stop.
    async function toggle(index, text, options = {}) {
        if (isSpeaking(index)) { stop(); return; }
        stop(); // stop any other active playback first

        const clean = String(text || '').trim();
        if (!clean) return;

        const voice = options.voice || 'zh-CN-XiaoxiaoNeural';
        const preferEdge = options.preferEdge !== false;

        if (preferEdge) {
            // Provisional active state so the button reflects "working" immediately.
            let cancelled = false;
            active = {
                index,
                source: 'edge',
                stop() {
                    cancelled = true;
                    if (this.audio) { try { this.audio.pause(); } catch (e) {} }
                    if (this.url) { try { URL.revokeObjectURL(this.url); } catch (e) {} }
                    if (synthesizeEdge._lastWs) { try { synthesizeEdge._lastWs.close(); } catch (e) {} }
                }
            };
            const session = active;
            emit();

            try {
                const blob = await synthesizeEdge(clean, voice);
                if (cancelled || active !== session) return;
                const url = URL.createObjectURL(blob);
                const audio = new Audio(url);
                session.audio = audio;
                session.url = url;
                audio.onended = () => { if (active === session) stop(); };
                audio.onerror = () => { if (active === session) stop(); };
                await audio.play();
                return;
            } catch (e) {
                console.warn('[TTS] Edge path failed, falling back to Web Speech:', e && e.message);
                if (cancelled || active !== session) return;
                active = null; // clear before fallback claims it
            }
        }

        try {
            speakWebSpeech(index, clean, voice);
        } catch (e) {
            console.warn('[TTS] Web Speech fallback failed:', e && e.message);
            stop();
            if (typeof showToast === 'function') showToast('朗读失败：当前环境不支持语音合成');
        }
    }

    return { toggle, stop, isSpeaking, onStateChange };
})();
