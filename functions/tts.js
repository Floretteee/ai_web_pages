// Cloudflare Pages Function: WebSocket proxy for Microsoft Edge TTS.
//
// Browsers (Chrome/Firefox/Safari) cannot set the custom WebSocket handshake
// headers Microsoft's endpoint now expects, so a direct connection only works
// in the Edge browser. This proxy sits on the same origin as the site, accepts
// the browser's WebSocket, and bridges it to the Bing speech endpoint with the
// required Origin / User-Agent headers.
//
// The client appends the auth query string (TrustedClientToken, Sec-MS-GEC,
// Sec-MS-GEC-Version, ConnectionId); we forward it verbatim.

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
    const target = `${UPSTREAM}${url.search}`;

    let upstream;
    try {
        upstream = await fetch(target, {
            headers: {
                'Upgrade': 'websocket',
                'Connection': 'Upgrade',
                'Origin': EDGE_ORIGIN,
                'User-Agent': EDGE_UA,
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
    } catch (err) {
        return new Response('Upstream connection failed: ' + err.message, { status: 502 });
    }

    const upstreamWs = upstream.webSocket;
    if (!upstreamWs) {
        return new Response('Upstream did not upgrade to WebSocket (status ' + upstream.status + ').', { status: 502 });
    }

    upstreamWs.accept();

    // Hand the upstream socket straight back to the browser as the 101 response.
    // Cloudflare bridges the two ends, so frames flow transparently in both directions.
    return new Response(null, { status: 101, webSocket: upstreamWs });
}
