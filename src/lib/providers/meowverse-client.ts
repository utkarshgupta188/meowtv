import { VideoResponse } from './types';
import { getHlsProxyUrl, getSimpleProxyUrl, PROXY_WORKER_URL } from '../proxy-config';

const MAIN_URL = 'https://net22.cc';
const STREAM_URL = 'https://net52.cc'; // Kotlin CloudStream mainUrl — used for /mobile/playlist.php

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'X-Requested-With': 'XMLHttpRequest',
};

// Cached cookies (Client-Side Memory Cache)
let cachedDirectCookie: string | null = null;
let cachedProxyCookie: string | null = null;
let cacheDirectTimestamp: number = 0;
let cacheProxyTimestamp: number = 0;
const CACHE_DURATION = 54_000_000; // 15 hours

async function proxiedFetch(url: string, init?: RequestInit): Promise<Response> {
    // If no proxy worker, use direct fetch
    if (!PROXY_WORKER_URL) {
        return fetch(url, init);
    }

    // Extract headers that browsers might block if set manually
    const headers = new Headers(init?.headers);
    const cookie = headers.get('Cookie') || headers.get('cookie');
    const referer = headers.get('Referer') || headers.get('referer');

    // Explicitly set headers to null/empty in the fetch options to avoid "unsafe header" warnings
    if (cookie) headers.delete('Cookie');
    if (referer) headers.delete('Referer');

    // Use proxy with explicit params
    const proxyUrl = getSimpleProxyUrl(url, {
        ...(init?.redirect ? { redirect: init.redirect } : {}),
        ua: HEADERS['User-Agent'], // Force UA
        ...(cookie ? { cookie } : {}),
        ...(referer ? { referer } : {})
    });

    // Cloudflare Worker expects body to be passed as body to the proxy endpoint
    return fetch(proxyUrl, {
        ...init,
        headers
        // body is preserved in init
    });
}

async function bypass(mainUrl: string, useProxy: boolean = false): Promise<string> {
    // Select cache based on mode
    const cachedCookie = useProxy ? cachedProxyCookie : cachedDirectCookie;
    const timestamp = useProxy ? cacheProxyTimestamp : cacheDirectTimestamp;

    // Return cached cookie if valid
    if (cachedCookie && Date.now() - timestamp < CACHE_DURATION) {
        return cachedCookie;
    }

    try {
        let verifyCheck: string;
        let retries = 0;
        const maxRetries = 10;


        while (retries < maxRetries) {
            const fetchFn = useProxy ? proxiedFetch : fetch;
            // Add cache buster to prevent cached responses (missing Set-Cookie)
            const bypassUrl = `${mainUrl}/tv/p.php?_=${Date.now()}`;


            const res = await fetchFn(bypassUrl, {
                method: 'POST',
                headers: {
                    ...HEADERS,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': `${mainUrl}/home`,
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                },
                body: `t=${Date.now()}` // Random body to force cache flush
            });

            verifyCheck = await res.text();

            // Check if Cloudflare challenge passed
            if (verifyCheck.includes('"r":"n"')) {
                const setCookie = useProxy
                    ? (res.headers.get('x-proxied-set-cookie') || res.headers.get('set-cookie'))
                    : res.headers.get('set-cookie');

                if (setCookie) {
                    const match = setCookie.match(/t_hash_t=([^;]+)/);
                    if (match) {
                        const cookieVal = match[1];
                        if (useProxy) {
                            cachedProxyCookie = cookieVal;
                            cacheProxyTimestamp = Date.now();
                        } else {
                            cachedDirectCookie = cookieVal;
                            cacheDirectTimestamp = Date.now();
                        }

                        return cookieVal;
                    } else { /* t_hash_t not in cookie */ }
                }
            } else { /* bypass check failed */ }

            retries++;
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        throw new Error('Bypass failed after max retries');
    } catch (e) {

        if (useProxy) cachedProxyCookie = null;
        else cachedDirectCookie = null;
        throw e;
    }
}

export async function fetchStreamUrlClient(movieId: string, episodeId: string, audioLang?: string): Promise<VideoResponse | null> {

    try {
        const cookieValue = await bypass(STREAM_URL, true); // PROXIED
        const time = Math.floor(Date.now() / 1000);
        const audioParam = audioLang || '';

        let streamCookies = `t_hash_t=${cookieValue}; ott=nf; hd=on; user_token=233123f803cf02184bf6c67e149cdd50`;
        const refererMain = `${STREAM_URL}/`;

        if (audioParam) {
            try {
                await proxiedFetch(`${STREAM_URL}/language.php`, {
                    method: 'POST',
                    headers: {
                        ...HEADERS,
                        'Cookie': streamCookies,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Referer': refererMain
                    },
                    body: `lang=${audioParam}`
                });
            } catch (e) { /* ignore */ }
        }

        // Fetch content title (needed for playlist t= param)
        let contentTitle = audioParam;
        try {
            const postRes = await proxiedFetch(`${STREAM_URL}/post.php?id=${movieId}&t=${time}`, {
                headers: { ...HEADERS, 'Cookie': streamCookies, 'Referer': refererMain }
            });
            const postData = await postRes.json();
            contentTitle = postData.title || postData.t || contentTitle;
        } catch (e) { /* use audioParam as fallback */ }

        // Use /mobile/playlist.php — matches the working Kotlin CloudStream extension
        const url = `${STREAM_URL}/mobile/playlist.php?id=${episodeId}&t=${encodeURIComponent(contentTitle)}&tm=${time}`;
        const playlistBaseUrl = STREAM_URL;
        const playlistReferer = `${STREAM_URL}/`;

        let resText = '';
        try {
            const playlistRes = await proxiedFetch(url, {
                headers: { ...HEADERS, 'Cookie': streamCookies, 'Referer': playlistReferer }
            });
            resText = await playlistRes.text();
        } catch (e) { return null; }

        let playlist;
        try { playlist = JSON.parse(resText); } catch { return null; }

        if (playlist && playlist.length > 0) {
            const item = playlist[0];
            const sources = item.sources || [];
            if (sources.length > 0) {
                const defaultSource = sources[0];
                const sourceFile = String(defaultSource.file ?? '');
                // Kotlin prepends mainUrl to relative file paths
                const m3u8Url = sourceFile.startsWith('http')
                    ? sourceFile
                    : `${playlistBaseUrl}${sourceFile}`;

                const proxyUrl = getHlsProxyUrl(m3u8Url, {
                    referer: playlistReferer,
                    cookie: streamCookies,
                    ua: HEADERS['User-Agent']
                });

                return {
                    videoUrl: proxyUrl,
                    subtitles: (item.tracks || [])
                        .filter((t: any) => {
                            const kind = String(t?.kind ?? '').toLowerCase();
                            const file = String(t?.file ?? '').toLowerCase();
                            if (kind.includes('thumb')) return false;
                            return (
                                kind.includes('caption') ||
                                kind.includes('sub') ||
                                ((file.endsWith('.vtt') || file.endsWith('.srt')) && !kind)
                            );
                        })
                        .map((t: any) => {
                            const rawLang = String(t?.srclang || t?.lang || t?.language || '').trim();
                            const label = String(t?.label || t?.name || rawLang || 'Subtitles');
                            const rawFile = String(t?.file || '').trim();

                            let subUrl = rawFile;
                            if (subUrl.startsWith('//')) {
                                subUrl = `https:${subUrl}`;
                            } else if (subUrl && !subUrl.startsWith('http')) {
                                subUrl = `${playlistBaseUrl}${subUrl.startsWith('/') ? subUrl : `/${subUrl}`}`;
                            }

                            return {
                                language: rawLang || 'en',
                                label: label,
                                url: getHlsProxyUrl(subUrl, {
                                    referer: playlistReferer,
                                    cookie: streamCookies,
                                    ua: HEADERS['User-Agent']
                                })
                            };
                        }),
                    qualities: sources.map((s: any) => {
                        const rawLabel = s.label || 'Auto';
                        const quality = rawLabel === 'Auto' ? 'Full HD' : rawLabel === 'Mid HD' ? '720p' : rawLabel;
                        return {
                            quality,
                            url: getHlsProxyUrl(
                                String(s.file).startsWith('http') ? s.file : `${playlistBaseUrl}${s.file}`,
                                {
                                    referer: playlistReferer,
                                    cookie: streamCookies,
                                    ua: HEADERS['User-Agent']
                                }
                            )
                        };
                    }),
                    headers: {}
                };
            }
        }
        return null;
    } catch { return null; }
}
