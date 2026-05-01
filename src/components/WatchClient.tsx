'use client';

import { useState, useEffect } from 'react';
import VideoPlayer, { VideoPlayerProps } from '@/components/VideoPlayer';

interface WatchClientProps extends Omit<VideoPlayerProps, 'initialUrl' | 'movieId' | 'episodeId'> {
    initialVideoData: {
        videoUrl: string;
        subtitles?: any[];
        qualities?: any[];
        audioTracks?: any[];
    } | null;
    providerName: string;
    movieId: string;
    episodeId: string;
    languageId?: number | string;
    poster?: string;
}

export default function WatchClient({
    initialVideoData,
    providerName,
    movieId,
    episodeId,
    languageId,
    poster,
    ...props
}: WatchClientProps) {
    const [videoData, setVideoData] = useState(initialVideoData);
    const [loading, setLoading] = useState(!initialVideoData);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Data is now consistently fetched on the server
        if (initialVideoData) {
            setVideoData(initialVideoData);
            setLoading(false);
            setError(null);
        } else {
            setLoading(false);
            setError('Stream not available.');
        }
    }, [initialVideoData]);

    if (loading) {
        return (
            <div className="player-container player-shell player-loading center">
                <div className="spinner"></div>
                <p className="muted" style={{ marginTop: '1rem' }}>Loading stream...</p>
            </div>
        );
    }

    if (error || !videoData?.videoUrl) {
        return (
            <div className="player-container player-shell player-empty center">
                <p className="muted">{error || 'No stream available.'}</p>
            </div>
        );
    }

    return (
        <div style={{ position: 'relative' }}>
            <VideoPlayer
                key={episodeId}
                initialUrl={videoData.videoUrl}
                poster={poster}
                movieId={movieId}
                episodeId={episodeId}
                languageId={languageId}
                subtitles={videoData.subtitles || []}
                qualities={videoData.qualities || []}
                audioTracks={props.audioTracks}
                showOpenDownload={props.showOpenDownload}
            />
        </div>
    );
}
