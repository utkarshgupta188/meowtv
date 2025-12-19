'use server';
import { fetchStreamUrl } from '@/lib/api';

export async function getStreamUrl(movieId: string, episodeId: string, languageId?: number | string) {
    try {
        const videoData = await fetchStreamUrl(movieId, episodeId, languageId);
        return videoData?.videoUrl || null;
    } catch (e) {
        console.error("Server Action getStreamUrl failed:", e);
        return null;
    }
}
