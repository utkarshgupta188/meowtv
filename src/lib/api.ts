'use server';

import { cookies } from 'next/headers';

import { CncVerseProvider } from './providers/cncverse';
import { Provider, HomePageRow, ContentItem, MovieDetails, VideoResponse } from './providers/types';

import { CastleTvProvider } from './providers/castletv';
import { XonProvider } from './providers/xon';

// Registry
const PROVIDERS: Record<string, Provider> = {
    'MeowMov': CastleTvProvider,
    'MeowVerse': CncVerseProvider,
    'MeowToon': XonProvider
};

const DEFAULT_PROVIDER = 'MeowMov';

async function getProvider(): Promise<Provider> {
    const cookieStore = await cookies();
    const providerName = cookieStore.get('provider')?.value || DEFAULT_PROVIDER;
    return PROVIDERS[providerName] || PROVIDERS[DEFAULT_PROVIDER];
}

// Global Exported Functions (Facade)

export async function fetchHome(page: number = 1): Promise<HomePageRow[]> {
    const provider = await getProvider();
    return provider.fetchHome(page);
}

export async function searchContent(query: string): Promise<ContentItem[]> {
    const provider = await getProvider();
    return provider.search(query);
}

export async function fetchDetails(id: string): Promise<MovieDetails | null> {
    const provider = await getProvider();
    return provider.fetchDetails(id);
}

export async function fetchStreamUrl(
    movieId: string,
    episodeId: string,
    languageId?: number | string
): Promise<VideoResponse | null> {
    const provider = await getProvider();
    return provider.fetchStreamUrl(movieId, episodeId, languageId);
}

// Helper to switch provider (Server Action)
export async function setProviderAction(providerName: string) {
    const cookieStore = await cookies();
    cookieStore.set('provider', providerName, { secure: true, httpOnly: true, sameSite: 'strict' });
}

export async function getProviderNameAction(): Promise<string> {
    const cookieStore = await cookies();
    return cookieStore.get('provider')?.value || DEFAULT_PROVIDER;
}
