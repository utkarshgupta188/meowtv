/**
 * HLS Proxy Worker for Cloudflare
 * 
 * Mirrors the functionality of the Next.js /api/hls route.
 * Handles:
 * 1. Fetching upstream playlists/segments
 * 2. Rewriting M3U8 manifests to point back to this worker
 * 3. Repairing broken `in` tokens on freecdn/netmirror URLs
 * 4. SRT → WebVTT subtitle conversion
 * 5. Content-type fix for segments served as text/javascript
 * 6. CORS support
 */

export default {
    async fetch(request, env, ctx) {
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
                    'Access-Control-Allow-Headers': '*',
                    'Access-Control-Max-Age': '86400',
                },
            });
        }

        const urlObj = new URL(request.url);
        const params = urlObj.searchParams;

        if (urlObj.pathname === '/api/hls') {
            return handleHlsRequest(request, params);
        } else if (urlObj.pathname === '/api/proxy') {
            return handleProxyRequest(request, params);
        }

        return new Response('Usage: /api/hls?url=... or /api/proxy?url=...', { status: 400 });
    }
};

function isProbablySegmentUrl(u) {
    const lower = u.toLowerCase();
    return (
        lower.includes('.ts') ||
        lower.includes('.m4s') ||
        lower.includes('.mp4') ||
        lower.includes('.mkv') ||
        lower.includes('.aac') ||
        lower.includes('.mp3') ||
        lower.includes('.key') ||
        lower.includes('/segment/')
    );
}

function looksLikePlaylistText(text) {
    return /^#EXTM3U\b/m.test(text);
}

async function handleHlsRequest(request, params) {
    const url = params.get('url');
    const concat = params.get('concat');
    const referer = params.get('referer') || 'https://net51.cc/';
    const cookie = params.get('cookie') || 'hd=on';
    const decryptParam = params.get('decrypt');
    const kindParam = (params.get('kind') || '').toLowerCase();
    const proxySegments = params.get('proxy_segments') !== 'false';
    const rangeHeader = request.headers.get('range');
    const uaParam = params.get('ua');

    const headers = {
        'User-Agent': uaParam || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': referer,
        'Cookie': cookie
    };

    // 1. Handle Concat Request (Merged Segments)
    if (concat) {
        if (!proxySegments) {
            return new Response('Segment proxying disabled', { status: 400 });
        }
        try {
            const urls = concat.split('|');
            if (urls.length > 20) return new Response('Too many segments', { status: 400 });

            const responses = await Promise.all(urls.map(u => fetch(u, { headers }).then(r => {
                if (!r.ok) throw new Error(`Failed to fetch ${u}`);
                return r.arrayBuffer();
            })));

            const totalLength = responses.reduce((acc, b) => acc + b.byteLength, 0);
            const merged = new Uint8Array(totalLength);
            let offset = 0;
            for (const b of responses) {
                merged.set(new Uint8Array(b), offset);
                offset += b.byteLength;
            }

            return new Response(merged, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'public, max-age=31536000',
                    'Content-Type': 'video/MP2T'
                }
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: 'Concat failed: ' + error.message }), { status: 500 });
        }
    }

    if (!url) {
        return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        if (rangeHeader) {
            headers['Range'] = rangeHeader;
        }

        const response = await fetch(url, { headers });

        if (!response.ok) {
            return new Response(JSON.stringify({ error: 'Failed to fetch', status: response.status }), {
                status: response.status,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }

        const contentType = response.headers.get('content-type') || '';
        const contentLength = Number(response.headers.get('content-length') || '0') || 0;

        const forceSeg = kindParam === 'seg';
        const forcePlaylist = kindParam === 'playlist';

        const looksLikePlaylistByUrl = url.toLowerCase().includes('.m3u8');
        const looksLikePlaylistByType = /mpegurl|m3u8/i.test(contentType);
        const canSniffText =
            !forceSeg &&
            !isProbablySegmentUrl(url) &&
            (contentLength === 0 || contentLength <= 2_000_000) &&
            !/application\/octet-stream/i.test(contentType);

        let playlistText = null;
        if (forcePlaylist || looksLikePlaylistByUrl || looksLikePlaylistByType) {
            playlistText = await response.text();
        } else if (canSniffText) {
            const probeText = await response.clone().text().catch(() => null);
            if (probeText && looksLikePlaylistText(probeText)) {
                playlistText = probeText;
            }
        }

        // Process Playlist
        if (playlistText !== null) {
            const workerOrigin = new URL(request.url).origin;

            // Extract valid 'in' token from the master playlist URL to repair broken sub-playlists
            let masterInToken = '';
            try {
                masterInToken = (new URL(url).searchParams.get('in') || '').trim();
            } catch { }

            const baseProxySuffix = `&referer=${encodeURIComponent(referer)}&cookie=${encodeURIComponent(cookie)}${uaParam ? `&ua=${encodeURIComponent(uaParam)}` : ''}${decryptParam ? `&decrypt=${decryptParam}` : ''}${!proxySegments ? '&proxy_segments=false' : ''}`;

            const isBadUpstream = (absoluteUrl) => {
                try {
                    const u = new URL(absoluteUrl);
                    const inParam = (u.searchParams.get('in') || '').toLowerCase();
                    // If we have a master token, we can repair 'unknown' tokens, so don't drop them.
                    if (masterInToken && inParam.includes('unknown')) return false;
                    // Only drop URLs with explicitly broken tokens (in=unknown) if we can't repair them.
                    return inParam === 'unknown';
                } catch {
                    return false;
                }
            };

            const resolveUrl = (maybeRelative) => {
                const ref = maybeRelative.trim();
                // Already proxied URL; keep as-is
                if (ref.startsWith(workerOrigin + '/api/hls?') || ref.startsWith('/api/hls?') || ref.startsWith('/api/proxy?')) return ref;
                if (/^https?:\/\//i.test(ref)) return ref;
                try { return new URL(ref, url).toString(); } catch { return ref; }
            };

            const inferKind = (absoluteUrl) => {
                const lower = absoluteUrl.toLowerCase();
                if (lower.includes('.m3u8') || /mpegurl|m3u8/i.test(lower)) return 'playlist';
                return 'seg';
            };

            const wrapProxy = (rawUrl, kind) => {
                let absoluteUrl = rawUrl;
                // Repair broken 'in' tokens (e.g. in=unknown::ni)
                if (masterInToken) {
                    try {
                        const u = new URL(absoluteUrl);
                        const subIn = (u.searchParams.get('in') || '').toLowerCase();
                        const isFreeCdn = u.hostname.includes('freecdn') || u.hostname.includes('netmirror');

                        if (subIn.includes('unknown') || (isFreeCdn && !subIn)) {
                            u.searchParams.set('in', masterInToken);
                            absoluteUrl = u.toString();
                        }
                    } catch { }
                }

                // If already proxied, don't wrap again
                if (absoluteUrl.startsWith(workerOrigin + '/api/hls?') || absoluteUrl.startsWith('/api/hls?') || absoluteUrl.startsWith('/api/proxy?')) return absoluteUrl;
                const k = kind ?? inferKind(absoluteUrl);

                if (!proxySegments && k === 'seg') return absoluteUrl;

                return `${workerOrigin}/api/hls?url=${encodeURIComponent(absoluteUrl)}&kind=${k}${baseProxySuffix}`;
            };

            const rewriteUriAttributes = (line) => {
                let out = line;
                // Handle URI="..." attributes
                out = out.replace(/(URI|KEYFORMATURI)="([^"]+)"/gi, (_match, keyName, uri) => {
                    if (uri.startsWith('/api/hls?') || uri.startsWith(workerOrigin + '/api/hls?')) return `${keyName}="${uri}"`;
                    let absoluteUrl = resolveUrl(uri);
                    return `${keyName}="${wrapProxy(absoluteUrl)}"`;
                });
                // Unquoted form: URI=foo.m3u8
                out = out.replace(/(URI|KEYFORMATURI)=([^,\s]+)/gi, (_match, keyName, uri) => {
                    if (uri.startsWith('"') || uri.startsWith('/api/hls?') || uri.startsWith(workerOrigin + '/api/hls?')) return `${keyName}=${uri}`;
                    let absoluteUrl = resolveUrl(uri);
                    return `${keyName}=${wrapProxy(absoluteUrl)}`;
                });
                return out;
            };

            // Rewrite URLs in the m3u8
            const lines = playlistText.split('\n');
            const resultLines = [];
            for (const line of lines) {
                if (line.trim() === '') {
                    resultLines.push(line);
                    continue;
                }

                // Tag/comment lines: rewrite URI attributes
                if (line.startsWith('#')) {
                    resultLines.push(rewriteUriAttributes(line));
                    continue;
                }

                // Regular URL lines
                const trimmed = line.trim();
                if (trimmed.startsWith('/api/hls?') || trimmed.startsWith(workerOrigin + '/api/hls?') || trimmed.startsWith('/api/proxy?')) {
                    resultLines.push(trimmed);
                    continue;
                }

                let absoluteUrl = resolveUrl(trimmed);

                if (isBadUpstream(absoluteUrl)) {
                    // Drop bad variant/segment; also drop preceding STREAM-INF if present
                    const last = resultLines[resultLines.length - 1] || '';
                    if (last.startsWith('#EXT-X-STREAM-INF')) resultLines.pop();
                    continue;
                }

                resultLines.push(wrapProxy(absoluteUrl));
            }

            const rewrittenM3u8 = resultLines.join('\n');
            const isVod = rewrittenM3u8.includes('#EXT-X-ENDLIST');

            const resHeaders = {
                'Content-Type': 'application/vnd.apple.mpegurl',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': isVod ? 'public, max-age=14400' : 'no-cache'
            };

            const setCookie = response.headers.get('set-cookie');
            if (setCookie) resHeaders['X-Proxied-Set-Cookie'] = setCookie;

            return new Response(rewrittenM3u8, { headers: resHeaders });
        }

        // Convert SRT subtitles to WebVTT
        if (url.includes('.srt') || contentType.includes('subrip')) {
            const srtText = await response.text();
            const vttText = 'WEBVTT\n\n' + srtText
                .replace(/\r\n|\r|\n/g, '\n')
                .replace(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/g, '$1:$2:$3.$4')
                .trim();

            return new Response(vttText, {
                headers: {
                    'Content-Type': 'text/vtt; charset=utf-8',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'public, max-age=3600'
                }
            });
        }

        // Proxy Binary/Segment
        let finalContentType = contentType || 'application/octet-stream';

        // Fix for freecdn segments served as text/javascript
        if ((kindParam === 'seg' || isProbablySegmentUrl(url)) &&
            (finalContentType.includes('text/javascript') || finalContentType.includes('application/javascript'))) {
            finalContentType = 'application/octet-stream';
        }

        const contentRange = response.headers.get('content-range') || '';
        const acceptRanges = response.headers.get('accept-ranges') || '';
        const upstreamLength = response.headers.get('content-length') || '';

        const outHeaders = {
            'Content-Type': finalContentType,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': rangeHeader ? 'no-cache' : 'public, max-age=3600'
        };

        if (contentRange) outHeaders['Content-Range'] = contentRange;
        if (acceptRanges) outHeaders['Accept-Ranges'] = acceptRanges;
        if (upstreamLength) outHeaders['Content-Length'] = upstreamLength;

        return new Response(response.body, {
            status: response.status,
            headers: outHeaders
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: 'Proxy failed: ' + error.message }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}

async function handleProxyRequest(request, params) {
    const url = params.get('url');
    if (!url) return new Response('Missing url', { status: 400 });

    const referer = params.get('referer');
    const cookie = params.get('cookie');
    const uaParam = params.get('ua');
    const range = request.headers.get('range');

    try {
        const headers = {
            'User-Agent': uaParam || request.headers.get('user-agent') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
        if (referer) headers['Referer'] = referer;
        if (cookie) headers['Cookie'] = cookie;
        if (range) headers['Range'] = range;

        // Forward critical headers for Auth/POST requests and Bot Protection (Cloudflare)
        const allowedHeaders = [
            'content-type', 'x-requested-with', 'accept', 'origin', 'authorization', 'cookie', 'referer',
            'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'accept-language', 'priority', 'dnt'
        ];
        for (const h of allowedHeaders) {
            const v = request.headers.get(h);
            if (v) headers[h] = v;
        }

        // Params override headers
        if (referer) headers['Referer'] = referer;
        if (cookie) headers['Cookie'] = cookie;

        // Force Origin to match Referer to prevent blocking
        const method = request.method;
        try {
            const finalReferer = headers['Referer'];
            if (finalReferer) {
                headers['Origin'] = new URL(finalReferer).origin;
            } else if (method === 'POST') {
                headers['Origin'] = new URL(url).origin;
            }
        } catch (e) { }

        const body = method !== 'GET' && method !== 'HEAD' ? request.body : undefined;
        const redirectMode = params.get('redirect') || 'follow';

        const response = await fetch(url, {
            method,
            headers,
            body,
            redirect: redirectMode,
            cf: { cacheTtl: 0, cacheEverything: false }
        });

        const newHeaders = new Headers(response.headers);
        newHeaders.set('Access-Control-Allow-Origin', '*');
        newHeaders.set('Access-Control-Expose-Headers', 'X-Proxied-Set-Cookie');

        const setCookie = response.headers.get('set-cookie');
        if (setCookie) {
            newHeaders.set('X-Proxied-Set-Cookie', setCookie);
        }

        if (!newHeaders.has('Accept-Ranges')) {
            newHeaders.set('Accept-Ranges', 'bytes');
        }

        return new Response(response.body, {
            status: response.status,
            headers: newHeaders
        });
    } catch (e) {
        return new Response('Error: ' + e.message, {
            status: 500,
            headers: { 'Access-Control-Allow-Origin': '*' }
        });
    }
}
