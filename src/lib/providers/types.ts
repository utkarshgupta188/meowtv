export interface Provider {
    name: string;
    fetchHome(page: number): Promise<HomePageRow[]>;
    search(query: string): Promise<ContentItem[]>;
    fetchDetails(id: string): Promise<MovieDetails | null>;
    fetchStreamUrl(movieId: string, episodeId: string, languageId?: number | string): Promise<VideoResponse | null>;
}

export interface HomePageRow {
    name: string;
    contents: ContentItem[];
}

export interface ContentItem {
    title: string;
    coverImage: string;
    id: string; // Unified ID (string)
    type: 'movie' | 'series';
    extra?: any;
}

export interface MovieDetails {
    id: string;
    title: string;
    description?: string;
    coverImage: string;
    backgroundImage?: string;
    year?: number;
    score?: number;
    episodes?: Episode[];
    seasons?: Season[];
    // Extra metadata
    tags?: string[];
    actors?: { name: string; image?: string }[];
}

export interface Episode {
    id: string;
    title: string;
    number: number;
    season: number;
    coverImage?: string;
    description?: string;
    tracks?: Track[];
    sourceMovieId?: string; // For grouping in CastleTV (Season ID)
}

export interface Season {
    id: string;
    number: number;
    name: string;
}

export interface Track {
    languageId?: number; // CastleTV specific
    name: string;
    url?: string; // For direct subtitle links or m3u8 if track is a video
    isDefault?: boolean;
}

export interface VideoResponse {
    videoUrl: string;
    subtitles?: Subtitle[];
    qualities?: Quality[];
    audioTracks?: Track[];
    headers?: Record<string, string>; // Essential for playback (Referer, etc.)
}

export interface Subtitle {
    language: string;
    url: string;
    label: string;
}

export interface Quality {
    quality: string; // "1080p", "720p"
    url: string;
}
