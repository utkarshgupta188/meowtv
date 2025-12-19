import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    const url = request.nextUrl.searchParams.get('url');
    const referer = request.nextUrl.searchParams.get('referer');
    const cookie = request.nextUrl.searchParams.get('cookie');

    if (!url) {
        return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
    }

    try {
        const headers: HeadersInit = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        };

        const range = request.headers.get('range');
        if (range) headers['Range'] = range;

        if (referer) headers['Referer'] = referer;
        if (cookie) headers['Cookie'] = cookie;

        const response = await fetch(url, { headers });

        if (!response.ok) {
            return NextResponse.json({ error: 'Failed to fetch' }, { status: response.status });
        }

        if (!response.body) {
            return NextResponse.json({ error: 'No response body' }, { status: 500 });
        }

        const contentType = response.headers.get('content-type') || 'application/octet-stream';

        const responseHeaders = new Headers();
        responseHeaders.set('Content-Type', contentType);
        responseHeaders.set('Access-Control-Allow-Origin', '*');
        responseHeaders.set('Cache-Control', 'public, max-age=3600');

        // Forward critical streaming headers
        const contentLength = response.headers.get('content-length');
        if (contentLength) responseHeaders.set('Content-Length', contentLength);

        const contentRange = response.headers.get('content-range');
        if (contentRange) responseHeaders.set('Content-Range', contentRange);

        const acceptRanges = response.headers.get('accept-ranges');
        if (acceptRanges) responseHeaders.set('Accept-Ranges', acceptRanges);

        return new NextResponse(response.body as any, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders
        });
    } catch (error) {
        console.error('Proxy error:', error);
        return NextResponse.json({ error: 'Proxy failed' }, { status: 500 });
    }
}
