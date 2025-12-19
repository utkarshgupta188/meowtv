import { Provider, HomePageRow, ContentItem, MovieDetails, Episode, VideoResponse } from './types';
import * as cheerio from 'cheerio';

const MAIN_URL = 'https://net20.cc';
const NEW_URL = 'https://net51.cc';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'X-Requested-With': 'XMLHttpRequest',
};

// Cached cookie (valid for ~15 hours)
let cachedCookie: string | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 54_000_000; // 15 hours in milliseconds

async function bypass(mainUrl: string): Promise<string> {
    // Return cached cookie if valid
    if (cachedCookie && Date.now() - cacheTimestamp < CACHE_DURATION) {
        console.log('[CNC Verse] Using cached cookie');
        return cachedCookie;
    }

    try {
        let verifyCheck: string;
        let retries = 0;
        const maxRetries = 10;

        console.log('[CNC Verse] Starting bypass...');
        // Keep POSTing until we get success response
        while (retries < maxRetries) {
            const res = await fetch(`${mainUrl}/tv/p.php`, {
                method: 'POST',
                headers: HEADERS
            });

            verifyCheck = await res.text();

            // Check if Cloudflare challenge passed
            if (verifyCheck.includes('"r":"n"')) {
                // Extract t_hash_t cookie from response headers
                const setCookie = res.headers.get('set-cookie');
                if (setCookie) {
                    const match = setCookie.match(/t_hash_t=([^;]+)/);
                    if (match) {
                        cachedCookie = match[1];
                        cacheTimestamp = Date.now();
                        console.log('[CNC Verse] Bypass successful! Cookie cached for 15 hours');
                        return cachedCookie;
                    }
                }
            }

            retries++;
            console.log(`[CNC Verse] Bypass attempt ${retries}/${maxRetries}...`);
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        throw new Error('Bypass failed after max retries');
    } catch (e) {
        console.error('[CNC Verse] Bypass error:', e);
        cachedCookie = null;
        throw e;
    }
}

export const CncVerseProvider: Provider = {
    name: 'MeowVerse',

    async fetchHome(page: number): Promise<HomePageRow[]> {
        if (page > 1) return [];

        try {
            const cookieValue = await bypass(MAIN_URL);
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
            const cookieValue = await bypass(MAIN_URL);
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

    async fetchDetails(id: string): Promise<MovieDetails | null> {
        try {
            const cookieValue = await bypass(MAIN_URL);
            const time = Math.floor(Date.now() / 1000);
            const url = `${MAIN_URL}/post.php?id=${id}&t=${time}`;

            const headers = {
                ...HEADERS,
                'Cookie': `t_hash_t=${cookieValue}; ott=nf; hd=on`,
                'Referer': `${MAIN_URL}/tv/home`
            };

            const res = await fetch(url, { headers });
            const data = await res.json();

            const episodes: Episode[] = [];

            if (data.episodes && data.episodes[0]) {
                data.episodes.forEach((ep: any) => {
                    if (!ep) return;
                    episodes.push({
                        id: ep.id,
                        title: ep.t,
                        season: parseInt(ep.s?.replace('S', '') || '1'),
                        number: parseInt(ep.ep?.replace('E', '') || '1'),
                        coverImage: `https://imgcdn.kim/epimg/150/${ep.id}.jpg`,
                        sourceMovieId: id,
                        tracks: [{ name: 'Default', url: '', isDefault: true }]
                    });
                });

                // Fetch additional seasons (skip last one as it's shown above)
                if (data.season && data.season.length > 1) {
                    const additionalSeasons = data.season.slice(0, -1);

                    for (const season of additionalSeasons) {
                        try {
                            const seasonUrl = `${MAIN_URL}/episodes.php?s=${season.id}&series=${id}&t=${time}&page=1`;
                            const seasonRes = await fetch(seasonUrl, { headers });
                            const seasonData = await seasonRes.json();

                            if (seasonData.episodes) {
                                seasonData.episodes.forEach((ep: any) => {
                                    if (!ep) return;
                                    episodes.push({
                                        id: ep.id,
                                        title: ep.t,
                                        season: parseInt(ep.s?.replace('S', '') || '1'),
                                        number: parseInt(ep.ep?.replace('E', '') || '1'),
                                        coverImage: `https://imgcdn.kim/epimg/150/${ep.id}.jpg`,
                                        sourceMovieId: id,
                                        tracks: [{ name: 'Default', url: '', isDefault: true }]
                                    });
                                });
                            }
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
                    tracks: [{ name: 'Default', url: '', isDefault: true }]
                });
            }

            // Sort episodes
            episodes.sort((a, b) => (a.season - b.season) || (a.number - b.number));

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
                }))
            };

        } catch (e) {
            console.error('CNC Details Error:', e);
            return null;
        }
    },

    async fetchStreamUrl(movieId: string, episodeId: string, audioLang?: string): Promise<VideoResponse | null> {
        try {
            const cookieValue = await bypass(MAIN_URL);
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
            let streamCookies = `t_hash_t=${cookieValue}; ott=nf; hd=on`;
            const referer = `${MAIN_URL}/home`;

            if (audioParam) {
                // Step 1: POST to language.php (Net20)
                try {
                    const langRes = await fetch(`${MAIN_URL}/language.php`, {
                        method: 'POST',
                        headers: {
                            ...HEADERS,
                            'Cookie': streamCookies,
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Referer': referer
                        },
                        body: `lang=${audioParam}`
                    });

                    streamCookies = mergeCookies(streamCookies, langRes.headers.get('set-cookie'));
                } catch (e) {
                    console.error('[CNC Verse] Language POST failed:', e);
                }

                // Step 2: POST to play.php (Net20) to get transfer hash
                let hashParams = '';
                try {
                    console.log('[CNC Verse] Step 2: Getting transfer hash from play.php');
                    const playUrl = `${MAIN_URL}/play.php`;
                    const playPostRes = await fetch(playUrl, {
                        method: 'POST',
                        headers: {
                            ...HEADERS,
                            'Cookie': streamCookies,
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Referer': referer,
                            'X-Requested-With': 'XMLHttpRequest'
                        },
                        body: `id=${episodeId}`
                    });

                    streamCookies = mergeCookies(streamCookies, playPostRes.headers.get('set-cookie'));

                    const playText = await playPostRes.text();
                    try {
                        const playData = JSON.parse(playText);
                        console.log('[CNC Verse] Play response:', playData);
                        if (playData && playData.h) {
                            hashParams = `&${playData.h}`;
                        }
                    } catch (e) { }
                } catch (e) {
                    console.error('[CNC Verse] Play POST failed:', e);
                }

                // Step 3: GET play.php (Net51) with hash to set session
                if (hashParams) {
                    try {
                        console.log('[CNC Verse] Step 3: Transferring session to net51.cc');
                        const playGetUrl = `${NEW_URL}/play.php?id=${episodeId}${hashParams}`;

                        const playGetRes = await fetch(playGetUrl, {
                            headers: {
                                ...HEADERS,
                                'Cookie': streamCookies,
                                'Referer': referer
                            },
                            redirect: 'manual'
                        });

                        console.log('[CNC Verse] Step 3 status:', playGetRes.status);
                        streamCookies = mergeCookies(streamCookies, playGetRes.headers.get('set-cookie'));

                    } catch (e) {
                        console.error('[CNC Verse] Session transfer failed:', e);
                    }
                }
            }

            // Step 4: Fetch playlist from net51.cc
            const url = `${NEW_URL}/tv/playlist.php?id=${episodeId}&t=${audioParam}&tm=${time}`;
            console.log('[CNC Verse] Step 4: Fetching playlist:', url);
            console.log('[CNC Verse] With Cookies:', streamCookies);

            const headers = {
                ...HEADERS,
                'Cookie': streamCookies,
                'Referer': `${MAIN_URL}/home`
            };

            const res = await fetch(url, { headers });
            const resText = await res.text();
            let playlist;

            try {
                playlist = JSON.parse(resText);
            } catch (e) {
                console.error('[CNC Verse] Failed to parse playlist JSON. Response start:', resText.substring(0, 500));
                return null;
            }

            try {
                playlist = JSON.parse(resText);
            } catch (e) {
                console.error('[CNC Verse] Failed to parse playlist JSON. Response start:', resText.substring(0, 500));
                return null;
            }

            if (playlist && playlist.length > 0) {
                const item = playlist[0];
                const sources = item.sources || [];

                // Debug: Log all tracks
                console.log('[CNC Verse] All tracks:', item.tracks);

                // TESTING: Hardcode audio languages to test which params work
                const audioTracks: any[] = [
                    { languageId: '', name: 'English (Default)' },
                    { languageId: 'hin', name: 'Hindi' },
                    { languageId: 'tam', name: 'Tamil' },
                    { languageId: 'tel', name: 'Telugu' }
                ];
                console.log('[CNC Verse] Hardcoded audio tracks for testing:', audioTracks);


                if (sources.length > 0) {
                    // Use first source as default (usually highest quality)
                    const defaultSource = sources[0];
                    const m3u8Url = `${NEW_URL}${defaultSource.file.replace('/tv/', '/')}`;
                    const proxyUrl = `/api/hls?url=${encodeURIComponent(m3u8Url)}&referer=${encodeURIComponent(NEW_URL + '/')}&cookie=hd=on`;

                    return {
                        videoUrl: proxyUrl,
                        subtitles: item.tracks?.filter((t: any) => t.kind === 'captions').map((t: any) => {
                            // Fix protocol-relative URLs
                            const subUrl = t.file.startsWith('//') ? `https:${t.file}` : t.file;
                            return {
                                language: t.label,
                                label: t.label,
                                url: `/api/hls?url=${encodeURIComponent(subUrl)}`
                            };
                        }),
                        qualities: sources.map((s: any) => ({
                            quality: s.label || 'Auto',
                            url: `/api/hls?url=${encodeURIComponent(NEW_URL + s.file.replace('/tv/', '/'))}&referer=${encodeURIComponent(NEW_URL + '/')}&cookie=hd=on`
                        })),
                        audioTracks: audioTracks,
                        headers: {}
                    };
                }
            }

            return null;
        } catch (e) {
            console.error('CNC Stream Error:', e);
            return null;
        }
    }
};
