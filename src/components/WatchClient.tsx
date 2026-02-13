'use client';

import { useState, useEffect } from 'react';
import VideoPlayer, { VideoPlayerProps } from '@/components/VideoPlayer';
import { fetchStreamUrlClient } from '@/lib/providers/meowverse-client';

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
        // If we already have data (Server Side Fetch), just use it.
        if (initialVideoData) {
            setLoading(false);
            return;
        }

        // If no data and MeowVerse, fetch on client
        if (providerName === 'MeowVerse') {

            setLoading(true);
            fetchStreamUrlClient(movieId, episodeId, typeof languageId === 'string' ? languageId : undefined)
                .then(data => {
                    if (data) {
                        setVideoData({
                            videoUrl: data.videoUrl,
                            subtitles: (data.subtitles || []).map((s: any) => ({
                                title: s.label || s.title || 'Subtitles',
                                url: s.url,
                                language: s.language || 'en'
                            })),
                            qualities: data.qualities,
                            audioTracks: [] // populated from props/wrapper usually
                        });
                    } else {
                        setError('Failed to load stream (Client).');
                    }
                })
                .catch(err => {
                    console.error(err);
                    setError('Error loading stream.');
                })
                .finally(() => setLoading(false));
        } else {
            // Should have been fetched on server
            setLoading(false);
            setError('Stream not available.');
        }
    }, [providerName, movieId, episodeId, languageId, initialVideoData]);

    if (loading) {
        return (
            <div className="player-container player-shell player-loading center">
                <div className="spinner"></div>
                <p className="muted" style={{ marginTop: '1rem' }}>Initiating Secure Session...</p>
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
        <VideoPlayer
            key={episodeId}
            initialUrl={videoData.videoUrl}
            poster={poster}
            movieId={movieId}
            episodeId={episodeId}
            languageId={languageId}
            subtitles={videoData.subtitles || []}
            qualities={videoData.qualities || []}
            audioTracks={props.audioTracks} // Passed from page.tsx (episode tracks)
            showOpenDownload={props.showOpenDownload}
        />
    );
}
