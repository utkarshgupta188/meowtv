import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// Kartoons Decryption Helpers
const STREAM_SECRET = Buffer.from("cG1TMENBTUcxUnVxNDlXYk15aEUzZmgxc091TFlFTDlydEZhellZbGpWSTJqNEJQU29nNzNoVzdBN3hNaGNlSEQwaXdyUHJWVkRYTHZ4eVdy", "base64").toString('utf-8');

function deriveKeySha256() {
    return crypto.createHash('sha256').update(STREAM_SECRET).digest();
}

function base64UrlToBytes(b64url: string): Buffer {
    let s = b64url.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = s.length % 4;
    if (pad !== 0) {
        s += "=".repeat(4 - pad);
    }
    return Buffer.from(s, 'base64');
}

function decryptStream(value: string | null): string | null {
    if (!value || !value.startsWith("enc2:")) return value;

    try {
        const rawB64url = value.substring(5).replace(/\s+/g, ''); // remove "enc2:" + strip whitespace
        const blob = base64UrlToBytes(rawB64url);

        if (blob.length <= 12) return null;

        const iv = blob.subarray(0, 12);
        const ctAndTag = blob.subarray(12);

        // In Node crypto, auth tag is separate. 
        // Java GCMParameterSpec(128, iv) means 128-bit (16 byte) tag is used.
        // Usually appended at end in Java CipherOutputStream or similar.
        const authTagLength = 16;
        const ciphertext = ctAndTag.subarray(0, ctAndTag.length - authTagLength);
        const authTag = ctAndTag.subarray(ctAndTag.length - authTagLength);

        const key = deriveKeySha256();
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(ciphertext);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        return decrypted.toString('utf-8');
    } catch (e) {
        console.error("Decryption failed:", e);
        return null;
    }
}

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
        lower.includes('.key')
    );
}

export async function GET(request: NextRequest) {
    const url = request.nextUrl.searchParams.get('url');
    const referer = request.nextUrl.searchParams.get('referer') || 'https://net51.cc/';
    const cookie = request.nextUrl.searchParams.get('cookie') || 'hd=on';
    const decryptParam = request.nextUrl.searchParams.get('decrypt'); // 'kartoons'

    console.log('[HLS Proxy] === NEW REQUEST ===');
    console.log('[HLS Proxy] URL:', url);
    console.log('[HLS Proxy] Decrypt:', decryptParam);
    console.log('[HLS Proxy] Referer:', referer);

    if (!url) {
        return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
    }

    try {
        const headers: HeadersInit = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': referer,
            'Cookie': cookie
        };

        const response = await fetch(url, { headers });

        if (!response.ok) {
            console.error(`Proxy fetch failed: ${response.status} for ${url}`);
            return NextResponse.json({ error: 'Failed to fetch' }, { status: response.status });
        }

        const contentType = response.headers.get('content-type') || '';
        const contentLength = Number(response.headers.get('content-length') || '0') || 0;

        const looksLikePlaylistByUrl = url.toLowerCase().includes('.m3u8');
        const looksLikePlaylistByType = /mpegurl|m3u8/i.test(contentType);
        const canSniffText =
            !isProbablySegmentUrl(url) &&
            (contentLength === 0 || contentLength <= 2_000_000) &&
            !/application\/octet-stream/i.test(contentType);

        let playlistText: string | null = null;
        if (looksLikePlaylistByUrl || looksLikePlaylistByType) {
            playlistText = await response.text();
        } else if (canSniffText) {
            const probeText = await response.clone().text().catch(() => null);
            if (probeText && looksLikePlaylistText(probeText)) {
                playlistText = probeText;
            }
        }

        // If it's a playlist (even when URL doesn't end with .m3u8), decrypt enc2: and rewrite URLs to go through proxy
        if (playlistText !== null) {
            let text = playlistText;

            const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
            const proxySuffix = `&referer=${encodeURIComponent(referer)}&cookie=${encodeURIComponent(cookie)}${decryptParam ? `&decrypt=${decryptParam}` : ''}`;

            const toAbsolute = (maybeRelative: string) => {
                // Already-local proxied URL; keep as-is (prevents proxy recursion)
                if (maybeRelative.startsWith('/api/hls?') || maybeRelative.startsWith('/api/proxy?')) return maybeRelative;
                if (maybeRelative.startsWith('http')) return maybeRelative;
                return baseUrl + maybeRelative;
            };

            const decryptIfNeeded = (value: string) => {
                if (!value.includes('enc2:')) return value;
                // Most often the value is exactly "enc2:...".
                if (value.startsWith('enc2:')) {
                    const decrypted = decryptStream(value);
                    return decrypted ?? value;
                }

                // Defensive: if a tag contains an enc2 token inside a larger string, decrypt tokens in-place.
                return value.replace(/enc2:[A-Za-z0-9_-]+/g, (token) => decryptStream(token) ?? token);
            };

            const wrapProxy = (absoluteUrl: string) => {
                // If it's already our proxy, don't wrap again.
                if (absoluteUrl.startsWith('/api/hls?') || absoluteUrl.startsWith('/api/proxy?')) return absoluteUrl;
                return `/api/hls?url=${encodeURIComponent(absoluteUrl)}${proxySuffix}`;
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
                    absoluteUrl = toAbsolute(absoluteUrl);
                    return `${keyName}="${wrapProxy(absoluteUrl)}"`;
                });

                // Unquoted form: URI=foo.m3u8 or URI=https://... or URI=enc2:...
                // Only rewrite if it looks like a URL/path token (stop at comma/space)
                out = out.replace(/(URI|KEYFORMATURI)=([^,\s]+)/gi, (_match, keyName: string, uri: string) => {
                    // If it was already handled by quoted pass or already proxied, skip.
                    if (uri.startsWith('"') || uri.startsWith('/api/hls?')) return `${keyName}=${uri}`;
                    let absoluteUrl = decryptIfNeeded(uri);
                    absoluteUrl = toAbsolute(absoluteUrl);
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
                absoluteUrl = toAbsolute(absoluteUrl);
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
        const data = await response.arrayBuffer();

        return new NextResponse(data, {
            headers: {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=3600'
            }
        });
    } catch (error) {
        console.error('HLS Proxy error:', error);
        return NextResponse.json({ error: 'Proxy failed' }, { status: 500 });
    }
}
