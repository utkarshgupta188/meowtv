import { NextRequest, NextResponse } from 'next/server';
import { decryptInline, decryptStream } from '@/lib/enc2';

function looksLikePlaylistText(text: string): boolean {
    return /^#EXTM3U\b/m.test(text);
}

function isProbablySegmentUrl(u: string): boolean {
    const lower = u.toLowerCase();
    return (
        lower.includes('.ts') ||
        lower.includes('.m4s') ||
        lower.includes('.mp4') ||
        lower.includes('.mkv') ||
        lower.includes('.aac') ||
        lower.includes('.mp3') ||
        lower.includes('.key') ||
        // Some sources use extension-less segment endpoints.
        lower.includes('/segment/')
    );
}

export async function GET(request: NextRequest) {
    const url = request.nextUrl.searchParams.get('url');
    const referer = request.nextUrl.searchParams.get('referer') || 'https://net51.cc/';
    const cookie = request.nextUrl.searchParams.get('cookie') || 'hd=on';
    const decryptParam = request.nextUrl.searchParams.get('decrypt'); // 'kartoons'
    const kindParam = (request.nextUrl.searchParams.get('kind') || '').toLowerCase(); // 'playlist' | 'seg'
    const rangeHeader = request.headers.get('range');



    if (!url) {
        return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
    }

    const uaParam = request.nextUrl.searchParams.get('ua');

    try {
        const headers: HeadersInit = {
            'User-Agent': uaParam || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': referer,
            'Cookie': cookie
        };

        // Preserve byte-range requests from Hls.js (common for fMP4/byte-range streams).
        if (rangeHeader) {
            (headers as any)['Range'] = rangeHeader;
        }

        const response = await fetch(url, { headers, signal: request.signal });

        if (!response.ok) {
            console.error(`Proxy fetch failed: ${response.status} for ${url}`);
            return NextResponse.json({ error: 'Failed to fetch' }, { status: response.status });
        }

        const contentType = response.headers.get('content-type') || '';
        const contentLength = Number(response.headers.get('content-length') || '0') || 0;

        // Helpful diagnostics: some sources return HTML/JSON for segment URLs (403 pages, redirects, etc.)
        // which then surface in the player as "Failed to find demuxer".
        const looksLikeTextual = /text\//i.test(contentType) || /json|html|xml/i.test(contentType);
        if (decryptParam && looksLikeTextual) {
            try {
                const sampleText = await response.clone().text();
                console.warn('[HLS Proxy] Textual upstream response', {
                    url,
                    status: response.status,
                    contentType,
                    contentLength,
                    sample: sampleText.slice(0, 300)
                });
            } catch {
                // ignore
            }
        }

        const forceSeg = kindParam === 'seg';
        const forcePlaylist = kindParam === 'playlist';

        const looksLikePlaylistByUrl = url.toLowerCase().includes('.m3u8');
        const looksLikePlaylistByType = /mpegurl|m3u8/i.test(contentType);
        const canSniffText =
            !forceSeg &&
            !isProbablySegmentUrl(url) &&
            (contentLength === 0 || contentLength <= 2_000_000) &&
            !/application\/octet-stream/i.test(contentType);

        let playlistText: string | null = null;
        if (forcePlaylist || looksLikePlaylistByUrl || looksLikePlaylistByType) {
            playlistText = await response.text();
        } else if (canSniffText) {
            const probeText = await response.clone().text().catch(() => null);
            if (probeText && looksLikePlaylistText(probeText)) {
                playlistText = probeText;
            }
        }

        // If it's a playlist (even when URL doesn't end with .m3u8), decrypt enc2: and rewrite URLs to go through proxy
        if (playlistText !== null) {
            // DEBUG: Check format
            if (!looksLikePlaylistText(playlistText)) {
                console.error('[HLS Proxy Debug] Invalid Playlist Content from:', url);
                console.error('[HLS Proxy Debug] Body Preview:', playlistText.slice(0, 500));
            }
            let text = playlistText;

            const proxySegments = request.nextUrl.searchParams.get('proxy_segments') !== 'false';
            const baseProxySuffix = `&referer=${encodeURIComponent(referer)}&cookie=${encodeURIComponent(cookie)}${decryptParam ? `&decrypt=${decryptParam}` : ''}${!proxySegments ? '&proxy_segments=false' : ''}`;

            // =========================================================================================
            // CRITICAL: repairUrl is REQUIRED for freecdn streams. 
            // Upstream playlists often contain "in=unknown" which MUST be replaced with the valid token
            // from the master playlist URL. DO NOT REMOVE THIS FUNCTION.
            // =========================================================================================
            const repairUrl = (u: string) => {
                // Fix "in=unknown" or similar mangled tokens
                // If we see `&in=` but not `&token=`, we might need to inject the master token if available.
                if (u.includes('in=unknown') || u.includes('in=null')) {
                    // Try to finding the 'in' param from the master playlist URL (the 'url' param of this request)
                    const masterInMatch = url?.match(/[?&]in=([^&]+)/);
                    // console.log('[HLS Repair] Fixing URL:', u);
                    // console.log('[HLS Repair] Master URL:', url);
                    // console.log('[HLS Repair] Match:', masterInMatch ? masterInMatch[1] : 'null');

                    if (masterInMatch) {
                        return u.replace(/in=[^&]+/, `in=${masterInMatch[1]}`);
                    }
                }
                return u;
            };

            const resolveUrl = (maybeRelative: string) => {
                const ref = maybeRelative.trim();
                // Already-local proxied URL; keep as-is (prevents proxy recursion)
                if (ref.startsWith('/api/hls?') || ref.startsWith('/api/proxy?')) return ref;

                // Absolute URL
                if (/^https?:\/\//i.test(ref)) return repairUrl(ref);

                // Resolve relative, root-relative (/foo), ../foo, and query-only (?a=b) correctly
                try {
                    return repairUrl(new URL(ref, url).toString());
                } catch {
                    return repairUrl(ref);
                }
            };

            const decryptIfNeeded = (value: string) => decryptInline(value);

            const inferKind = (absoluteUrl: string) => {
                const lower = absoluteUrl.toLowerCase();
                if (lower.includes('.m3u8') || /mpegurl|m3u8/i.test(lower)) return 'playlist';
                return 'seg';
            };

            const wrapProxy = (absoluteUrl: string, kind?: 'playlist' | 'seg') => {
                // If it's already our proxy, don't wrap again.
                if (absoluteUrl.startsWith('/api/hls?') || absoluteUrl.startsWith('/api/proxy?')) return absoluteUrl;
                const k = kind ?? inferKind(absoluteUrl);

                // If we're not proxying segments and this IS a segment, return the absolute URL directly
                if (!proxySegments && k === 'seg') {
                    return absoluteUrl;
                }

                return `/api/hls?url=${encodeURIComponent(absoluteUrl)}&kind=${k}${baseProxySuffix}`;
            };

            const rewriteUriAttributes = (line: string) => {
                // Decrypt any embedded enc2 tokens first so even odd tag formats won't leak enc2: to the client.
                let out = decryptIfNeeded(line);

                // Handle URI="..." attributes in any tag line (#EXT-X-KEY, #EXT-X-MAP, #EXT-X-I-FRAME-STREAM-INF, #EXT-X-MEDIA, etc.)
                // Some tags may use KEYFORMATURI= as well.
                out = out.replace(/(URI|KEYFORMATURI)="([^"]+)"/gi, (_match, keyName: string, uri: string) => {
                    // If already proxied, leave it.
                    if (uri.startsWith('/api/hls?')) return `${keyName}="${uri}"`;
                    let absoluteUrl = decryptIfNeeded(uri);
                    absoluteUrl = resolveUrl(absoluteUrl);
                    return `${keyName}="${wrapProxy(absoluteUrl)}"`;
                });

                // Unquoted form: URI=foo.m3u8 or URI=https://... or URI=enc2:...
                // Only rewrite if it looks like a URL/path token (stop at comma/space)
                out = out.replace(/(URI|KEYFORMATURI)=([^,\s]+)/gi, (_match, keyName: string, uri: string) => {
                    // If it was already handled by quoted pass or already proxied, skip.
                    if (uri.startsWith('"') || uri.startsWith('/api/hls?')) return `${keyName}=${uri}`;
                    let absoluteUrl = decryptIfNeeded(uri);
                    absoluteUrl = resolveUrl(absoluteUrl);
                    return `${keyName}=${wrapProxy(absoluteUrl)}`;
                });

                return out;
            };

            // Rewrite URLs in the m3u8 to go through our proxy (and decrypt enc2: URLs anywhere)
            const rewrittenM3u8 = text.split('\n').map(line => {
                if (line.trim() === '') return line;

                // Tag/comment lines: rewrite any URI attributes they contain
                if (line.startsWith('#')) {
                    return rewriteUriAttributes(line);
                }

                // Regular URL lines
                const trimmed = line.trim();
                // Idempotency: if playlist already contains proxied lines, keep them.
                if (trimmed.startsWith('/api/hls?') || trimmed.startsWith('/api/proxy?')) return trimmed;

                let absoluteUrl = decryptIfNeeded(trimmed);
                absoluteUrl = resolveUrl(absoluteUrl);
                return wrapProxy(absoluteUrl);
            }).join('\n');

            return new NextResponse(rewrittenM3u8, {
                headers: {
                    'Content-Type': 'application/vnd.apple.mpegurl',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-cache'
                }
            });
        }

        // Convert SRT subtitles to WebVTT
        if (url.includes('.srt') || contentType.includes('subrip')) {
            const srtText = await response.text();

            // SRT to WebVTT conversion
            const vttText = 'WEBVTT\n\n' + srtText
                .replace(/\r\n|\r|\n/g, '\n')
                .replace(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/g, '$1:$2:$3.$4')
                .trim();

            return new NextResponse(vttText, {
                headers: {
                    'Content-Type': 'text/vtt; charset=utf-8',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'public, max-age=3600'
                }
            });
        }

        // For other resources (segments, images), just proxy them

        const contentRange = response.headers.get('content-range') || '';
        const acceptRanges = response.headers.get('accept-ranges') || '';
        const upstreamLength = response.headers.get('content-length') || '';

        const outHeaders: Record<string, string> = {
            'Content-Type': contentType || 'application/octet-stream',
            'Access-Control-Allow-Origin': '*',
            // Byte-range responses should not be cached aggressively.
            'Cache-Control': rangeHeader ? 'no-cache' : 'public, max-age=3600'
        };

        if (contentRange) outHeaders['Content-Range'] = contentRange;
        if (acceptRanges) outHeaders['Accept-Ranges'] = acceptRanges;
        if (upstreamLength) outHeaders['Content-Length'] = upstreamLength;

        // Stream instead of buffering (reduces latency/memory and avoids large arrayBuffers)
        return new NextResponse(response.body, {
            status: response.status,
            headers: outHeaders
        });
    } catch (error) {
        console.error('HLS Proxy error:', error);
        return NextResponse.json({ error: 'Proxy failed' }, { status: 500 });
    }
}
