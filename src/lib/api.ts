'use server';

import { cookies } from 'next/headers';

import { MeowVerseProvider } from './providers/meowverse';
import { Provider, HomePageRow, ContentItem, MovieDetails, VideoResponse } from './providers/types';

import { MeowTvProvider } from './providers/meowtv';
import { MeowToonProvider } from './providers/meowtoon';
import { fetchDetails as fetchXonDetails, fetchStream as fetchXonStream } from './xon';

// Registry
const PROVIDERS: Record<string, Provider> = {
    'MeowTV': MeowTvProvider,
    'MeowVerse': MeowVerseProvider,
    'MeowToon': MeowToonProvider,
};

const DEFAULT_PROVIDER = 'MeowTV';

type CachedDetails = { value: MovieDetails; expiresAt: number };
type CachedStream = { value: VideoResponse; expiresAt: number };

const DETAILS_CACHE_TTL_MS = 10 * 60 * 1000;
const STREAM_CACHE_TTL_MS = 10 * 60 * 1000;
const detailsCache = new Map<string, CachedDetails>();
const streamCache = new Map<string, CachedStream>();

function getCachedDetails(cacheKey: string): MovieDetails | null {
    const hit = detailsCache.get(cacheKey);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
        detailsCache.delete(cacheKey);
        return null;
    }
    return hit.value;
}

function setCachedDetails(cacheKey: string, value: MovieDetails): void {
    detailsCache.set(cacheKey, { value, expiresAt: Date.now() + DETAILS_CACHE_TTL_MS });
}

function getCachedStream(cacheKey: string): VideoResponse | null {
    const hit = streamCache.get(cacheKey);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
        streamCache.delete(cacheKey);
        return null;
    }
    return hit.value;
}

function setCachedStream(cacheKey: string, value: VideoResponse): void {
    streamCache.set(cacheKey, { value, expiresAt: Date.now() + STREAM_CACHE_TTL_MS });
}

async function getProviderWithName(): Promise<{ providerName: string; provider: Provider }> {
    const cookieStore = await cookies();
    const providerName = cookieStore.get('provider')?.value || DEFAULT_PROVIDER;
    return { providerName, provider: PROVIDERS[providerName] || PROVIDERS[DEFAULT_PROVIDER] };
}

function resolveProviderForId(id: string, fallbackName: string): { providerName: string; provider: Provider } {
    if (id.startsWith('xon:')) {
        return { providerName: 'MeowToon', provider: PROVIDERS['MeowToon'] };
    }
    return { providerName: fallbackName, provider: PROVIDERS[fallbackName] || PROVIDERS[DEFAULT_PROVIDER] };
}

// Global Exported Functions (Facade)

export async function fetchHome(page: number = 1): Promise<Promise<HomePageRow[]>[]> {
    const { provider } = await getProviderWithName();
    return provider.fetchHome(page);
}

export async function searchContent(query: string): Promise<ContentItem[]> {
    const { provider } = await getProviderWithName();
    return provider.search(query);
}

// Details: try direct Xon first (cached), then provider-based resolution
export async function fetchDetails(id: string, includeEpisodes: boolean = true): Promise<MovieDetails | null> {
    if (id.startsWith('xon:')) {
        const cacheKey = `XON::${id}`;
        const cached = getCachedDetails(cacheKey);
        if (cached) return cached;

        try {
            const rawId = id.slice('xon:'.length);
            const details = await fetchXonDetails(rawId);
            if (details) {
                const episodes = (details.episodes || []).map((ep: any) => ({
                    id: `xon:${ep.id}`,
                    title: ep.title,
                    number: ep.episode ?? ep.number ?? 0,
                    season: ep.season ?? 1,
                    coverImage: ep.poster || undefined,
                    description: ep.description,
                    sourceMovieId: `xon:${details.id}`,
                }));

                // For movies (and episodes with no list), synthesize a single playable entry
                // pointing back to the content's own ID so fetchStreamUrl can resolve it.
                const isMovieId = rawId.startsWith('movie:');
                const isEpisodeId = rawId.startsWith('episode:');
                const needsSynth = (isMovieId || isEpisodeId) && episodes.length === 0;
                const synthEpisodes = needsSynth
                    ? [{
                        id,                          // e.g. "xon:movie:123" — matches what fetchStreamUrl expects
                        title: details.title,
                        number: 1,
                        season: 1,
                        coverImage: details.poster || undefined,
                        description: details.description,
                        sourceMovieId: id,
                    }]
                    : undefined;

                const mapped: MovieDetails = {
                    id: `xon:${details.id}`,
                    title: details.title,
                    description: details.description,
                    coverImage: details.poster || '',
                    backgroundImage: details.backdrop || undefined,
                    // For movies: only the synth entry; for shows: real episodes
                    episodes: episodes.length ? episodes : synthEpisodes,
                    seasons: undefined,
                    tags: undefined,
                };
                setCachedDetails(cacheKey, mapped);
                return mapped;
            }
        } catch (e) {
            console.error('[api] xon direct fetchDetails failed', e);
        }
        console.warn('[api] xon direct fetchDetails returned null', id);
        // fall through to provider-based resolution
    }

    const base = await getProviderWithName();
    const { providerName, provider } = resolveProviderForId(id, base.providerName);
    const cacheKey = `${providerName}::${id}`;

    try {
        const details = await provider.fetchDetails(id, includeEpisodes);
        if (details) {
            // Only cache if NOT MeowVerse during debugging
            if (providerName !== 'MeowVerse') {
                setCachedDetails(cacheKey, details);
            }
            return details;
        }
    } catch (e) {
        console.error('[api] fetchDetails failed', e);
    }

    // Don't return cached MeowVerse details during debugging
    if (providerName === 'MeowVerse') return null;
    const cached = getCachedDetails(cacheKey);
    if (cached) return cached;

    // Last-resort stub for xon:* to avoid empty page
    if (id.startsWith('xon:')) {
        return {
            id,
            title: 'Unavailable',
            coverImage: '',
            description: 'Content could not be loaded.',
            episodes: [{ id, title: 'Unavailable', number: 1, season: 1, sourceMovieId: id }],
        } as MovieDetails;
    }

    return null;
}

export async function fetchStreamUrl(
    movieId: string,
    episodeId: string,
    languageId?: number | string
): Promise<VideoResponse | null> {
    if (episodeId.startsWith('xon:') || movieId.startsWith('xon:')) {
        const cacheKey = `XON::${movieId}::${episodeId}::${languageId ?? ''}`;
        const cached = getCachedStream(cacheKey);
        if (cached) return cached;

        try {
            const stream = await fetchXonStream((episodeId || movieId).replace(/^xon:/, ''));
            if (stream) {
                const mapped: VideoResponse = {
                    videoUrl: stream.qualities?.[0]?.url || '',
                    qualities: stream.qualities?.map((q) => ({ quality: q.label, url: q.url })) || [],
                    subtitles: [],
                    headers: {},
                };
                setCachedStream(cacheKey, mapped);
                return mapped;
            }
        } catch (e) {
            console.error('[api] xon direct fetchStreamUrl failed', e);
        }
        console.warn('[api] xon direct fetchStreamUrl returned null', { movieId, episodeId });
        // fall through to provider-based resolution
    }

    const base = await getProviderWithName();
    const hintId = episodeId || movieId;
    const { providerName, provider } = resolveProviderForId(hintId, base.providerName);
    const cacheKey = `${providerName}::${movieId}::${episodeId}::${languageId ?? ''}`;

    try {
        const videoData = await provider.fetchStreamUrl(movieId, episodeId, languageId);
        if (videoData) {
            // Only cache if NOT MeowVerse during debugging
            if (providerName !== 'MeowVerse') {
                setCachedStream(cacheKey, videoData);
            }
            return videoData;
        }
    } catch (e) {
        console.error('[api] fetchStreamUrl failed', e);
    }

    // Don't return cached MeowVerse streams during debugging
    if (providerName === 'MeowVerse') return null;
    return getCachedStream(cacheKey);
}

// Helper to switch provider (Server Action)
export async function setProviderAction(providerName: string) {
    const cookieStore = await cookies();
    const isProd = process.env.NODE_ENV === 'production';
    cookieStore.set('provider', providerName, {
        secure: isProd, // allow localhost/http during development
        httpOnly: true,
        sameSite: 'strict',
    });
}

export async function getProviderNameAction(): Promise<string> {
    const cookieStore = await cookies();
    return cookieStore.get('provider')?.value || DEFAULT_PROVIDER;
}
