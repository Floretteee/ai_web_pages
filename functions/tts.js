// Cloudflare Pages Function: WebSocket proxy for Microsoft Edge TTS.
//
// Browsers (Chrome/Firefox/Safari) cannot set the custom WebSocket handshake
// headers Microsoft's endpoint now expects, so a direct connection only works
// in the Edge browser. This proxy sits on the same origin as the site, accepts
// the browser's WebSocket via a WebSocketPair, opens an upstream WebSocket to
// the Bing speech endpoint with the required Origin / User-Agent headers, and
// bridges frames between the two in both directions.
//
// The client appends the auth query string (TrustedClientToken, Sec-MS-GEC,
// Sec-MS-GEC-Version, ConnectionId); we forward it verbatim.
//
// Note: you cannot return the upstream fetch() socket directly to the browser.
// Cloudflare needs a WebSocketPair[0] (client end) to complete the 101
// handshake with the browser; returning the upstream socket yields a silent
// 1006 close. See the manual bridge below.

const UPSTREAM = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
// Origin of the official "Read Aloud" MS Edge extension — accepted by the endpoint.
const EDGE_ORIGIN = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
const EDGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';

export async function onRequest(context) {
    const { request } = context;

    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
        return new Response('Expected a WebSocket upgrade request.', { status: 426 });
    }

    const url = new URL(request.url);
    // fetch() with Upgrade:websocket uses the https:// scheme, not wss://.
    const target = `${UPSTREAM.replace(/^wss:/, 'https:')}${url.search}`;

    // Browser-facing pair: [0] is handed back to the browser, [1] stays here.
    const pair = new WebSocketPair();
    const clientSocket = pair[0];
    const serverSocket = pair[1];

    let upstream;
    try {
        upstream = await fetch(target, {
            headers: {
                'Upgrade': 'websocket',
                'Connection': 'Upgrade',
                'Sec-WebSocket-Version': '13',
                'Origin': EDGE_ORIGIN,
                'User-Agent': EDGE_UA,
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
    } catch (err) {
        try { serverSocket.accept(); serverSocket.close(1011, 'upstream fetch failed'); } catch (e) {}
        return new Response(null, { status: 101, webSocket: clientSocket });
    }

    const upstreamWs = upstream.webSocket;
    if (!upstreamWs) {
        try { serverSocket.accept(); serverSocket.close(1011, 'upstream did not upgrade (' + upstream.status + ')'); } catch (e) {}
        return new Response(null, { status: 101, webSocket: clientSocket });
    }

    // Deterministic synchronous binary handling on both ends.
    serverSocket.binaryType = 'arraybuffer';
    upstreamWs.binaryType = 'arraybuffer';

    serverSocket.accept();
    upstreamWs.accept();

    // Browser -> upstream
    serverSocket.addEventListener('message', (ev) => {
        try { upstreamWs.send(ev.data); } catch (e) {
            try { serverSocket.close(1011, 'upstream send failed'); } catch (_) {}
        }
    });
    // Upstream -> browser
    upstreamWs.addEventListener('message', (ev) => {
        try { serverSocket.send(ev.data); } catch (e) {
            try { upstreamWs.close(1011, 'client send failed'); } catch (_) {}
        }
    });

    serverSocket.addEventListener('close', (ev) => {
        try { upstreamWs.close(ev.code || 1000, ev.reason || 'client closed'); } catch (e) {}
    });
    upstreamWs.addEventListener('close', (ev) => {
        try { serverSocket.close(ev.code || 1000, ev.reason || 'upstream closed'); } catch (e) {}
    });

    serverSocket.addEventListener('error', () => {
        try { upstreamWs.close(1011, 'client error'); } catch (e) {}
    });
    upstreamWs.addEventListener('error', () => {
        try { serverSocket.close(1011, 'upstream error'); } catch (e) {}
    });

    return new Response(null, { status: 101, webSocket: clientSocket });
}
