import { Provider, HomePageRow, ContentItem, MovieDetails, Episode, Season, VideoResponse } from './types';
import crypto from 'crypto';

// Built from the Android provider in `Kartoons/`.
const MAIN_URL = 'https://api.kartoons.fun';
const SECRET_KEY_B64 = 'YmNhOWUwZGYxYTVhYmIzMjkwNmNhM2Y2M2FjMDRjZWY=';

type KartoonsListResponse<T> = { data?: T };

function base64UrlToBytes(b64url: string): Buffer {
    let s = b64url.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = s.length % 4;
    if (pad !== 0) s += '='.repeat(4 - pad);
    return Buffer.from(s, 'base64');
}

function deriveKeyBytes(secret: string): Buffer {
    const fixed = secret.padEnd(32, ' ').substring(0, 32);
    return Buffer.from(fixed, 'utf8');
}

function stripPkcs7Padding(data: Buffer): Buffer {
    if (data.length === 0) return data;
    const padValue = data[data.length - 1];
    if (!padValue || padValue < 1 || padValue > 16) return data;
    for (let i = 0; i < padValue; i++) {
        if (data[data.length - 1 - i] !== padValue) return data;
    }
    return data.subarray(0, data.length - padValue);
}

// encryptedDataBase64Url = base64url( IV(16 bytes) || CIPHERTEXT )
// secretKeyString = base64Decode(SECRET_KEY_B64) then padEnd(32, " ") in UTF-8
function decryptAesCbcBase64Url(encryptedDataBase64Url: string): string {
    const secretKeyString = Buffer.from(SECRET_KEY_B64, 'base64').toString('utf8');
    if (!encryptedDataBase64Url || !secretKeyString) {
        throw new Error('encrypted data and secret key must be provided');
    }

    const keyBytes = deriveKeyBytes(secretKeyString);
    if (keyBytes.length !== 32) {
        throw new Error(`Key length ${keyBytes.length} != 32 bytes`);
    }

    const encryptedBytes = base64UrlToBytes(encryptedDataBase64Url);
    if (encryptedBytes.length <= 16) {
        throw new Error('Ciphertext too short: missing IV or data');
    }

    const iv = encryptedBytes.subarray(0, 16);
    const ciphertext = encryptedBytes.subarray(16);

    const decipher = crypto.createDecipheriv('aes-256-cbc', keyBytes, iv);
    decipher.setAutoPadding(false);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return stripPkcs7Padding(decrypted).toString('utf8');
}

function normalizeKartoonsId(id: any): string | null {
    if (id == null) return null;
    const s = String(id).trim();
    return s.length ? s : null;
}

async function fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} for ${url}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    return res.json() as Promise<T>;
}

function parseContentId(raw: string): { type: 'movie' | 'series'; identifier: string } | null {
    if (!raw) return null;
    const idx = raw.indexOf('-');
    if (idx <= 0) return null;
    const prefix = raw.slice(0, idx);
    const identifier = raw.slice(idx + 1);
    if (!identifier) return null;
    if (prefix === 'movie') return { type: 'movie', identifier };
    if (prefix === 'series') return { type: 'series', identifier };
    return null;
}

export const XonProvider: Provider = {
    name: 'MeowToon',

    async fetchHome(page: number): Promise<HomePageRow[]> {
        if (page < 1) page = 1;
        if (page > 1) return [];

        try {
            const [showsData, moviesData, popShowsData, popMoviesData] = await Promise.all([
                fetchJson<KartoonsListResponse<any[]>>(`${MAIN_URL}/api/shows/?page=1&limit=20`),
                fetchJson<KartoonsListResponse<any[]>>(`${MAIN_URL}/api/movies/?page=1&limit=20`),
                fetchJson<KartoonsListResponse<any[]>>(`${MAIN_URL}/api/popularity/shows?limit=15&period=day`),
                fetchJson<KartoonsListResponse<any[]>>(`${MAIN_URL}/api/popularity/movies?limit=15&period=day`)
            ]);

            const mapToItem = (item: any, type: 'series' | 'movie'): ContentItem => ({
                id: `${type}-${item?.slug ?? item?.id}`,
                title: item?.title ?? '',
                coverImage: item?.image ?? '',
                type
            });

            return [
                { name: 'Popular Shows', contents: (popShowsData.data || []).map((i: any) => mapToItem(i, 'series')) },
                { name: 'Popular Movies', contents: (popMoviesData.data || []).map((i: any) => mapToItem(i, 'movie')) },
                { name: 'Shows', contents: (showsData.data || []).map((i: any) => mapToItem(i, 'series')) },
                { name: 'Movies', contents: (moviesData.data || []).map((i: any) => mapToItem(i, 'movie')) }
            ].filter(r => r.contents.length > 0);
        } catch (e) {
            console.error('[MeowToon] fetchHome failed:', e);
            return [];
        }
    },

    async search(query: string): Promise<ContentItem[]> {
        try {
            const res = await fetchJson<KartoonsListResponse<any[]>>(
                `${MAIN_URL}/api/search/suggestions?q=${encodeURIComponent(query)}&limit=20`
            );

            return (res.data || []).map((item: any) => {
                const t = String(item?.type ?? '').toLowerCase();
                const type: 'movie' | 'series' = t === 'movie' ? 'movie' : 'series';
                const identifier = item?.id ?? item?.slug;
                return {
                    id: `${type}-${identifier}`,
                    title: item?.title ?? '',
                    coverImage: item?.image ?? '',
                    type
                };
            });
        } catch (e) {
            console.error('[MeowToon] search failed:', e);
            return [];
        }
    },

    async fetchDetails(id: string): Promise<MovieDetails | null> {
        try {
            const parsed = parseContentId(id);
            if (!parsed) return null;

            const apiType = parsed.type === 'series' ? 'shows' : 'movies';
            const url = `${MAIN_URL}/api/${apiType}/${parsed.identifier}`;

            const json = await fetchJson<any>(url);
            const data = json?.data;
            if (!data) return null;

            const title = data.title ?? '';
            const coverImage = data.image ?? '';
            const backgroundImage = data.coverImage ?? data.hoverImage ?? undefined;

            if (parsed.type === 'series') {
                const showSlug = data.slug;
                const seasonsRaw = Array.isArray(data.seasons) ? data.seasons : [];
                const seasons: Season[] = seasonsRaw
                    .map((s: any): Season | null => {
                        const seasonNumber = Number.parseInt(String(s?.seasonNumber ?? ''), 10);
                        const seasonSlug = normalizeKartoonsId(s?.slug);
                        if (!Number.isFinite(seasonNumber) || !seasonSlug) return null;
                        return { id: seasonSlug, number: seasonNumber, name: `Season ${seasonNumber}` };
                    })
                    .filter(Boolean) as Season[];

                // Match Android implementation: fetch each season's episode list.
                const seasonEpisodeLists = await Promise.all(
                    seasonsRaw.map(async (season: any) => {
                        const seasonSlug = normalizeKartoonsId(season?.slug);
                        const seasonNumber = Number.parseInt(String(season?.seasonNumber ?? ''), 10);
                        if (!showSlug || !seasonSlug || !Number.isFinite(seasonNumber)) return [] as Episode[];

                        const sUrl = `${MAIN_URL}/api/shows/${showSlug}/season/${seasonSlug}/all-episodes`;
                        try {
                            const sJson = await fetchJson<any>(sUrl);
                            const eps = Array.isArray(sJson?.data) ? sJson.data : [];
                            return eps
                                .map((ep: any): Episode | null => {
                                    const epId = normalizeKartoonsId(ep?.id ?? ep?._id);
                                    if (!epId) return null;
                                    const epNumber = Number.parseInt(String(ep?.episodeNumber ?? 0), 10);
                                    return {
                                        id: `ep-${epId}`,
                                        title: ep?.title ?? `Episode ${epNumber}`,
                                        number: Number.isFinite(epNumber) ? epNumber : 0,
                                        season: seasonNumber,
                                        coverImage: ep?.image ?? undefined,
                                        description: ep?.description ?? undefined,
                                        sourceMovieId: id
                                    };
                                })
                                .filter(Boolean) as Episode[];
                        } catch (err) {
                            console.error('[MeowToon] Failed to fetch season episodes:', sUrl, err);
                            return [] as Episode[];
                        }
                    })
                );

                const episodes = seasonEpisodeLists.flat().sort((a, b) => (a.season - b.season) || (a.number - b.number));

                return {
                    id,
                    title,
                    description: data.description ?? undefined,
                    coverImage,
                    backgroundImage,
                    year: data.startYear ? Number.parseInt(String(data.startYear), 10) : undefined,
                    score: typeof data.rating === 'number' ? data.rating : undefined,
                    episodes,
                    seasons,
                    tags: Array.isArray(data.tags) ? data.tags : undefined
                };
            }

            // Movie
            const movieApiId = normalizeKartoonsId(data.id ?? data._id);
            if (!movieApiId) return null;

            const episodes: Episode[] = [
                {
                    id: `mov-${movieApiId}`,
                    title,
                    number: 1,
                    season: 1,
                    coverImage,
                    sourceMovieId: id
                }
            ];

            return {
                id,
                title,
                description: data.description ?? undefined,
                coverImage,
                backgroundImage,
                year: data.startYear ? Number.parseInt(String(data.startYear), 10) : undefined,
                score: typeof data.rating === 'number' ? data.rating : undefined,
                episodes,
                tags: Array.isArray(data.tags) ? data.tags : undefined
            };
        } catch (e) {
            console.error('[MeowToon] fetchDetails failed:', e);
            return null;
        }
    },

    async fetchStreamUrl(_movieId: string, episodeId: string): Promise<VideoResponse | null> {
        try {
            let url: string;
            if (episodeId.startsWith('ep-')) {
                url = `${MAIN_URL}/api/shows/episode/${episodeId.slice('ep-'.length)}/links`;
            } else if (episodeId.startsWith('mov-')) {
                url = `${MAIN_URL}/api/movies/${episodeId.slice('mov-'.length)}/links`;
            } else {
                console.warn('[MeowToon] Unknown episodeId format:', episodeId);
                return null;
            }

            const json = await fetchJson<any>(url);
            const links = json?.data?.links;
            if (!Array.isArray(links) || links.length === 0) return null;

            for (const link of links) {
                const encoded = link?.url;
                if (!encoded) continue;

                try {
                    const m3u8Url = decryptAesCbcBase64Url(String(encoded));
                    if (!m3u8Url || !m3u8Url.startsWith('http')) continue;

                    // Route through our HLS proxy so `enc2:` lines get decrypted server-side.
                    const proxied = `/api/hls?url=${encodeURIComponent(m3u8Url)}&referer=${encodeURIComponent(m3u8Url)}&decrypt=kartoons`;
                    return {
                        videoUrl: proxied,
                        headers: {},
                        qualities: []
                    };
                } catch (err) {
                    // try next link
                    console.error('[MeowToon] Decrypt failed for link:', err);
                }
            }
            return null;
        } catch (e) {
            console.error('[MeowToon] fetchStreamUrl failed:', e);
            return null;
        }
    }
};
