import { Provider, HomePageRow, ContentItem, MovieDetails, Episode, VideoResponse } from './types';
import * as cheerio from 'cheerio';
import { getHlsProxyUrl, getSimpleProxyUrl } from '../proxy-config';

const MAIN_URL = 'https://net22.cc';
const STREAM_URL = 'https://net52.cc'; // Kotlin CloudStream mainUrl — used for /mobile/playlist.php

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 12; RMX2117 Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/147.0.7727.55 Mobile Safari/537.36 /OS.Gatu v3.0',
    'X-Requested-With': 'XMLHttpRequest',
};

// Cached cookies
let cachedDirectCookie: string | null = null;
let cachedProxyCookie: string | null = null;
let cacheDirectTimestamp: number = 0;
let cacheProxyTimestamp: number = 0;
const CACHE_DURATION = 54_000_000; // 15 hours

// Helper to fetch via proxy if configured
async function proxiedFetch(url: string, init?: RequestInit): Promise<Response> {
    const { PROXY_WORKER_URL, getSimpleProxyUrl } = await import('../proxy-config');

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

    const mobileUA = HEADERS['User-Agent'];
    const fetchFn = useProxy ? proxiedFetch : fetch;

    try {
        // 1. GET mobile home to get addhash
        const res = await fetchFn(`${mainUrl}/mobile/home?app=1`, {
            headers: {
                'User-Agent': mobileUA,
                'X-Requested-With': 'app.netmirror.netmirrornew'
            }
        });
        const html = await res.text();
        const hashMatch = html.match(/data-addhash="([^"]+)"/);
        if (!hashMatch) throw new Error('Could not find data-addhash');
        const addhash = hashMatch[1];

        // 2. GET userver to register the hash
        const time = Math.floor(Date.now() / 1000);
        await fetchFn(`https://userver.net52.cc/?jjoii=${addhash}&a=y&t=${time}`, {
            headers: { 'User-Agent': mobileUA }
        });

        // 3. Wait and verify loop (up to 8 times with 10s delay)
        let retries = 0;
        while (retries < 8) {
            // Wait 10 seconds (as seen in Kotlin delay(10000))
            await new Promise(resolve => setTimeout(resolve, 10000));
            
            try {
                const vRes = await fetchFn(`${mainUrl}/mobile/verify2.php`, {
                    method: 'POST',
                    headers: {
                        'User-Agent': mobileUA,
                        'X-Requested-With': 'XMLHttpRequest',
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: `verify=${addhash}`
                });
                const verifyCheck = await vRes.text();
                
                if (verifyCheck.includes('"statusup":"All Done"')) {
                    const setCookie = useProxy
                        ? (vRes.headers.get('x-proxied-set-cookie') || vRes.headers.get('set-cookie'))
                        : vRes.headers.get('set-cookie');
                    
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
                        }
                    }
                }
            } catch (e) {
                // Ignore transient fetch errors during verify loop
            }
            retries++;
        }

        throw new Error('Bypass failed after max retries');
    } catch (e) {
        console.error('[CNC Verse] Bypass error DETAILS:', e);
        if (useProxy) cachedProxyCookie = null;
        else cachedDirectCookie = null;
        throw e;
    }
}

// Helper function to fetch all pages from paginated endpoints
async function fetchAllPages(
    baseUrl: string,
    headers: HeadersInit,
    episodeProcessor: (ep: any) => Episode
): Promise<Episode[]> {
    const allEpisodes: Episode[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    while (hasMorePages) {
        try {
            const url = currentPage === 1 ? baseUrl : `${baseUrl}&page=${currentPage}`;


            const res = await proxiedFetch(url, { headers });
            const data = await res.json();

            if (data.episodes && data.episodes.length > 0) {
                data.episodes.forEach((ep: any) => {
                    if (ep) allEpisodes.push(episodeProcessor(ep));
                });



                if (data.nextPageShow === 0 || data.nextPageShow === '0') {
                    hasMorePages = false;
                } else if (data.nextPage && currentPage >= data.nextPage) {
                    hasMorePages = false;
                } else if (data.episodes.length < 10) {
                    hasMorePages = false;
                } else if (data.nextPageShow === 1 || data.nextPageShow === '1') {
                    hasMorePages = true;
                } else if (data.nextPage && currentPage < data.nextPage) {
                    hasMorePages = true;
                } else if (currentPage === 1 && data.episodes.length === 10) {
                    hasMorePages = true;
                } else {
                    hasMorePages = false;
                }
            } else {

                hasMorePages = false;
                break;
            }

            currentPage++;

            // Safety limit to prevent infinite loops
            if (currentPage > 100) {

                break;
            }
        } catch (err) {

            hasMorePages = false;
        }
    }


    return allEpisodes;
}

export const MeowVerseProvider: Provider = {
    name: 'MeowVerse',

    async fetchHome(page: number): Promise<Promise<HomePageRow[]>[]> {
        if (page > 1) return [];

        const fetchRows = async (): Promise<HomePageRow[]> => {
            try {
                const cookieValue = await bypass(STREAM_URL, true); // Proxied, net52.cc like Kotlin
                const headers = {
                    ...HEADERS,
                    'Cookie': `t_hash_t=${cookieValue}; ott=nf; hd=on; user_token=233123f803cf02184bf6c67e149cdd50`
                };

                const res = await proxiedFetch(`${STREAM_URL}/home`, { headers });
                const html = await res.text();
                const $ = cheerio.load(html);
                const rows: HomePageRow[] = [];

                $('.lolomoRow').each((_, elem) => {
                    const name = $(elem).find('h2 > span > div').text().trim();
                    const contents: ContentItem[] = [];

                    $(elem).find('img.lazy').each((_, img) => {
                        const src = $(img).attr('data-src');
                        const id = src?.split('/').pop()?.split('.')[0];
                        if (id) {
                            contents.push({
                                title: '',
                                coverImage: `https://imgcdn.kim/poster/v/${id}.jpg`,
                                id: id,
                                type: 'movie'
                            });
                        }
                    });

                    if (contents.length > 0) rows.push({ name, contents });
                });

                return rows;
            } catch (e) {
                return [];
            }
        };

        return [fetchRows()];
    },

    async search(query: string): Promise<ContentItem[]> {
        try {
            const cookieValue = await bypass(STREAM_URL, true); // Proxied, net52.cc like Kotlin
            const time = Math.floor(Date.now() / 1000);
            const url = `${STREAM_URL}/search.php?s=${encodeURIComponent(query)}&t=${time}`;

            const headers = {
                ...HEADERS,
                'Cookie': `t_hash_t=${cookieValue}; ott=nf; hd=on`,
                'Referer': `${STREAM_URL}/tv/home`
            };

            const res = await proxiedFetch(url, { headers });
            const data = await res.json();

            return (data.searchResult || []).map((item: any) => ({
                title: item.t,
                coverImage: `https://imgcdn.kim/poster/v/${item.id}.jpg`,
                id: item.id,
                type: 'movie'
            }));
        } catch (e) {

            return [];
        }
    },

    async fetchDetails(id: string, includeEpisodes: boolean = true): Promise<MovieDetails | null> {
        try {
            const cookieValue = await bypass(STREAM_URL, true); // Proxied, net52.cc like Kotlin
            const time = Math.floor(Date.now() / 1000);
            const url = `${STREAM_URL}/post.php?id=${id}&t=${time}`;

            const headers = {
                ...HEADERS,
                'Cookie': `t_hash_t=${cookieValue}; ott=nf; hd=on`,
                'Referer': `${STREAM_URL}/tv/home`
            };

            const res = await proxiedFetch(url, { headers });
            const data = await res.json();

            // CNCVerse exposes available audio languages via post.php:
            // - d_lang: default language code (usually "eng")
            // - lang: array like [{ l: "Hindi", s: "hin" }, ...]
            // These are real options from the provider (not guessed, not derived from HLS manifests).
            const audioTracksFromPost = (() => {
                const tracks: Array<{ name: string; languageId: string; isDefault?: boolean }> = [];

                // Keep an explicit "Default" option that maps to empty audioParam (no language.php POST).
                tracks.push({ name: 'Default', languageId: '', isDefault: true });

                const langList: any[] = Array.isArray(data?.lang) ? data.lang : [];
                for (const entry of langList) {
                    const code = String(entry?.s ?? '').trim();
                    const label = String(entry?.l ?? '').trim();
                    if (!code) continue;
                    // "und" is shown as "Unknown" and isn't a meaningful selectable audio.
                    if (code.toLowerCase() === 'und') continue;

                    tracks.push({
                        name: label || code,
                        languageId: code,
                        isDefault: false,
                    });
                }

                // De-dupe by languageId while preserving order.
                const seen = new Set<string>();
                return tracks.filter(t => {
                    if (seen.has(t.languageId)) return false;
                    seen.add(t.languageId);
                    return true;
                });
            })();

            const episodes: Episode[] = [];

            if (includeEpisodes) {
                if (data.episodes && data.episodes[0]) {
                    // Fetch all pages for the current season shown in post.php
                    const baseUrl = `${STREAM_URL}/post.php?id=${id}&t=${time}`;
                    const paginatedEpisodes = await fetchAllPages(
                        baseUrl,
                        headers,
                        (ep: any) => ({
                            id: ep.id,
                            title: ep.t,
                            season: parseInt(ep.s?.replace('S', '') || '1'),
                            number: parseInt(ep.ep?.replace('E', '') || '1'),
                            coverImage: `https://imgcdn.kim/epimg/150/${ep.id}.jpg`,
                            sourceMovieId: id,
                            tracks: audioTracksFromPost as any
                        })
                    );
                    episodes.push(...paginatedEpisodes);

                    // Fetch additional seasons (skip last one as it's shown above)
                    if (data.season && data.season.length > 1) {
                        const additionalSeasons = data.season.slice(0, -1);

                        for (const season of additionalSeasons) {
                            try {
                                const baseUrl = `${STREAM_URL}/episodes.php?s=${season.id}&series=${id}&t=${time}`;
                                const seasonEpisodes = await fetchAllPages(
                                    baseUrl,
                                    headers,
                                    (ep: any) => ({
                                        id: ep.id,
                                        title: ep.t,
                                        season: parseInt(ep.s?.replace('S', '') || '1'),
                                        number: parseInt(ep.ep?.replace('E', '') || '1'),
                                        coverImage: `https://imgcdn.kim/epimg/150/${ep.id}.jpg`,
                                        sourceMovieId: id,
                                        tracks: audioTracksFromPost as any
                                    })
                                );
                                episodes.push(...seasonEpisodes);
                            } catch (err) {

                            }
                        }
                    }
                } else {
                    episodes.push({
                        id: id,
                        title: data.title,
                        number: 1,
                        season: 1,
                        sourceMovieId: id,
                        tracks: audioTracksFromPost as any
                    });
                }

                // Sort episodes
                episodes.sort((a, b) => (a.season - b.season) || (a.number - b.number));
            }


            return {
                id: id,
                title: data.title,
                description: data.desc,
                coverImage: `https://imgcdn.kim/poster/v/${id}.jpg`,
                backgroundImage: `https://imgcdn.kim/poster/h/${id}.jpg`,
                year: parseInt(data.year),
                score: parseFloat(data.match?.replace('IMDb ', '') || '0'),
                episodes,
                seasons: data.season?.map((s: any) => ({
                    id: s.id,
                    number: parseInt(s.id),
                    name: `Season ${s.id}`
                })),
                relatedContent: Array.isArray(data.suggest)
                    ? data.suggest.map((item: any) => ({
                        id: item.id,
                        title: item.t || item.title || '',
                        image: `https://imgcdn.kim/poster/v/${item.id}.jpg`,
                        type: 'show' as const,
                        year: item.year ? parseInt(String(item.year)) : undefined
                    }))
                    : undefined
            };

        } catch (e) {

            return null;
        }
    },

    async fetchStreamUrl(movieId: string, episodeId: string, audioLang?: string): Promise<VideoResponse | null> {

        try {
            const cookieValue = await bypass(STREAM_URL, true); // PROXIED
            const time = Math.floor(Date.now() / 1000);
            const audioParam = audioLang || '';

            // Cookies matching Kotlin CloudStream extension
            let streamCookies = `t_hash_t=${cookieValue}; ott=nf; hd=on; user_token=233123f803cf02184bf6c67e149cdd50`;
            const refererMain = `${STREAM_URL}/`;

            if (audioParam) {
                // POST to language.php to set audio language
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
                } catch (e) {

                }
            }

            // Fetch content title (needed for playlist endpoint t= param)
            let contentTitle = audioParam; // Use audio lang as fallback like the old code
            try {
                const postUrl = `${STREAM_URL}/post.php?id=${movieId}&t=${time}`;
                const postRes = await proxiedFetch(postUrl, {
                    headers: {
                        ...HEADERS,
                        'Cookie': streamCookies,
                        'Referer': refererMain
                    }
                });
                const postData = await postRes.json();
                contentTitle = postData.title || postData.t || contentTitle;
            } catch (e) {
                // Use audioParam as fallback
            }

            // Step 1: Get Token from play.php (matches Kotlin getVideoToken)
            let token = '';
            try {
                const playRes = await proxiedFetch(`${MAIN_URL}/play.php`, {
                    method: 'POST',
                    headers: {
                        ...HEADERS,
                        'Cookie': streamCookies,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Referer': `${STREAM_URL}/home`,
                        'Host': 'net22.cc'
                    },
                    body: `id=${episodeId}`
                });
                const playData = await playRes.json();
                if (playData && playData.h) {
                    const h = playData.h;
                    token = h.includes('in=') ? h.split('in=')[1] : h;
                }
            } catch (e) { /* ignore and try without token */ }

            // Use /playlist.php instead of /mobile/playlist.php — matches Kotlin
            const url = `${STREAM_URL}/playlist.php?id=${episodeId}&t=${encodeURIComponent(contentTitle)}&tm=${time}&h=${token}`;
            const playlistBaseUrl = STREAM_URL;
            const playlistReferer = `${STREAM_URL}/`;

            const headers = {
                ...HEADERS,
                'Cookie': streamCookies,
                'Referer': playlistReferer
            };

            let resText = '';
            try {
                const playlistRes = await proxiedFetch(url, { headers });
                resText = await playlistRes.text();
            } catch (e) {

                return null;
            }

            let playlist;

            try {
                playlist = JSON.parse(resText);
            } catch (e) {

                return null;
            }

            if (playlist && playlist.length > 0) {
                const item = playlist[0];
                const sources = item.sources || [];
                const tracks: any[] = Array.isArray(item.tracks) ? item.tracks : [];

                if (sources.length > 0) {
                    // Use first source as default (usually highest quality)
                    const defaultSource = sources[0];
                    const sourceFile = String(defaultSource.file ?? '');
                    // Kotlin prepends mainUrl to the file path: mainUrl + it.file
                    const m3u8Url = sourceFile.startsWith('http')
                        ? sourceFile
                        : `${playlistBaseUrl}${sourceFile}`;
                    const proxyUrl = getHlsProxyUrl(m3u8Url, {
                        referer: playlistReferer,
                        cookie: streamCookies,
                        ua: 'Mozilla/5.0 (Android) ExoPlayer' // Matches Kotlin extension stream UA
                    });

                    return {
                        videoUrl: proxyUrl,
                        subtitles: tracks
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
                                const rawFile = String(t?.file ?? '');
                                const rawLang = String(t?.srclang ?? t?.lang ?? t?.language ?? '').trim();
                                const label = String(t?.label ?? t?.name ?? rawLang ?? 'Subtitles');
                                const inferLang = (lbl: string) => {
                                    const s = lbl.toLowerCase();
                                    if (s.includes('english')) return 'en';
                                    if (s.includes('hindi')) return 'hi';
                                    if (s.includes('tamil')) return 'ta';
                                    if (s.includes('telugu')) return 'te';
                                    if (s.includes('malayalam')) return 'ml';
                                    if (s.includes('kannada')) return 'kn';
                                    if (s.includes('bengali')) return 'bn';
                                    return '';
                                };
                                const language = rawLang || inferLang(label) || 'en';
                                let subUrl = rawFile;
                                if (subUrl.startsWith('//')) {
                                    subUrl = `https:${subUrl}`;
                                } else if (subUrl && !subUrl.startsWith('http')) {
                                    subUrl = `${playlistBaseUrl}${subUrl.startsWith('/') ? subUrl : `/${subUrl}`}`;
                                }
                                return {
                                    language,
                                    label,
                                    url: getHlsProxyUrl(subUrl, {
                                        referer: playlistReferer,
                                        cookie: streamCookies,
                                        ua: HEADERS['User-Agent']
                                    })
                                };
                            })
                            .filter((s: any) => Boolean(s.url)),
                        qualities: sources.map((s: any) => {
                            const rawLabel = s.label || 'Auto';
                            const quality = rawLabel === 'Auto' ? 'Full HD' : rawLabel === 'Mid HD' ? '720p' : rawLabel;
                            return {
                                quality,
                                url: (() => {
                                    const file = String(s?.file ?? '');
                                    const abs = file.startsWith('http') ? file : `${playlistBaseUrl}${file}`;
                                    return getHlsProxyUrl(abs, {
                                        referer: playlistReferer,
                                        cookie: streamCookies,
                                        ua: HEADERS['User-Agent']
                                    });
                                })()
                            };
                        }),
                        headers: {}
                    };
                }
            }

            return null;
        } catch (e) {

            return null;
        }
    }
};
