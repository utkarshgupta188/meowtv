import { Provider, HomePageRow, ContentItem, MovieDetails, Episode, Season, VideoResponse } from './types';
import { fetchHome as fetchXonHome, search as searchXon, fetchDetails as fetchXonDetails, fetchStream as fetchXonStream } from '../xon';

// Built from the Android provider in `Kartoons/`.
const MAIN_URL = 'https://api.kartoons.fun';
const DECRYPT_BASE = 'https://kartoondecrypt.onrender.com';

type KartoonsListResponse<T> = { data?: T };

type XonContentType = 'movie' | 'series' | 'episode';

function normalizeKartoonsId(id: any): string | null {
    if (id == null) return null;
    const s = String(id).trim();
    return s.length ? s : null;
}

function normalizeImage(src: any): string {
    return src ? String(src) : '';
}

function deriveSeasonNumber(raw: any, index: number): number {
    const candidates = [raw?.seasonNumber, raw?.season_no, raw?.seasonNo, raw?.number, raw?.season, raw?.season_id];
    for (const c of candidates) {
        const n = Number.parseInt(String(c ?? ''), 10);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return index + 1; // fallback to order
}

function isAbortError(err: any): boolean {
    const name = err?.name;
    const code = err?.code;
    return name === 'AbortError' || code === 20;
}

async function fetchJson<T>(url: string, timeoutMs: number = 8_000): Promise<T> {
    // Fast-fail so SSR doesn't hang on blocked networks.
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status} for ${url}${body ? `: ${body.slice(0, 200)}` : ''}`);
        }
        return res.json() as Promise<T>;
    } finally {
        clearTimeout(t);
    }
}

function toLocalKartoonsStreamUrl(encodedLink: string): string {
    const clean = String(encodedLink || '').replace(/\s+/g, '');
    // Fetch the decrypted playlist server-side via our HLS proxy so the client never hits
    // kartoondecrypt directly. The proxy will also rewrite segment/key URIs for us.
    const upstream = `${DECRYPT_BASE}/kartoons?data=${encodeURIComponent(clean)}`;
    return `/api/hls?url=${encodeURIComponent(upstream)}&decrypt=kartoons`;
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

export const MeowToonProvider: Provider = {
    name: 'MeowToon',

    async fetchHome(page: number): Promise<HomePageRow[]> {
        if (page < 1) page = 1;
        if (page > 1) return [];

        try {
            const xonRows = await fetchXonHome().catch(() => []);

            let kartoRows: HomePageRow[] = [];
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
                coverImage: normalizeImage(item?.image),
                type
            });

                kartoRows = [
                { name: 'Popular Shows', contents: (popShowsData.data || []).map((i: any) => mapToItem(i, 'series')) },
                { name: 'Popular Movies', contents: (popMoviesData.data || []).map((i: any) => mapToItem(i, 'movie')) },
                { name: 'Shows', contents: (showsData.data || []).map((i: any) => mapToItem(i, 'series')) },
                { name: 'Movies', contents: (moviesData.data || []).map((i: any) => mapToItem(i, 'movie')) }
                ].filter(r => r.contents.length > 0);
            } catch (kartErr) {
                // If Kartoons endpoints fail or time out, still return Xon rows.
                const label = isAbortError(kartErr) ? 'timeout/abort' : 'error';
                console.warn(`[MeowToon] Kartoons home ${label}:`, kartErr);
            }

            const xonMapped: HomePageRow[] = xonRows.map((row) => ({
                name: `Xon • ${row.name}`,
                contents: row.items.map((i) => ({
                    id: `xon:${i.id}`,
                    title: i.title,
                    coverImage: normalizeImage(i.poster || i.backdrop),
                    type: (i.type as XonContentType) === 'movie' ? 'movie' : 'series',
                })),
            }));

            return [...kartoRows, ...xonMapped];
        } catch (e) {
            if (isAbortError(e)) return [];
            console.error('[MeowToon] fetchHome failed:', e);
            return [];
        }
    },

    async search(query: string): Promise<ContentItem[]> {
        const results: ContentItem[] = [];

        try {
            const res = await fetchJson<KartoonsListResponse<any[]>>(
                `${MAIN_URL}/api/search/suggestions?q=${encodeURIComponent(query)}&limit=20`
            );

            const karto = (res.data || []).map((item: any) => {
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
            results.push(...karto);
        } catch (e) {
            if (!isAbortError(e)) console.error('[MeowToon] search failed:', e);
        }

        try {
                const xon = await searchXon(query);
                results.push(
                    ...xon.map((i) => {
                        const mappedType: 'movie' | 'series' = (i.type as XonContentType) === 'movie' ? 'movie' : 'series';
                        return {
                            id: `xon:${i.id}`,
                            title: i.title,
                            coverImage: normalizeImage(i.poster || i.backdrop),
                            type: mappedType,
                        } satisfies ContentItem;
                    })
                );
        } catch (e) {
            console.error('[MeowToon] xon search failed:', e);
        }

        // de-dupe by id
        const seen = new Set<string>();
        return results.filter((r) => {
            if (!r.id) return false;
            if (seen.has(r.id)) return false;
            seen.add(r.id);
            return true;
        });
    },

    async fetchDetails(id: string): Promise<MovieDetails | null> {
        if (id.startsWith('xon:')) {
            try {
                const details = await fetchXonDetails(id.slice('xon:'.length));
                if (!details) return null;

                const episodes: Episode[] = (details.episodes || []).map((ep: any) => ({
                    id: `xon:${ep.id}`,
                    title: ep.title,
                    number: ep.episode ?? ep.number ?? 0,
                    season: ep.season ?? 1,
                    coverImage: ep.poster,
                    description: ep.description,
                    sourceMovieId: id
                }));

                return {
                    id,
                    title: details.title,
                    description: details.description,
                    coverImage: normalizeImage(details.poster),
                    backgroundImage: details.backdrop ? normalizeImage(details.backdrop) : undefined,
                    episodes,
                    seasons: undefined,
                    tags: undefined
                };
            } catch (e) {
                console.error('[MeowToon] xon fetchDetails failed:', e);
                return null;
            }
        }

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
                    .map((s: any, idx: number): Season | null => {
                        const seasonNumber = deriveSeasonNumber(s, idx);
                        const seasonSlug = normalizeKartoonsId(s?.slug ?? s?._id ?? s?.id);
                        if (!seasonSlug) return null;
                        return { id: seasonSlug, number: seasonNumber, name: `Season ${seasonNumber}` };
                    })
                    .filter(Boolean) as Season[];

                // Match Android implementation: fetch each season's episode list.
                const seasonEpisodeLists = await Promise.all(
                    seasonsRaw.map(async (season: any, idx: number) => {
                        const seasonSlug = normalizeKartoonsId(season?.slug ?? season?._id ?? season?.id);
                        const seasonNumber = deriveSeasonNumber(season, idx);
                        if (!showSlug || !seasonSlug) return [] as Episode[];

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
                            if (!isAbortError(err)) {
                                console.error('[MeowToon] Failed to fetch season episodes:', sUrl, err);
                            }
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
            if (isAbortError(e)) return null;
            console.error('[MeowToon] fetchDetails failed:', e);
            return null;
        }
    },

    async fetchStreamUrl(_movieId: string, episodeId: string): Promise<VideoResponse | null> {
        if (episodeId.startsWith('xon:')) {
            try {
                const stream = await fetchXonStream(episodeId.slice('xon:'.length));
                if (!stream || !stream.qualities?.length) return null;
                const qualities = stream.qualities.map((q) => ({ quality: q.label, url: q.url }));
                const best = qualities[0];
                return {
                    videoUrl: best?.url || stream.qualities[0]?.url,
                    qualities,
                    headers: {}
                };
            } catch (e) {
                console.error('[MeowToon] xon fetchStreamUrl failed:', e);
                return null;
            }
        }

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

            let json: any;
            try {
                json = await fetchJson<any>(url, 4_000);
            } catch (e) {
                if (isAbortError(e)) {
                    // Retry once with a slightly longer timeout before giving up
                    try {
                        json = await fetchJson<any>(url, 8_000);
                    } catch (retryErr) {
                        if (isAbortError(retryErr)) return null;
                        console.error('[MeowToon] fetchStreamUrl retry failed:', retryErr);
                        return null;
                    }
                } else {
                    console.error('[MeowToon] fetchStreamUrl failed:', e);
                    return null;
                }
            }
            const links = json?.data?.links;
            if (!Array.isArray(links) || links.length === 0) return null;

            for (const link of links) {
                const encoded = link?.url;
                if (!encoded) continue;

                return {
                    // Single-step stream URL: Python decrypts the Kartoons blob AND returns the final playlist.
                    videoUrl: toLocalKartoonsStreamUrl(String(encoded)),
                    headers: {},
                    qualities: []
                };
            }
            return null;
        } catch (e) {
            if (!isAbortError(e)) console.error('[MeowToon] fetchStreamUrl failed:', e);
            return null;
        }
    }
};
