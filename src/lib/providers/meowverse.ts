import { Provider, HomePageRow, ContentItem, MovieDetails, Episode, VideoResponse } from './types';
import * as cheerio from 'cheerio';
import { getHlsProxyUrl, getSimpleProxyUrl } from '../proxy-config';

const MAIN_URL = 'https://net22.cc';
const NEW_URL = 'https://net51.cc';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
        // console.log(`[CNC Verse] Using cached ${useProxy ? 'proxy' : 'direct'} cookie`);
        return cachedCookie;
    }

    try {
        let verifyCheck: string;
        let retries = 0;
        const maxRetries = 10;

        console.log(`[CNC Verse] Starting bypass (${useProxy ? 'Proxy' : 'Direct'})...`);
        // Keep POSTing until we get success response
        while (retries < maxRetries) {
            const fetchFn = useProxy ? proxiedFetch : fetch;

            const res = await fetchFn(`${mainUrl}/tv/p.php`, {
                method: 'POST',
                headers: HEADERS
            });

            verifyCheck = await res.text();

            // Check if Cloudflare challenge passed
            if (verifyCheck.includes('"r":"n"')) {
                // Extract t_hash_t cookie from response headers
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
                        console.log(`[CNC Verse] Bypass successful! (${useProxy ? 'Proxy' : 'Direct'})`);
                        return cookieVal;
                    }
                }
            }

            retries++;
            // console.log(`[CNC Verse] Bypass attempt ${retries}/${maxRetries}...`);
            await new Promise(resolve => setTimeout(resolve, 500));
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
            console.log(`[CNC Verse] Fetching page ${currentPage}: ${url}`);

            const res = await fetch(url, { headers });
            const data = await res.json();

            if (data.episodes && data.episodes.length > 0) {
                data.episodes.forEach((ep: any) => {
                    if (ep) allEpisodes.push(episodeProcessor(ep));
                });
                console.log(`[CNC Verse] Page ${currentPage}: Found ${data.episodes.length} episodes`);
                console.log(`[CNC Verse] Pagination fields:`, {
                    nextPageShow: data.nextPageShow,
                    nextPage: data.nextPage,
                    nextPageSeason: data.nextPageSeason,
                    currentPage: currentPage
                });

                // Check nextPageShow field first - if it's 0, there are no more pages
                if (data.nextPageShow === 0 || data.nextPageShow === '0') {
                    console.log(`[CNC Verse] nextPageShow is 0, no more pages available`);
                    hasMorePages = false;
                } else if (data.nextPage && currentPage >= data.nextPage) {
                    // If current page matches or exceeds nextPage, we're on the last page
                    console.log(`[CNC Verse] currentPage (${currentPage}) >= nextPage (${data.nextPage}), stopping`);
                    hasMorePages = false;
                } else if (data.episodes.length < 10) {
                    // If we got fewer than 10 episodes, this is the last page
                    console.log(`[CNC Verse] Got ${data.episodes.length} episodes (less than 10), stopping pagination`);
                    hasMorePages = false;
                } else if (data.nextPageShow === 1 || data.nextPageShow === '1') {
                    // Explicit indicator that there's a next page
                    console.log(`[CNC Verse] nextPageShow is 1, fetching next page`);
                    hasMorePages = true;
                } else if (data.nextPage && currentPage < data.nextPage) {
                    // If nextPage is greater than current page, continue
                    console.log(`[CNC Verse] currentPage (${currentPage}) < nextPage (${data.nextPage}), continuing`);
                    hasMorePages = true;
                } else if (currentPage === 1 && data.episodes.length === 10) {
                    // On first page with 10 episodes, try page 2
                    console.log(`[CNC Verse] First page with 10 episodes, trying page 2`);
                    hasMorePages = true;
                } else {
                    // Default: stop
                    console.log(`[CNC Verse] No clear pagination indicator, stopping`);
                    hasMorePages = false;
                }
            } else {
                console.log(`[CNC Verse] Page ${currentPage}: No episodes found, stopping pagination`);
                hasMorePages = false;
                break;
            }

            currentPage++;

            // Safety limit to prevent infinite loops
            if (currentPage > 100) {
                console.warn('[CNC Verse] Reached page limit of 100, stopping pagination');
                break;
            }
        } catch (err) {
            console.error(`[CNC Verse] Error fetching page ${currentPage}:`, err);
            hasMorePages = false;
        }
    }

    console.log(`[CNC Verse] Total episodes fetched: ${allEpisodes.length} across ${currentPage - 1} pages`);
    return allEpisodes;
}

export const MeowVerseProvider: Provider = {
    name: 'MeowVerse',

    async fetchHome(page: number): Promise<HomePageRow[]> {
        if (page > 1) return [];

        try {
            const cookieValue = await bypass(MAIN_URL, false); // Direct
            const headers = {
                ...HEADERS,
                'Cookie': `t_hash_t=${cookieValue}; ott=nf; hd=on; user_token=233123f803cf02184bf6c67e149cdd50`
            };

            const res = await fetch(`${MAIN_URL}/home`, { headers });
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
            console.error('CNC Home Error:', e);
            return [];
        }
    },

    async search(query: string): Promise<ContentItem[]> {
        try {
            const cookieValue = await bypass(MAIN_URL, false); // Direct
            const time = Math.floor(Date.now() / 1000);
            const url = `${MAIN_URL}/search.php?s=${encodeURIComponent(query)}&t=${time}`;

            const headers = {
                ...HEADERS,
                'Cookie': `t_hash_t=${cookieValue}; ott=nf; hd=on`,
                'Referer': `${MAIN_URL}/tv/home`
            };

            const res = await fetch(url, { headers });
            const data = await res.json();

            return (data.searchResult || []).map((item: any) => ({
                title: item.t,
                coverImage: `https://imgcdn.kim/poster/v/${item.id}.jpg`,
                id: item.id,
                type: 'movie'
            }));
        } catch (e) {
            console.error('CNC Search Error:', e);
            return [];
        }
    },

    async fetchDetails(id: string, includeEpisodes: boolean = true): Promise<MovieDetails | null> {
        try {
            const cookieValue = await bypass(MAIN_URL, false); // Direct
            const time = Math.floor(Date.now() / 1000);
            const url = `${MAIN_URL}/post.php?id=${id}&t=${time}`;

            const headers = {
                ...HEADERS,
                'Cookie': `t_hash_t=${cookieValue}; ott=nf; hd=on`,
                'Referer': `${MAIN_URL}/tv/home`
            };

            const res = await fetch(url, { headers });
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
                    const baseUrl = `${MAIN_URL}/post.php?id=${id}&t=${time}`;
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
                                const baseUrl = `${MAIN_URL}/episodes.php?s=${season.id}&series=${id}&t=${time}`;
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
                                console.error(`Failed to fetch season ${season.id}:`, err);
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
            console.error('CNC Details Error:', e);
            return null;
        }
    },

    async fetchStreamUrl(movieId: string, episodeId: string, audioLang?: string): Promise<VideoResponse | null> {
        console.log('[CNC Verse] fetchStreamUrl (VERSION: UA_FIX_APPLIED)');
        try {
            const cookieValue = await bypass(MAIN_URL, true); // PROXIED
            const time = Math.floor(Date.now() / 1000);
            const audioParam = audioLang || '';
            console.log('[CNC Verse] Setting audio language:', audioParam || 'eng (default)');

            // Helper to merge cookies robustly
            const mergeCookies = (oldCookies: string, newSetCookieHeader: string | null) => {
                if (!newSetCookieHeader) return oldCookies;

                const cookieMap = new Map<string, string>();

                // Parse old cookies
                oldCookies.split(';').forEach(c => {
                    const [key, val] = c.trim().split('=');
                    if (key) cookieMap.set(key, val || '');
                });

                // Naive Set-Cookie parsing (handles simple cases)
                const parts = newSetCookieHeader.split(/,(?=\s*[a-zA-Z0-9_-]+=)/);
                parts.forEach((part) => {
                    const mainPart = part.split(';')[0].trim();
                    const [key, val] = mainPart.split('=');
                    if (key) {
                        cookieMap.set(key, val || '');
                        console.log(`[CNC Verse] Cookie update: ${key}=${val}`);
                    }
                });

                return Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
            };

            // Initial cookies
            // user_token is required for some endpoints to behave like the logged-in web app.
            let streamCookies = `t_hash_t=${cookieValue}; ott=nf; hd=on; user_token=233123f803cf02184bf6c67e149cdd50`;
            const refererNet20 = `${MAIN_URL}/home`;

            if (audioParam) {
                // Step 1: POST to language.php (Net20)
                try {
                    const langRes = await proxiedFetch(`${MAIN_URL}/language.php`, {
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
                } catch (e) {
                    console.error('[CNC Verse] Language POST failed:', e);
                }
            }

            // Step 2: POST to play.php (Net20) to get transfer hash
            // Important: this appears to be required even for default audio (otherwise net51 playlist may reply "Video ID not found!").
            let hashParams = '';
            try {
                console.log('[CNC Verse] Step 2: Getting transfer hash from play.php');
                const playUrl = `${MAIN_URL}/play.php`;
                const playPostRes = await proxiedFetch(playUrl, {
                    method: 'POST',
                    headers: {
                        ...HEADERS,
                        'Cookie': streamCookies,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Referer': refererNet20,
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    body: `id=${episodeId}`
                });

                streamCookies = mergeCookies(streamCookies, playPostRes.headers.get('x-proxied-set-cookie') || playPostRes.headers.get('set-cookie'));

                const playText = await playPostRes.text();
                try {
                    const playData = JSON.parse(playText);
                    console.log('[CNC Verse] Play response:', playData);
                    if (playData && playData.h) {
                        hashParams = `&${playData.h}`;
                    }
                } catch (e) {
                    console.warn('[CNC Verse] Play response was not JSON');
                }
            } catch (e) {
                console.error('[CNC Verse] Play POST failed:', e);
            }

            // Step 3: GET play.php (Net51) with hash to set session
            if (hashParams) {
                try {
                    console.log('[CNC Verse] Step 3: Transferring session to net51.cc');
                    const playGetUrl = `${NEW_URL}/play.php?id=${episodeId}${hashParams}`;

                    const playGetRes = await proxiedFetch(playGetUrl, {
                        headers: {
                            ...HEADERS,
                            'Cookie': streamCookies,
                            'Referer': refererNet20
                        },
                        redirect: 'manual'
                    });

                    console.log('[CNC Verse] Step 3 status:', playGetRes.status);
                    streamCookies = mergeCookies(streamCookies, playGetRes.headers.get('x-proxied-set-cookie') || playGetRes.headers.get('set-cookie'));

                } catch (e) {
                    console.error('[CNC Verse] Session transfer failed:', e);
                }
            } else {
                console.warn('[CNC Verse] No transfer hash; continuing anyway');
            }

            // Step 4: Fetch playlist from net51.cc
            const url = `${NEW_URL}/tv/playlist.php?id=${episodeId}&t=${audioParam}&tm=${time}`;
            console.log('[CNC Verse] Step 4: Fetching playlist:', url);
            console.log('[CNC Verse] With Cookies:', streamCookies);

            const headers = {
                ...HEADERS,
                'Cookie': streamCookies,
                'Referer': `${NEW_URL}/home`
            };

            let resText = '';
            try {
                const playlistRes = await proxiedFetch(url, { headers });
                resText = await playlistRes.text();
                streamCookies = mergeCookies(streamCookies, playlistRes.headers.get('x-proxied-set-cookie') || playlistRes.headers.get('set-cookie'));
            } catch (e) {
                console.error('[CNC Verse] Playlist fetch error:', e);
            }

            let playlistBaseUrl = NEW_URL;
            let playlistReferer = `${NEW_URL}/`;

            // Fallback: sometimes net51 returns plain text like "Video ID not found!".
            // Try net20 playlist endpoint as a backup.
            if (!resText || /Video ID not found!/i.test(resText)) {
                console.warn('[CNC Verse] net51 playlist says Video ID not found; trying net20 fallback');
                const url2 = `${MAIN_URL}/tv/playlist.php?id=${episodeId}&t=${audioParam}&tm=${time}`;
                try {
                    const fallbackRes = await proxiedFetch(url2, {
                        headers: {
                            ...HEADERS,
                            'Cookie': streamCookies,
                            'Referer': refererNet20
                        }
                    });
                    resText = await fallbackRes.text();
                    streamCookies = mergeCookies(streamCookies, fallbackRes.headers.get('x-proxied-set-cookie') || fallbackRes.headers.get('set-cookie'));
                    playlistBaseUrl = MAIN_URL;
                    playlistReferer = `${MAIN_URL}/`;
                } catch (e) {
                    console.error('[CNC Verse] Fallback playlist fetch error:', e);
                }
            }

            let playlist;

            try {
                playlist = JSON.parse(resText);
            } catch (e) {
                console.error('[CNC Verse] Failed to parse playlist JSON. Response start:', resText.substring(0, 500));
                return null;
            }

            if (playlist && playlist.length > 0) {
                const item = playlist[0];
                const sources = item.sources || [];

                const tracks: any[] = Array.isArray(item.tracks) ? item.tracks : [];

                // Debug: Log all tracks
                console.log('[CNC Verse] All tracks:', tracks);

                // Audio languages should come from the stream itself (HLS #EXT-X-MEDIA TYPE=AUDIO).
                // We deliberately do NOT return a premade list here.


                if (sources.length > 0) {
                    // Important: many streams/variants/tracks require the same session cookies used for playlist.php.
                    // We pass them via the /api/hls proxy since browsers can't set arbitrary Cookie headers.
                    const cookieParam = encodeURIComponent(streamCookies);

                    // Use first source as default (usually highest quality)
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
                        subtitles: tracks
                            .filter((t: any) => {
                                const kind = String(t?.kind ?? '').toLowerCase();
                                const file = String(t?.file ?? '').toLowerCase();
                                // CNCVerse often includes "thumbnails" VTT which are NOT captions.
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
                                // Fix protocol-relative / relative URLs
                                let subUrl = rawFile;
                                if (subUrl.startsWith('//')) subUrl = `https:${subUrl}`;
                                if (subUrl && !subUrl.startsWith('http')) subUrl = `${playlistBaseUrl}${subUrl}`;
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
                        qualities: sources.map((s: any) => ({
                            quality: s.label || 'Auto',
                            url: (() => {
                                const file = String(s?.file ?? '');
                                const abs = file.startsWith('http') ? file : `${playlistBaseUrl}${file.replace('/tv/', '/')}`;
                                return getHlsProxyUrl(abs, {
                                    referer: playlistReferer,
                                    cookie: streamCookies,
                                    ua: HEADERS['User-Agent']
                                });
                            })()
                        })),
                        headers: {}
                    };
                }
            }

            return null;
        } catch (e) {
            console.error('CNC Stream Error DETAILS:', e);
            return null;
        }
    }
};
