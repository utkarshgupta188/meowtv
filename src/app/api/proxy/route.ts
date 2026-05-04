import { NextRequest, NextResponse } from 'next/server';

async function handleRequest(request: NextRequest) {
    const url = request.nextUrl.searchParams.get('url');
    const referer = request.nextUrl.searchParams.get('referer');
    const cookie = request.nextUrl.searchParams.get('cookie');
    const uaParam = request.nextUrl.searchParams.get('ua');

    if (!url) {
        return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
    }

    try {
        const headers: HeadersInit = {
            'User-Agent': uaParam || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        };

        const range = request.headers.get('range');
        if (range) headers['Range'] = range;

        if (referer) headers['Referer'] = referer;
        if (cookie) headers['Cookie'] = cookie;

        // Browser Emulation Headers (Critical for bypassing upstream blocks)
        headers['sec-ch-ua'] = '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"';
        headers['sec-ch-ua-mobile'] = '?0';
        headers['sec-ch-ua-platform'] = '"Windows"';
        headers['Accept-Language'] = 'en-US,en;q=0.9';
        headers['Priority'] = 'u=1, i';

        // Forward critical headers for Auth/POST requests
        const allowedHeaders = ['content-type', 'x-requested-with', 'accept', 'origin', 'authorization'];
        for (const h of allowedHeaders) {
            const v = request.headers.get(h);
            if (v) headers[h] = v;
        }

        const method = request.method;
        const body = method === 'POST' ? request.body : undefined;

        // @ts-ignore - duplex is required for streaming bodies in node fetch but typings might miss it
        const fetchOptions: RequestInit = { headers, method, body };
        if (body) {
            // @ts-ignore
            fetchOptions.duplex = 'half';
        }

        const response = await fetch(url, fetchOptions);

        const contentType = response.headers.get('content-type') || 'application/octet-stream';

        const responseHeaders = new Headers();
        responseHeaders.set('Content-Type', contentType);
        responseHeaders.set('Access-Control-Allow-Origin', '*');

        // Forward critical auth headers (Set-Cookie)
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) {
            responseHeaders.set('Set-Cookie', setCookie);
            // Critical for client-side bypass: Expose Set-Cookie to JS
            responseHeaders.set('X-Proxied-Set-Cookie', setCookie);
        }

        responseHeaders.set('Access-Control-Expose-Headers', 'X-Proxied-Set-Cookie, Content-Length, Content-Range');

        // Allow accept-ranges
        const acceptRanges = response.headers.get('accept-ranges');
        if (acceptRanges) responseHeaders.set('Accept-Ranges', acceptRanges);

        return new NextResponse(response.body as any, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders
        });
    } catch (error) {

        return NextResponse.json({ error: 'Proxy failed' }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    return handleRequest(request);
}

export async function POST(request: NextRequest) {
    return handleRequest(request);
}
