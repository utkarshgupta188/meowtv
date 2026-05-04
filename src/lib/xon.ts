/*
	Xon provider ported from `XonProvider` (Cloudstream Kotlin).
	This module is server-side only (uses module-level cache).
*/

import type { ContentItem, Details, EpisodeItem, HomeRow, StreamQuality, StreamResponse } from './xon-types.js';

type FirebaseAuthResponse = {
	kind?: string;
	idToken: string;
	refreshToken: string;
	expiresIn: string;
	localId: string;
};

type FirebaseSettingsResponse = {
	name?: string;
	fields: Record<string, Record<string, string>>;
	createTime?: string;
	updateTime?: string;
};

export type XonLanguage = { id: number; no: number; name: string; audio: string };
export type XonShow = {
	id: number;
	no: number;
	name: string;
	thumb: string;
	cover: string;
	des: string;
	language: number;
	backup_img: string;
	locked: number;
};
export type XonSeason = {
	id: number;
	no: number;
	name: string;
	thumb: string;
	cover: string;
	genre?: string | null;
	des?: string | null;
	type: string;
	link?: string | null;
	ongoing: number;
	trending: number;
	language: number;
	show_id: number;
	block_ads: number;
	backup_img?: string | null;
	ttype: number;
	trailer?: string | null;
	rating?: string | null;
	series?: string | null;
	season?: string | null;
	locked: number;
};
export type XonEpisode = {
	id: number;
	no: number;
	name: string;
	thumb: string;
	cover: string;
	des: string;
	tags: string;
	type: string;
	link: string;
	basic: string;
	sd: string;
	hd: string;
	fhd: string;
	season_id: number;
	show_id: number;
	language: number;
	premium: number;
	wfeathers: number;
	bfeathers: number;
	sfeathers: number;
	block_ads: number;
	trending: number;
	eplay: string;
	backup_img: string;
	locked: number;
	updated_at: string;
};
export type XonEpisodesResponse = { current_time: string; episodes: XonEpisode[] };
export type XonMovie = {
	id: number;
	no: number;
	name: string;
	thumb: string;
	cover: string;
	genre: string;
	des: string;
	tags: string;
	type: string;
	link: string;
	trailer: string;
	ttype: number;
	basic: string;
	sd: string;
	hd: string;
	fhd: string;
	show_id: number;
	language: number;
	premium: number;
	wfeathers: number;
	bfeathers: number;
	sfeathers: number;
	block_ads: number;
	trending: number;
	special: number;
	eplay: string;
	backup_img: string;
	locked: number;
};

// Defaults (Kotlin provider falls back to these if auth/settings fails)
let mainUrl = 'http://myavens18052002.xyz/nzapis';
let apiKey = '553y845hfhdlfhjkl438943943839443943fdhdkfjfj9834lnfd98';

let authToken: string | null = null;
let authExpireTime = 0;

let didTrySettings = false;

const cache = {
	languages: [] as XonLanguage[],
	shows: [] as XonShow[],
	seasons: [] as XonSeason[],
	episodes: [] as XonEpisode[],
	movies: [] as XonMovie[],
	indexes: {
		languagesById: new Map<number, XonLanguage>(),
		showsById: new Map<number, XonShow>(),
		seasonsById: new Map<number, XonSeason>(),
		seasonsByShowId: new Map<number, XonSeason[]>(),
		episodesById: new Map<number, XonEpisode>(),
		episodesBySeasonId: new Map<number, XonEpisode[]>(),
		moviesById: new Map<number, XonMovie>(),
	},
	lastCacheTime: 0,
};

const CACHE_REFRESH_MS = 24 * 60 * 60 * 1000; // 24h

function getHeaders(): Record<string, string> {
	// Keep as close as possible to the Android provider.
	return {
		api: apiKey,
		caller: 'vion-official-app',
		// Avoid "forbidden" headers like Host/Connection that can cause Next/undici fetch to throw.
		'Cache-Control': 'no-cache',
		Accept: 'application/json',
		'User-Agent': 'okhttp/3.14.9',
	};
}

function formatMediaUrl(u: string): string {
	if (!u) return u;
	if (u.startsWith('http://') || u.startsWith('https://')) return u;
	// Kotlin uses archive.org for relative paths.
	return `https://archive.org/download/${u}`;
}

function getLanguageName(languageId: number): string {
	return cache.indexes.languagesById.get(languageId)?.name ?? 'Unknown';
}

function getShowName(showId: number): string {
	return cache.indexes.showsById.get(showId)?.name ?? 'Unknown Show';
}

function rebuildIndexes(): void {
	cache.indexes.languagesById = new Map(cache.languages.map((l) => [l.id, l] as const));
	cache.indexes.showsById = new Map(cache.shows.map((s) => [s.id, s] as const));
	cache.indexes.seasonsById = new Map(cache.seasons.map((s) => [s.id, s] as const));
	cache.indexes.episodesById = new Map(cache.episodes.map((e) => [e.id, e] as const));
	cache.indexes.moviesById = new Map(cache.movies.map((m) => [m.id, m] as const));

	const seasonsByShowId = new Map<number, XonSeason[]>();
	for (const season of cache.seasons) {
		const list = seasonsByShowId.get(season.show_id);
		if (list) list.push(season);
		else seasonsByShowId.set(season.show_id, [season]);
	}
	cache.indexes.seasonsByShowId = seasonsByShowId;

	const episodesBySeasonId = new Map<number, XonEpisode[]>();
	for (const ep of cache.episodes) {
		const list = episodesBySeasonId.get(ep.season_id);
		if (list) list.push(ep);
		else episodesBySeasonId.set(ep.season_id, [ep]);
	}
	cache.indexes.episodesBySeasonId = episodesBySeasonId;
}

async function authenticateAndGetSettings(): Promise<void> {
	if (didTrySettings) return;
	didTrySettings = true;

	try {
		// Step 1: Firebase anonymous auth (signUp)
		const authRes = await fetch(
			'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=AIzaSyAC__yhrI4ExLcqWbZjsLN33_gVgyp6w3A',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
				cache: 'no-store',
			}
		);

		if (!authRes.ok) {
			throw new Error(`Firebase auth HTTP ${authRes.status}`);
		}

		const authData = (await authRes.json()) as FirebaseAuthResponse;
		authToken = authData.idToken;
		const expiresSeconds = Number.parseInt(authData.expiresIn ?? '3600', 10);
		authExpireTime = Date.now() + (Number.isFinite(expiresSeconds) ? expiresSeconds : 3600) * 1000;

		// Step 2: Firestore settings doc
		const settingsRes = await fetch(
			'https://firestore.googleapis.com/v1/projects/xon-app/databases/(default)/documents/settings/BvJwsNb0eaObbigSefkm',
			{
				headers: { Authorization: `Bearer ${authData.idToken}` },
				cache: 'no-store',
			},
		);

		if (!settingsRes.ok) {
			throw new Error(`Firestore settings HTTP ${settingsRes.status}`);
		}

		const settings = (await settingsRes.json()) as FirebaseSettingsResponse;

		const api = settings.fields?.api?.stringValue;
		const base = settings.fields?.base?.stringValue;

		if (typeof api === 'string' && api.length) apiKey = api;
		if (typeof base === 'string' && base.length) mainUrl = base.replace(/\/+$/, '');
	} catch (e) {
		// Fall back to hardcoded values.


	}
}

async function fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
	const res = await fetch(url, { headers, cache: 'no-store' });
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`HTTP ${res.status} for ${url}${body ? `: ${body.slice(0, 200)}` : ''}`);
	}
	return (await res.json()) as T;
}

export async function refreshCache(force: boolean = false): Promise<void> {
	const now = Date.now();

	// Best-effort dynamic settings; falls back to defaults if blocked.
	await authenticateAndGetSettings();

	if (
		!force &&
		now - cache.lastCacheTime < CACHE_REFRESH_MS &&
		cache.languages.length > 0 &&
		cache.shows.length > 0
	) {
		return;
	}

	const headers = getHeaders();

	// Keep endpoint paths identical to Kotlin.
	const base = mainUrl.replace(/\/+$/, '');

	try {
		const [languages, shows, seasons, episodesResp, movies] = await Promise.all([
			fetchJson<XonLanguage[]>(`${base}/nzgetlanguages.php`, headers),
			fetchJson<XonShow[]>(`${base}/nzgetshows.php`, headers),
			fetchJson<XonSeason[]>(`${base}/nzgetseasons.php`, headers),
			fetchJson<XonEpisodesResponse>(`${base}/nzgetepisodes_v2.php?since=`, headers),
			fetchJson<XonMovie[]>(`${base}/nzgetmovies.php`, headers),
		]);

		cache.languages = Array.isArray(languages) ? languages : [];
		cache.shows = Array.isArray(shows) ? shows : [];
		cache.seasons = Array.isArray(seasons) ? seasons : [];
		cache.episodes = Array.isArray(episodesResp?.episodes) ? episodesResp.episodes : [];
		cache.movies = Array.isArray(movies) ? movies : [];
		rebuildIndexes();
		cache.lastCacheTime = now;
	} catch (e) {
		// Keep whatever we already have, instead of blanking the homepage.
		if (cache.lastCacheTime && cache.shows.length > 0) return;
		throw e;
	}
}

export async function fetchHome(): Promise<HomeRow[]> {
	await refreshCache();

	const trendingShows: ContentItem[] = cache.shows.slice(0, 20).map((s) => ({
		id: `show:${s.id}`,
		type: 'series',
		title: `${s.name} (${getLanguageName(s.language)})`,
		poster: formatMediaUrl((s.cover || s.thumb || '').trim()),
		backdrop: formatMediaUrl((s.cover || s.thumb || '').trim()),
		description: s.des || undefined,
		source: 'xon',
	}));

	const latestEpisodes: ContentItem[] = cache.episodes.slice(0, 20).map((e) => ({
		id: `episode:${e.id}`,
		type: 'episode',
		title: `${getShowName(e.show_id)} - ${e.name} (${getLanguageName(e.language)})`,
		poster: formatMediaUrl((e.thumb || '').trim()),
		backdrop: formatMediaUrl((e.cover || e.thumb || '').trim()),
		description: e.des || undefined,
		source: 'xon',
	}));

	const movies: ContentItem[] = cache.movies.slice(0, 20).map((m) => ({
		id: `movie:${m.id}`,
		type: 'movie',
		title: `${m.name} (${getLanguageName(m.language)})`,
		poster: formatMediaUrl((m.cover || m.thumb || '').trim()),
		backdrop: formatMediaUrl((m.cover || m.thumb || '').trim()),
		description: m.des || undefined,
		source: 'xon',
	}));

	return [
		{ name: 'Trending Shows', items: trendingShows },
		{ name: 'Latest Episodes', items: latestEpisodes },
		{ name: 'Movies', items: movies },
	].filter((r) => r.items.length > 0);
}

export async function search(query: string): Promise<ContentItem[]> {
	await refreshCache();
	const q = query.trim();
	if (!q) return [];

	const out: ContentItem[] = [];

	for (const s of cache.shows) {
		const hay = `${s.name ?? ''} ${s.des ?? ''}`.toLowerCase();
		if (!hay.includes(q.toLowerCase())) continue;
		out.push({
			id: `show:${s.id}`,
			type: 'series',
			title: `${s.name} (${getLanguageName(s.language)})`,
			poster: formatMediaUrl((s.cover || s.thumb || '').trim()),
			backdrop: formatMediaUrl((s.cover || s.thumb || '').trim()),
			description: s.des || undefined,
			source: 'xon',
		});
	}

	for (const e of cache.episodes) {
		const hay = `${e.name ?? ''} ${e.tags ?? ''}`.toLowerCase();
		if (!hay.includes(q.toLowerCase())) continue;
		out.push({
			id: `episode:${e.id}`,
			type: 'episode',
			title: `${getShowName(e.show_id)} - ${e.name} (${getLanguageName(e.language)})`,
			poster: formatMediaUrl((e.thumb || '').trim()),
			backdrop: formatMediaUrl((e.cover || e.thumb || '').trim()),
			description: e.des || undefined,
			source: 'xon',
		});
	}

	for (const m of cache.movies) {
		const hay = `${m.name ?? ''} ${m.des ?? ''} ${m.tags ?? ''}`.toLowerCase();
		if (!hay.includes(q.toLowerCase())) continue;
		out.push({
			id: `movie:${m.id}`,
			type: 'movie',
			title: `${m.name} (${getLanguageName(m.language)})`,
			poster: formatMediaUrl((m.cover || m.thumb || '').trim()),
			backdrop: formatMediaUrl((m.cover || m.thumb || '').trim()),
			description: m.des || undefined,
			source: 'xon',
		});
	}

	return out.slice(0, 60);
}

export async function fetchDetails(id: string): Promise<Details | null> {
	await refreshCache();

	const [kind, rawId] = String(id).split(':', 2);
	const numId = Number.parseInt(rawId ?? '', 10);
	if (!kind || !Number.isFinite(numId)) return null;

	if (kind === 'show') {
		const show = cache.indexes.showsById.get(numId);
		if (!show) return null;

		const showSeasons = cache.indexes.seasonsByShowId.get(numId) ?? [];
		const episodes: EpisodeItem[] = [];

		for (const season of showSeasons) {
			const seasonEpisodes = cache.indexes.episodesBySeasonId.get(season.id) ?? [];
			for (const ep of seasonEpisodes) {
				episodes.push({
					id: `episode:${ep.id}`,
					title: ep.name,
					season: season.no,
					episode: ep.no,
					poster: formatMediaUrl((ep.thumb || '').trim()),
					description: ep.des || undefined,
				});
			}
		}

		episodes.sort((a, b) => (Number(a.season ?? 0) - Number(b.season ?? 0)) || (Number(a.episode ?? 0) - Number(b.episode ?? 0)));

		const langName = getLanguageName(show.language);

		return {
			id: `show:${show.id}`,
			type: 'series',
			title: `${show.name} (${langName})`,
			poster: formatMediaUrl((show.cover || show.thumb || '').trim()),
			backdrop: formatMediaUrl((show.cover || show.thumb || '').trim()),
			description: `${show.des ?? ''}\n\nLanguage: ${langName}`.trim(),
			episodes,
		};
	}

	if (kind === 'movie') {
		const movie = cache.indexes.moviesById.get(numId);
		if (!movie) return null;

		const langName = getLanguageName(movie.language);

		return {
			id: `movie:${movie.id}`,
			type: 'movie',
			title: `${movie.name} (${langName})`,
			poster: formatMediaUrl((movie.cover || movie.thumb || '').trim()),
			backdrop: formatMediaUrl((movie.cover || movie.thumb || '').trim()),
			description: `${movie.des ?? ''}\n\nLanguage: ${langName}`.trim(),
		};
	}

	if (kind === 'episode') {
		const ep = cache.indexes.episodesById.get(numId);
		if (!ep) return null;

		const show = cache.indexes.showsById.get(ep.show_id);
		const season = cache.indexes.seasonsById.get(ep.season_id);
		const langName = getLanguageName(ep.language);

		return {
			id: `episode:${ep.id}`,
			type: 'episode',
			title: `${show?.name ?? 'Unknown'} - ${ep.name} (${langName})`,
			poster: formatMediaUrl((ep.thumb || '').trim()),
			backdrop: formatMediaUrl((ep.cover || ep.thumb || '').trim()),
			description: `${ep.des ?? ''}\n\nSeason: ${season?.name ?? 'Unknown'}\nLanguage: ${langName}`.trim(),
		};
	}

	return null;
}

import { getHlsProxyUrl, getSimpleProxyUrl } from './proxy-config';

function toPlayableProxyUrl(sourceUrl: string): string {
	const u = formatMediaUrl(sourceUrl.trim());
	// If it's an HLS playlist, route through /api/hls for rewriting.
	// Some sources don't end with .m3u8 but still include m3u8 in the query.
	let looksLikeHls = /\.m3u8(\?|$)/i.test(u);
	if (!looksLikeHls) {
		try {
			const parsed = new URL(u);
			looksLikeHls = /m3u8/i.test(`${parsed.pathname}${parsed.search}`);
		} catch {
			// ignore
		}
	}
	if (looksLikeHls) {
		// Reverting segment bypass to match localhost behavior for debugging
		return getHlsProxyUrl(u, { referer: mainUrl, kind: 'playlist' });
	}
	return getSimpleProxyUrl(u, { referer: mainUrl });
}

export async function fetchStream(id: string): Promise<StreamResponse | null> {
	await refreshCache();

	const [kind, rawId] = String(id).split(':', 2);
	const numId = Number.parseInt(rawId ?? '', 10);
	if (!kind || !Number.isFinite(numId)) return null;

	if (kind === 'episode') {
		const e = cache.indexes.episodesById.get(numId);
		if (!e) return null;

		const qualities: StreamQuality[] = [];
		// Highest-first so callers that pick qualities[0] get best by default.
		if (e.fhd) qualities.push({ label: 'FHD', url: toPlayableProxyUrl(e.fhd) });
		if (e.hd) qualities.push({ label: 'HD', url: toPlayableProxyUrl(e.hd) });
		if (e.sd) qualities.push({ label: 'SD', url: toPlayableProxyUrl(e.sd) });
		if (e.basic) qualities.push({ label: 'Basic', url: toPlayableProxyUrl(e.basic) });

		// Fallback to external link if provided
		if (qualities.length === 0 && e.link) {
			qualities.push({ label: 'Link', url: toPlayableProxyUrl(e.link) });
		}

		return { title: e.name, qualities };
	}

	if (kind === 'movie') {
		const m = cache.indexes.moviesById.get(numId);
		if (!m) return null;

		const qualities: StreamQuality[] = [];
		// Highest-first so callers that pick qualities[0] get best by default.
		if (m.fhd) qualities.push({ label: 'FHD', url: toPlayableProxyUrl(m.fhd) });
		if (m.hd) qualities.push({ label: 'HD', url: toPlayableProxyUrl(m.hd) });
		if (m.sd) qualities.push({ label: 'SD', url: toPlayableProxyUrl(m.sd) });
		if (m.basic) qualities.push({ label: 'Basic', url: toPlayableProxyUrl(m.basic) });

		if (qualities.length === 0 && m.link) {
			qualities.push({ label: 'Link', url: toPlayableProxyUrl(m.link) });
		}

		return { title: m.name, qualities };
	}

	// For shows, caller should pass an episode ID (show itself isn't directly streamable)
	return null;
}

export function getCacheSnapshot() {
	return {
		mainUrl,
		apiKeyLen: apiKey.length,
		authToken: Boolean(authToken),
		lastCacheTime: cache.lastCacheTime,
		counts: {
			languages: cache.languages.length,
			shows: cache.shows.length,
			seasons: cache.seasons.length,
			episodes: cache.episodes.length,
			movies: cache.movies.length,
		},
	};
}
