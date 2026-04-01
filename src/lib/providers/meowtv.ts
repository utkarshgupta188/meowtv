import { Provider, HomePageRow, ContentItem, MovieDetails, Episode, VideoResponse, Track } from './types';
import { decryptData } from '../crypto';

const MAIN_URL = 'https://api.hlowb.com';

// Internal types for MeowTV (Castle) API responses
interface CastleApiResponse { code: number; msg: string; data: string | null; }
interface SecurityKeyResponse { code: number; msg: string; data: string; }
interface DecryptedResponse<T> { code: number; msg: string; data: T; }

function quoteLargeInts(text: string): string {
    // Wrap integers with 16+ digits in quotes to avoid JS precision loss before JSON.parse
    return text.replace(/(:\s*)(\d{16,})/g, '$1"$2"');
}

function parseJsonPreserveBigInt<T = any>(text: string): T {
    const safe = quoteLargeInts(text);
    return JSON.parse(safe);
}

async function getSecurityKey(retries: number = 3): Promise<{ key: string | null; cookie: string | null }> {
    const url = `${MAIN_URL}/v0.1/system/getSecurityKey/1?channel=IndiaA&clientType=1&lang=en-US`;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, { cache: 'no-store', headers: { 'User-Agent': 'okhttp/4.9.0' } });
            const cookie = res.headers.get('set-cookie');
            const text = await res.text();

            let json: SecurityKeyResponse | null = null;
            try {
                json = JSON.parse(text);
            } catch (parseErr) {
                console.warn('[MeowTV] getSecurityKey parse error', { attempt, text: text.slice(0, 200) });
            }

            if (json && json.code === 200 && json.data) {

                return { key: json.data, cookie };
            }

            console.warn('[MeowTV] getSecurityKey bad response', { attempt, json, text: text.slice(0, 200) });
        } catch (e) {
            console.warn('[MeowTV] getSecurityKey failed', { attempt, error: String(e) });
        }
    }
    return { key: null, cookie: null };
}

async function fetchDetailsWithKey(id: string, key: string): Promise<any | null> {
    const url = `${MAIN_URL}/film-api/v1.9.9/movie?channel=IndiaA&clientType=1&lang=en-US&movieId=${id}&packageName=com.external.castle`;
    try {
        const res = await fetch(url);
        const decryptedJson = decryptData(await res.text(), key);
        if (!decryptedJson) return null;
        return parseJsonPreserveBigInt(decryptedJson).data;
    } catch {
        return null;
    }
}

export const MeowTvProvider: Provider = {
    name: 'MeowTV',

    async fetchHome(page: number): Promise<Promise<HomePageRow[]>[]> {
        const fetchRows = async (): Promise<HomePageRow[]> => {
            const { key } = await getSecurityKey();
            if (!key) return [];
            const url = `${MAIN_URL}/film-api/v0.1/category/home?channel=IndiaA&clientType=1&lang=en-US&locationId=1001&mode=1&packageName=com.external.castle&page=${page}&size=17`;

            try {
                const res = await fetch(url, { cache: 'no-store' });
                const text = await res.text();
                let encryptedData = text;
                try { const json = JSON.parse(text); if (json.data) encryptedData = json.data; } catch { }

                const decryptedJson = decryptData(encryptedData, key);
                if (!decryptedJson) return [];
                const data = parseJsonPreserveBigInt(decryptedJson).data;
                if (!data.rows) return [];

                const rows = data.rows.map((row: any) => ({
                    name: row.name,
                    contents: row.contents?.map((c: any) => ({
                        title: c.title,
                        coverImage: c.coverImage,
                        id: c.redirectId?.toString(),
                        type: (c.movieType === 1 || c.movieType === 3 || c.movieType === 5) ? 'series' : 'movie'
                    })) || []
                })).filter((r: HomePageRow) => r.contents.length > 0);
                
                return rows;
            } catch (e) {
                console.error(e);
                return [];
            }
        };

        return [fetchRows()];
    },

    async search(query: string): Promise<ContentItem[]> {
        const { key } = await getSecurityKey();
        if (!key) return [];
        const url = `${MAIN_URL}/film-api/v1.1.0/movie/searchByKeyword?channel=IndiaA&clientType=1&keyword=${encodeURIComponent(query)}&lang=en-US&mode=1&packageName=com.external.castle&page=1&size=30`;

        try {
            const res = await fetch(url);
            const payload = await res.text();
            const decryptedJson = decryptData(payload, key);
            if (!decryptedJson) {
                console.warn('[MeowTV] search decrypt failed', {
                    query,
                    status: res.status,
                    sample: payload.slice(0, 200)
                });
                return [];
            }

            const rows = parseJsonPreserveBigInt(decryptedJson).data.rows || [];
            return rows.map((row: any) => ({
                title: row.title,
                coverImage: row.coverVerticalImage || row.coverHorizontalImage,
                id: row.id?.toString(),
                type: (row.movieType === 1 || row.movieType === 3 || row.movieType === 5) ? 'series' : 'movie'
            }));
        } catch { return []; }
    },

    async fetchDetails(id: string, includeEpisodes?: boolean): Promise<MovieDetails | null> {
        const { key } = await getSecurityKey();
        if (!key) return null;
        const url = `${MAIN_URL}/film-api/v1.9.9/movie?channel=IndiaA&clientType=1&lang=en-US&movieId=${id}&packageName=com.external.castle`;

        try {
            const res = await fetch(url);
            const decryptedJson = decryptData(await res.text(), key);
            if (!decryptedJson) return null;

            const d = parseJsonPreserveBigInt(decryptedJson).data;

            const episodes: Episode[] = [];
            // Recursive Season Fetching (kept from original logic)
            if (d.seasons && d.seasons.length > 1) {
                const seasonPromises = d.seasons.map(async (season: any) => {
                    if (!season.movieId) return [];
                    try {
                        const sUrl = `${MAIN_URL}/film-api/v1.9.9/movie?channel=IndiaA&clientType=1&lang=en-US&movieId=${season.movieId}&packageName=com.external.castle`;
                        const sRes = await fetch(sUrl);
                        const sDec = decryptData(await sRes.text(), key);
                        if (!sDec) return [];
                        const sData = JSON.parse(sDec).data;
                        return sData.episodes?.map((ep: any) => ({
                            id: ep.id.toString(),
                            title: ep.title,
                            number: ep.number,
                            season: season.number,
                            coverImage: ep.coverImage,
                            sourceMovieId: season.movieId.toString(), // Important for CastleTV
                            tracks: ep.tracks?.map((t: any) => ({
                                languageId: t.languageId,
                                name: t.languageName || t.abbreviate,
                                isDefault: t.isDefault,
                                existIndividualVideo: t.existIndividualVideo // kept for internal logic
                            }))
                        })) || [];
                    } catch { return []; }
                });
                (await Promise.all(seasonPromises)).forEach(eps => episodes.push(...eps));
            } else if (d.episodes) {
                episodes.push(...d.episodes.map((ep: any) => ({
                    id: ep.id.toString(),
                    title: ep.title,
                    number: ep.number,
                    season: d.seasonNumber || 1,
                    coverImage: ep.coverImage,
                    sourceMovieId: d.id.toString(),
                    tracks: ep.tracks?.map((t: any) => ({
                        languageId: t.languageId,
                        name: t.languageName || t.abbreviate,
                        isDefault: t.isDefault,
                        existIndividualVideo: t.existIndividualVideo
                    }))
                })));
            }

            // Sort
            episodes.sort((a, b) => (a.season - b.season) || (a.number - b.number));

            return {
                id: d.id.toString(),
                title: d.title,
                description: d.briefIntroduction,
                coverImage: d.coverVerticalImage || d.coverHorizontalImage,
                backgroundImage: d.coverHorizontalImage,
                year: d.publishTime ? new Date(d.publishTime).getFullYear() : undefined,
                score: d.score,
                episodes,
                seasons: d.seasons?.map((s: any) => ({ id: s.movieId.toString(), number: s.number, name: `Season ${s.number}` })),
                tags: d.tags,
                actors: d.actors?.map((a: any) => ({ name: a.name, image: a.avatar }))
            };
        } catch { return null; }
    },

    async fetchStreamUrl(movieId: string, episodeId: string, languageId?: number): Promise<VideoResponse | null> {
        const { key, cookie } = await getSecurityKey();
        if (!key) return null;

        // Fetch details to get correct episode/tracks like Kotlin flow
        const details = await fetchDetailsWithKey(movieId, key);
        if (!details) {
            console.warn('[MeowTV] fetchStreamUrl details missing');
        }
        const episodes = details?.episodes || [];

        let targetEpisode = episodes.find((ep: any) => ep.id?.toString() === episodeId);
        if (!targetEpisode && episodes.length) {
            targetEpisode = episodes[0];
            episodeId = targetEpisode.id?.toString() || episodeId;
            console.warn('[MeowTV] episodeId not found; using first episode', { episodeId });
        }
        if (!targetEpisode) {
            console.warn('[MeowTV] no target episode resolved; proceeding with provided episodeId');
        }

        const tracks: any[] = targetEpisode?.tracks || [];
        const hasIndividual = tracks.some((t: any) => t.existIndividualVideo);

        const trackPlan: { languageId?: number | string; name?: string }[] = [];
        if (languageId) {
            trackPlan.push({ languageId, name: 'provided' });
        } else if (!hasIndividual && tracks.length) {
            const t = tracks[0];
            trackPlan.push({ languageId: t.languageId, name: t.languageName || t.abbreviate });
        } else if (tracks.length) {
            tracks.forEach((t: any) => trackPlan.push({ languageId: t.languageId, name: t.languageName || t.abbreviate }));
        } else {
            trackPlan.push({ languageId: undefined, name: 'no-track' });
        }

        const resolutions = [3, 2, 1];
        const collectedQualities: { quality: string; url: string }[] = [];
        let bestVideoUrl: string | null = null;
        let bestSubtitles: { language: string; url: string; label: string }[] = [];
        const cookieHeader = cookie || process.env.MEOW_COOKIE || 'hd=on';

        for (const track of trackPlan) {
            for (const resolution of resolutions) {
                const url = `${MAIN_URL}/film-api/v2.0.1/movie/getVideo2?clientType=1&packageName=com.external.castle&channel=IndiaA&lang=en-US`;
                const body: Record<string, string> = {
                    mode: '1', appMarket: 'GuanWang', clientType: '1', woolUser: 'false',
                    apkSignKey: 'ED0955EB04E67A1D9F3305B95454FED485261475', androidVersion: '13',
                    movieId, episodeId, isNewUser: 'true', resolution: resolution.toString(),
                    packageName: 'com.external.castle'
                };
                if (track.languageId) body.languageId = String(track.languageId);

                try {
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json; charset=utf-8',
                            'User-Agent': 'okhttp/4.9.0',
                            'Cookie': cookieHeader
                        },
                        body: JSON.stringify(body)
                    });

                    const payload = await res.text();
                    const decryptedJson = decryptData(payload, key);
                    if (!decryptedJson) {
                        console.warn('[MeowTV] fetchStreamUrl decrypt failed', {
                            movieId,
                            episodeId,
                            resolution,
                            status: res.status,
                            sample: payload.slice(0, 200),
                            lang: track.languageId
                        });
                        continue;
                    }

                    const data = parseJsonPreserveBigInt(decryptedJson).data;
                    if (data && data.videoUrl) {
                        const qualityLabel =
                            resolution === 3 ? '1080p' :
                                resolution === 2 ? '720p' :
                                    resolution === 1 ? '480p' :
                                        `${resolution}p`;

                        // Try direct URL first - MeowTV streams likely don't require auth
                        collectedQualities.push({ quality: qualityLabel, url: data.videoUrl });

                        if (!bestVideoUrl) {
                            bestVideoUrl = data.videoUrl;
                            bestSubtitles = (data.subtitles || []).map((s: any) => {
                                const lang = s.abbreviate || s.title || 'Unknown';
                                const rawUrl = s.url || '';
                                const label = s.title || lang || 'Subtitles';
                                // Direct subtitle URLs
                                return { language: lang, label, url: rawUrl };
                            }).filter((s: any) => Boolean(s.url));
                        }
                    } else {
                        console.warn('[MeowTV] fetchStreamUrl no videoUrl', {
                            movieId,
                            episodeId,
                            resolution,
                            status: res.status,
                            lang: track.languageId,
                            decryptedSample: decryptedJson.slice(0, 500)
                        });
                    }
                } catch { }
            }
        }

        if (!bestVideoUrl) return null;

        return {
            videoUrl: bestVideoUrl,
            subtitles: bestSubtitles,
            qualities: collectedQualities,
            headers: { 'Referer': MAIN_URL }
        };
    }
};
