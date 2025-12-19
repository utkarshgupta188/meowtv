import { Provider, HomePageRow, ContentItem, MovieDetails, Episode, VideoResponse, Track } from './types';
import { decryptData } from '../crypto';

const MAIN_URL = 'https://api.hlowb.com';

// Internal types for CastleTV API responses
interface CastleApiResponse { code: number; msg: string; data: string | null; }
interface SecurityKeyResponse { code: number; msg: string; data: string; }
interface DecryptedResponse<T> { code: number; msg: string; data: T; }

async function getSecurityKey(): Promise<{ key: string | null; cookie: string | null }> {
    try {
        const url = `${MAIN_URL}/v0.1/system/getSecurityKey/1?channel=IndiaA&clientType=1&lang=en-US`;
        const res = await fetch(url, { cache: 'no-store' });
        const cookie = res.headers.get('set-cookie');
        const json: SecurityKeyResponse = await res.json();
        return json.code === 200 ? { key: json.data, cookie } : { key: null, cookie: null };
    } catch (e) {
        return { key: null, cookie: null };
    }
}

export const CastleTvProvider: Provider = {
    name: 'MeowMov',

    async fetchHome(page: number): Promise<HomePageRow[]> {
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

            const data = JSON.parse(decryptedJson).data;
            if (!data.rows) return [];

            return data.rows.map((row: any) => ({
                name: row.name,
                contents: row.contents?.map((c: any) => ({
                    title: c.title,
                    coverImage: c.coverImage,
                    id: c.redirectId?.toString(),
                    type: (c.movieType === 1 || c.movieType === 3 || c.movieType === 5) ? 'series' : 'movie'
                })) || []
            })).filter((r: HomePageRow) => r.contents.length > 0);
        } catch (e) {
            console.error(e);
            return [];
        }
    },

    async search(query: string): Promise<ContentItem[]> {
        const { key } = await getSecurityKey();
        if (!key) return [];
        const url = `${MAIN_URL}/film-api/v1.1.0/movie/searchByKeyword?channel=IndiaA&clientType=1&keyword=${encodeURIComponent(query)}&lang=en-US&mode=1&packageName=com.external.castle&page=1&size=30`;

        try {
            const res = await fetch(url);
            const decryptedJson = decryptData(await res.text(), key);
            if (!decryptedJson) return [];

            const rows = JSON.parse(decryptedJson).data.rows || [];
            return rows.map((row: any) => ({
                title: row.title,
                coverImage: row.coverVerticalImage || row.coverHorizontalImage,
                id: row.id?.toString(),
                type: (row.movieType === 1 || row.movieType === 3 || row.movieType === 5) ? 'series' : 'movie'
            }));
        } catch { return []; }
    },

    async fetchDetails(id: string): Promise<MovieDetails | null> {
        const { key } = await getSecurityKey();
        if (!key) return null;
        const url = `${MAIN_URL}/film-api/v1.9.9/movie?channel=IndiaA&clientType=1&lang=en-US&movieId=${id}&packageName=com.external.castle`;

        try {
            const res = await fetch(url);
            const decryptedJson = decryptData(await res.text(), key);
            if (!decryptedJson) return null;

            const d = JSON.parse(decryptedJson).data;

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

        const resolutions = [3, 2, 1];
        for (const resolution of resolutions) {
            const url = `${MAIN_URL}/film-api/v2.0.1/movie/getVideo2?clientType=1&packageName=com.external.castle&channel=IndiaA&lang=en-US`;
            const body = {
                mode: "1", appMarket: "GuanWang", clientType: "1", woolUser: "false",
                apkSignKey: "ED0955EB04E67A1D9F3305B95454FED485261475", androidVersion: "13",
                movieId, episodeId, isNewUser: "true", resolution: resolution.toString(),
                packageName: "com.external.castle",
                languageId: languageId ? languageId.toString() : undefined
            };

            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': 'okhttp/4.9.0', 'Cookie': cookie || '' },
                    body: JSON.stringify(body)
                });

                const decryptedJson = decryptData(await res.text(), key);
                if (!decryptedJson) continue;

                const data = JSON.parse(decryptedJson).data;
                if (data && data.videoUrl) {
                    return {
                        videoUrl: data.videoUrl,
                        subtitles: data.subtitles?.map((s: any) => ({ language: s.abbreviate || s.title, url: s.url, label: s.title })) || [],
                        qualities: data.videos?.map((v: any) => ({ quality: v.resolutionDescription || `${v.resolution}p`, url: '' })), // Qualities are internal to HLS usually
                        headers: { 'Referer': MAIN_URL }
                    };
                }
            } catch { }
        }
        return null;
    }
};
