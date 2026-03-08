import type { ContentItem, Details, EpisodeItem, HomeRow, StreamResponse } from '../types';

// Ported from existing Kartoons provider logic.
const MAIN_URL = 'https://api.kartoons.me';

type KartoonsListResponse<T> = { data?: T };

async function decodeKartoonsLinkToM3u8Url(encoded: string): Promise<string | null> {
  const clean = String(encoded || '').replace(/\s+/g, '');
  if (!clean) return null;

  // Single-step local stream endpoint: returns the final HLS playlist text.
  // This minimizes extra client->server hops.
  return `https://kartoondecrypt.onrender.com/kartoons?data=${encodeURIComponent(clean)}`;
}

function normalizeId(id: any): string | null {
  if (id == null) return null;
  const s = String(id).trim();
  return s.length ? s : null;
}

const TOKEN_URL = 'https://kartoon-api.vercel.app/api/key';
let cachedToken: string | null = null;

async function fetchKartoonsToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  try {
    const res = await fetch(TOKEN_URL);
    if (res.ok) {
      const data = await res.json();
      cachedToken = data.apiKey || null;
      return cachedToken;
    }
  } catch (e) {
    console.error('[Kartoons] Failed to fetch token:', e);
  }
  return null;
}

async function fetchJson<T>(url: string): Promise<T> {
  // Keep this simple and fast-fail so SSR doesn't hang for 10s+ on blocked networks.
  const controller = new AbortController();
  const timeoutMs = 4_000;
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const token = await fetchKartoonsToken();
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://kartoons.me/',
      'Origin': 'https://kartoons.me',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} for ${url}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

function kId(type: 'movie' | 'series' | 'episode', identifier: string): string {
  // Global ID namespace inside xon-app
  // kartoones:movie:<slugOrId>
  // kartoones:series:<slug>
  // kartoones:episode:<rawEpisodeId>
  return `kartoons:${type}:${identifier}`;
}

function parseKId(id: string): { type: 'movie' | 'series' | 'episode'; identifier: string } | null {
  const parts = String(id).split(':');
  if (parts.length < 3) return null;
  if (parts[0] !== 'kartoons') return null;
  const type = parts[1] as any;
  const identifier = parts.slice(2).join(':');
  if (!identifier) return null;
  if (type !== 'movie' && type !== 'series' && type !== 'episode') return null;
  return { type, identifier };
}

export const KartoonsProvider = {
  name: 'Kartoons',

  async fetchHome(): Promise<HomeRow[]> {
    // Similar to existing MeowToon provider
    const [showsData, moviesData, popShowsData, popMoviesData] = await Promise.all([
      fetchJson<KartoonsListResponse<any[]>>(`${MAIN_URL}/api/shows/?page=1&limit=20`),
      fetchJson<KartoonsListResponse<any[]>>(`${MAIN_URL}/api/movies/?page=1&limit=20`),
      fetchJson<KartoonsListResponse<any[]>>(`${MAIN_URL}/api/popularity/shows?limit=15&period=day`),
      fetchJson<KartoonsListResponse<any[]>>(`${MAIN_URL}/api/popularity/movies?limit=15&period=day`),
    ]);

    const mapToItem = (item: any, type: 'series' | 'movie'): ContentItem => ({
      id: kId(type, String(item?.slug ?? item?.id ?? '')),
      title: item?.title ?? '',
      type,
      poster: item?.image ?? '',
      backdrop: item?.coverImage ?? item?.hoverImage ?? '',
      description: item?.description ?? undefined,
      source: 'kartoons',
    });

    return [
      { name: 'Kartoons • Popular Shows', items: (popShowsData.data || []).map((i: any) => mapToItem(i, 'series')) },
      { name: 'Kartoons • Popular Movies', items: (popMoviesData.data || []).map((i: any) => mapToItem(i, 'movie')) },
      { name: 'Kartoons • Shows', items: (showsData.data || []).map((i: any) => mapToItem(i, 'series')) },
      { name: 'Kartoons • Movies', items: (moviesData.data || []).map((i: any) => mapToItem(i, 'movie')) },
    ].filter((r) => r.items.length > 0);
  },

  async search(query: string): Promise<ContentItem[]> {
    const res = await fetchJson<KartoonsListResponse<any[]>>(
      `${MAIN_URL}/api/search/suggestions?q=${encodeURIComponent(query)}&limit=20`
    );

    return (res.data || []).map((item: any) => {
      const t = String(item?.type ?? '').toLowerCase();
      const type: 'movie' | 'series' = t === 'movie' ? 'movie' : 'series';
      const identifier = String(item?.id ?? item?.slug ?? '').trim();
      return {
        id: kId(type, identifier),
        title: item?.title ?? '',
        type,
        poster: item?.image ?? '',
        description: item?.description ?? undefined,
        source: 'kartoons',
      };
    });
  },

  async fetchDetails(id: string): Promise<Details | null> {
    const parsed = parseKId(id);
    if (!parsed) return null;

    try {
      if (parsed.type === 'series') {
        const url = `${MAIN_URL}/api/shows/${encodeURIComponent(parsed.identifier)}`;
        const json = await fetchJson<any>(url);
        const data = json?.data;
        if (!data) return null;

        const showSlug = data.slug;
        const seasonsRaw = Array.isArray(data.seasons) ? data.seasons : [];

        // fetch episodes for each season
        const seasonEpisodeLists = await Promise.all(
          seasonsRaw.map(async (season: any) => {
            const seasonSlug = normalizeId(season?.slug);
            const seasonNumber = Number.parseInt(String(season?.seasonNumber ?? ''), 10);
            if (!showSlug || !seasonSlug || !Number.isFinite(seasonNumber)) return [] as EpisodeItem[];

            const sUrl = `${MAIN_URL}/api/shows/${encodeURIComponent(showSlug)}/season/${encodeURIComponent(seasonSlug)}/all-episodes`;
            try {
              const sJson = await fetchJson<any>(sUrl);
              const eps = Array.isArray(sJson?.data) ? sJson.data : [];
              return eps
                .map((ep: any): EpisodeItem | null => {
                  const epId = normalizeId(ep?.id ?? ep?._id);
                  if (!epId) return null;
                  const epNumber = Number.parseInt(String(ep?.episodeNumber ?? 0), 10);
                  return {
                    id: kId('episode', epId),
                    title: ep?.title ?? `Episode ${epNumber}`,
                    season: seasonNumber,
                    episode: Number.isFinite(epNumber) ? epNumber : 0,
                    poster: ep?.image ?? undefined,
                    description: ep?.description ?? undefined,
                  };
                })
                .filter(Boolean) as EpisodeItem[];
            } catch {
              return [] as EpisodeItem[];
            }
          })
        );

        const episodes = seasonEpisodeLists
          .flat()
          .sort(
            (a, b) =>
              Number(a.season ?? 0) - Number(b.season ?? 0) || Number(a.episode ?? 0) - Number(b.episode ?? 0)
          );

        return {
          id,
          type: 'series',
          title: data.title ?? '',
          description: data.description ?? undefined,
          poster: data.image ?? undefined,
          backdrop: data.coverImage ?? data.hoverImage ?? undefined,
          episodes,
        };
      }

      if (parsed.type === 'movie') {
        const url = `${MAIN_URL}/api/movies/${encodeURIComponent(parsed.identifier)}`;
        const json = await fetchJson<any>(url);
        const data = json?.data;
        if (!data) return null;

        const movieApiId = normalizeId(data.id ?? data._id);
        if (!movieApiId) return null;

        // Represent movie as a single playable episode-like entry.
        const episodes: EpisodeItem[] = [
          {
            id: kId('episode', `mov-${movieApiId}`),
            title: data.title ?? 'Movie',
            season: 1,
            episode: 1,
            poster: data.image ?? undefined,
            description: data.description ?? undefined,
          },
        ];

        return {
          id,
          type: 'movie',
          title: data.title ?? '',
          description: data.description ?? undefined,
          poster: data.image ?? undefined,
          backdrop: data.coverImage ?? data.hoverImage ?? undefined,
          episodes,
        };
      }

      // A raw episode details fetch isn’t required for playback; we keep minimal info.
      if (parsed.type === 'episode') {
        return {
          id,
          type: 'episode',
          title: 'Episode',
        };
      }

      return null;
    } catch {
      // If Kartoons API is unreachable, do not crash SSR.
      return null;
    }
  },

  async fetchStream(id: string): Promise<StreamResponse | null> {
    const parsed = parseKId(id);
    if (!parsed) return null;

    try {
      // Episodes can be either:
      // - ep-<id> from show season lists
      // - mov-<id> from movies
      const identifier = parsed.identifier;

      let url: string;
      if (identifier.startsWith('mov-')) {
        url = `${MAIN_URL}/api/movies/${encodeURIComponent(identifier.slice('mov-'.length))}/links`;
      } else {
        url = `${MAIN_URL}/api/shows/episode/${encodeURIComponent(identifier)}/links`;
      }

      const json = await fetchJson<any>(url);
      const links = json?.data?.links;
      if (!Array.isArray(links) || links.length === 0) return null;

      for (const link of links) {
        const encoded = link?.url;
        if (!encoded) continue;

        try {
          const direct = await decodeKartoonsLinkToM3u8Url(String(encoded));
          if (!direct || !direct.startsWith('http')) continue;
          return {
            title: 'Kartoons',
            qualities: [{ label: 'Auto', url: direct }],
          };
        } catch {
          // try next
        }
      }

      return null;
    } catch {
      // If Kartoons API is unreachable, do not crash SSR.
      return null;
    }
  },
};
