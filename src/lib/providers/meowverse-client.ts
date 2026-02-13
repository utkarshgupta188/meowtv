import { VideoResponse } from './types';
import { getHlsProxyUrl, getSimpleProxyUrl, PROXY_WORKER_URL } from '../proxy-config';

const MAIN_URL = 'https://net22.cc';
const NEW_URL = 'https://net52.cc';

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
                    } else {
                        console.warn(`[CNC Client] Set-Cookie found but t_hash_t NOT found in it.`);
                    }
                }
            } else {
                console.log(`[CNC Client] Bypass check failed (Attempt ${retries + 1}). Status: ${res.status}. Response start: ${verifyCheck.substring(0, 100)}`);
            }

            retries++;
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        throw new Error('Bypass failed after max retries');
    } catch (e) {
        console.error('[CNC Client] Bypass error DETAILS:', e);
        if (useProxy) cachedProxyCookie = null;
        else cachedDirectCookie = null;
        throw e;
    }
}

export async function fetchStreamUrlClient(movieId: string, episodeId: string, audioLang?: string): Promise<VideoResponse | null> {

    try {
        const cookieValue = await bypass(MAIN_URL, true); // PROXIED
        const time = Math.floor(Date.now() / 1000);
        const audioParam = audioLang || '';

        const mergeCookies = (oldCookies: string, newSetCookieHeader: string | null) => {
            if (!newSetCookieHeader) return oldCookies;
            const cookieMap = new Map<string, string>();
            oldCookies.split(';').forEach(c => {
                const [key, val] = c.trim().split('=');
                if (key) cookieMap.set(key, val || '');
            });
            const parts = newSetCookieHeader.split(/,(?=\s*[a-zA-Z0-9_-]+=)/);
            parts.forEach((part) => {
                const mainPart = part.split(';')[0].trim();
                const [key, val] = mainPart.split('=');
                if (key) cookieMap.set(key, val || '');
            });
            return Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
        };

        let streamCookies = `t_hash_t=${cookieValue}; ott=nf; hd=on; user_token=233123f803cf02184bf6c67e149cdd50`;
        const refererNet20 = `${MAIN_URL}/home`;

        if (audioParam) {
            try {
                // Try NEW_URL for language setting (same as playlist)
                const langRes = await proxiedFetch(`${NEW_URL}/language.php`, {
                    method: 'POST',
                    headers: {
                        ...HEADERS,
                        'Cookie': streamCookies,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Referer': refererNet20
                    },
                    body: `lang=${audioParam}`
                });
                streamCookies = mergeCookies(streamCookies, langRes.headers.get('x-proxied-set-cookie') || langRes.headers.get('set-cookie'));
            } catch (e) { /* ignore */ }
        }

        // POST play.php
        let hashParams = '';
        try {
            const playUrl = `${MAIN_URL}/play.php`;
            const playPostRes = await proxiedFetch(playUrl, {
                method: 'POST',
                headers: {
                    ...HEADERS,
                    'Cookie': streamCookies,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': refererNet20
                },
                body: `id=${episodeId}`
            });
            streamCookies = mergeCookies(streamCookies, playPostRes.headers.get('x-proxied-set-cookie') || playPostRes.headers.get('set-cookie'));
            const playText = await playPostRes.text();
            try {
                const playData = JSON.parse(playText);
                if (playData && playData.h) hashParams = `&${playData.h}`;
            } catch { /* ignore */ }
        } catch (e) { /* ignore */ }

        // GET play.php (Session Transfer)
        if (hashParams) {
            try {
                const playGetUrl = `${NEW_URL}/play.php?id=${episodeId}${hashParams}`;
                const playGetRes = await proxiedFetch(playGetUrl, {
                    headers: { ...HEADERS, 'Cookie': streamCookies, 'Referer': refererNet20 },
                    redirect: 'manual'
                });
                streamCookies = mergeCookies(streamCookies, playGetRes.headers.get('x-proxied-set-cookie') || playGetRes.headers.get('set-cookie'));
            } catch (e) { /* ignore */ }
        }

        // Fetch Title from post.php (Required for playlist.php to generate valid tokens)
        let contentTitle = '';
        try {
            const postUrl = `${MAIN_URL}/post.php?id=${movieId}&t=${time}`;
            const postRes = await proxiedFetch(postUrl, {
                headers: { ...HEADERS, 'Cookie': streamCookies, 'Referer': refererNet20 }
            });
            const postData = await postRes.json();
            contentTitle = postData.title || postData.t || '';
        } catch (e) { /* ignore */ }

        // Build Playlist URL
        // CLI Logic: t={title}, h={clean_hash}
        let hashClean = '';
        if (hashParams) {
            const rawH = hashParams.replace('&', ''); // Remove leading &
            if (rawH.startsWith('in=')) hashClean = rawH.substring(3);
            else hashClean = rawH;
        }

        const finalHashParam = hashClean ? `&h=${hashClean}` : '';
        const titleParam = encodeURIComponent(contentTitle);

        // Use /playlist.php (NOT /tv/playlist.php)
        const url = `${NEW_URL}/playlist.php?id=${episodeId}&t=${titleParam}&tm=${time}${finalHashParam}`;

        let resText = '';
        let playlistBaseUrl = NEW_URL;
        let playlistReferer = `${NEW_URL}/`;

        try {
            const playlistRes = await proxiedFetch(url, { headers: { ...HEADERS, 'Cookie': streamCookies, 'Referer': `${NEW_URL}/home` } });
            resText = await playlistRes.text();
            streamCookies = mergeCookies(streamCookies, playlistRes.headers.get('x-proxied-set-cookie') || playlistRes.headers.get('set-cookie'));
        } catch (e) { /* ignore */ }

        if (!resText || /Video ID not found!/i.test(resText)) {
            const url2 = `${MAIN_URL}/playlist.php?id=${episodeId}&t=${titleParam}&tm=${time}${finalHashParam}`;
            try {
                const fallbackRes = await proxiedFetch(url2, { headers: { ...HEADERS, 'Cookie': streamCookies, 'Referer': refererNet20 } });
                resText = await fallbackRes.text();
                streamCookies = mergeCookies(streamCookies, fallbackRes.headers.get('x-proxied-set-cookie') || fallbackRes.headers.get('set-cookie'));
                playlistBaseUrl = MAIN_URL;
                playlistReferer = `${MAIN_URL}/`;
            } catch (e) { console.error(e); }
        }

        let playlist;
        try { playlist = JSON.parse(resText); } catch { return null; }

        if (playlist && playlist.length > 0) {
            const item = playlist[0];
            const sources = item.sources || [];
            if (sources.length > 0) {
                const defaultSource = sources[0];
                const sourceFile = String(defaultSource.file ?? '');
                const m3u8Url = sourceFile.startsWith('http')
                    ? sourceFile
                    : `${playlistBaseUrl}${sourceFile.replace('/tv/', '/')}`;

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
                                // Strip trailing slash from base to avoid double slashes
                                const base = playlistBaseUrl.endsWith('/') ? playlistBaseUrl.slice(0, -1) : playlistBaseUrl;
                                const path = subUrl.startsWith('/') ? subUrl : `/${subUrl}`;
                                subUrl = `${base}${path}`;
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
                    qualities: sources.map((s: any) => ({
                        quality: s.label || 'Auto',
                        url: getHlsProxyUrl(String(s.file).startsWith('http') ? s.file : `${playlistBaseUrl}${s.file.replace('/tv/', '/')}`, {
                            referer: playlistReferer,
                            cookie: streamCookies,
                            ua: HEADERS['User-Agent']
                        })
                    })),
                    headers: {}
                };
            }
        }
        return null;
    } catch { return null; }
}
