'use client';

import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { getStreamUrl } from '@/app/actions';
import type { Quality } from '@/lib/providers/types';

interface VideoPlayerProps {
    initialUrl: string;
    poster?: string;
    subtitles?: { title: string; url: string; language: string }[];
    qualities?: Quality[];
    audioTracks?: { languageId: number | string; name: string }[];
    movieId: string;
    episodeId: string;
    languageId?: number | string;
}

export default function VideoPlayer({
    initialUrl,
    poster,
    subtitles = [],
    qualities = [],
    audioTracks = [],
    movieId,
    episodeId,
    languageId
}: VideoPlayerProps) {
    console.log('[VideoPlayer] Received:', {
        subtitlesCount: subtitles.length,
        qualitiesCount: qualities.length,
        audioTracksCount: audioTracks.length
    });

    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const hlsMediaErrorCountRef = useRef(0);
    const hlsLastRecoveryAtRef = useRef(0);
    const [url, setUrl] = useState(initialUrl);
    const [currentQuality, setCurrentQuality] = useState<number | null>(null);
    const [currentAudio, setCurrentAudio] = useState<number | string | undefined>(languageId);
    const [error, setError] = useState<string | null>(null);

    // Internal HLS tracks state
    const [internalAudioTracks, setInternalAudioTracks] = useState<{ id: number; name: string }[]>([]);
    const [useInternalAudio, setUseInternalAudio] = useState(false);

    const [internalQualityLevels, setInternalQualityLevels] = useState<{ id: number; label: string }[]>([]);
    const [useInternalQuality, setUseInternalQuality] = useState(false);

    const [isLoading, setIsLoading] = useState(false);
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    useEffect(() => {
        // Reset state on new episode
        setUrl(initialUrl);
        setCurrentAudio(languageId);
        setCurrentQuality(null);
        hlsMediaErrorCountRef.current = 0;
        hlsLastRecoveryAtRef.current = 0;
        setInternalAudioTracks([]);
        setUseInternalAudio(false);
        setInternalQualityLevels([]);
        setUseInternalQuality(false);
    }, [initialUrl, languageId]);

    useEffect(() => {
        if (!isMounted) return;
        const video = videoRef.current;
        if (!video) return;

        // Detect HLS even if wrapped in proxy
        let isHls = url.includes('.m3u8') || url.includes('/api/hls?');
        if (url.includes('/api/proxy') || url.includes('/api/hls?')) {
            try {
                const params = new URLSearchParams(url.split('?')[1]);
                const realUrl = params.get('url');
                if (realUrl && realUrl.includes('.m3u8')) {
                    isHls = true;
                }
            } catch (e) {
                // ignore parsing error
            }
        }

        const onError = (e: Event) => {
            const target = e.target as HTMLVideoElement;
            const err = target.error;
            console.error("Video Error Details:", {
                code: err?.code,
                message: err?.message,
                networkState: target.networkState,
                readyState: target.readyState,
                currentSrc: target.currentSrc
            });
            setError(`Playback Error (${err?.code || 'Unknown'}). Format may not be supported.`);
        };

        video.addEventListener('error', onError);

        if (isHls && Hls.isSupported()) {
            if (hlsRef.current) {
                hlsRef.current.destroy();
            }

            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
                xhrSetup: function (xhr, url) {
                    xhr.withCredentials = false; // Avoid CORS issues with some proxies if not needed
                },
            });
            hlsRef.current = hls;

            hls.loadSource(url);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                // Check if HLS has multiple audio tracks (internal switching)
                if (hls.audioTracks && hls.audioTracks.length > 1) {
                    setUseInternalAudio(true);
                    setInternalAudioTracks(hls.audioTracks.map((t, i) => ({
                        id: i,
                        name: t.name || t.lang || `Audio ${i + 1}`
                    })));
                } else {
                    setUseInternalAudio(false);
                    setInternalAudioTracks([]);
                }

                // Internal quality switching from HLS variant levels
                if (hls.levels && hls.levels.length > 1) {
                    setUseInternalQuality(true);
                    const levelLabels = hls.levels.map((lvl, idx) => {
                        const h = (lvl as any).height as number | undefined;
                        const br = (lvl as any).bitrate as number | undefined;
                        if (h && Number.isFinite(h)) return { id: idx, label: `${h}p` };
                        if (br && Number.isFinite(br)) return { id: idx, label: `${Math.round(br / 1000)} kbps` };
                        return { id: idx, label: `Level ${idx + 1}` };
                    });
                    setInternalQualityLevels(levelLabels);
                    // default to auto
                    setCurrentQuality(-1);
                    hls.currentLevel = -1;
                } else {
                    setUseInternalQuality(false);
                    setInternalQualityLevels([]);
                }

                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.catch(() => { });
                }
            });

            hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.error("HLS Network Error", {
                                type: data.type,
                                details: data.details,
                                fatal: data.fatal,
                                responseCode: (data as any).response?.code,
                                url: (data as any).url,
                            });
                            // Avoid tight retry loops
                            setTimeout(() => hls.startLoad(), 500);
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            // Media errors can happen due to codec/buffer issues. Try a few controlled recoveries.
                            hlsMediaErrorCountRef.current += 1;
                            const now = Date.now();
                            const msSinceLast = now - hlsLastRecoveryAtRef.current;

                            console.error("HLS Media Error", {
                                type: data.type,
                                details: data.details,
                                fatal: data.fatal,
                                count: hlsMediaErrorCountRef.current,
                                msSinceLast,
                            });

                            // Rate-limit recoveries
                            if (msSinceLast < 1500) return;
                            hlsLastRecoveryAtRef.current = now;

                            if (hlsMediaErrorCountRef.current <= 2) {
                                hls.recoverMediaError();
                            } else if (hlsMediaErrorCountRef.current <= 4) {
                                // Sometimes swapping codecs helps for some streams.
                                try { hls.swapAudioCodec(); } catch { }
                                hls.recoverMediaError();
                            } else {
                                hls.destroy();
                                setError('HLS Media Error. Try switching quality or using Open / Download.');
                            }
                            break;
                        default:
                            hls.destroy();
                            setError("HLS Fatal Error. Try external player.");
                            break;
                    }
                }
            });

            return () => {
                hls.destroy();
                hlsRef.current = null;
                video.removeEventListener('error', onError);
            };
        } else {
            // Direct playback (MP4, MKV, etc.)
            // Note: browser support for MKV is limited.
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
            video.src = url;
            const playPromise = video.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => { });
            }
            return () => {
                video.removeEventListener('error', onError);
            };
        }
    }, [url, isMounted]);

    const changeStream = async (res?: number, audio?: number | string) => {
        // 0. Internal Quality Switch
        if (useInternalQuality && typeof res === 'number' && hlsRef.current) {
            // -1 => Auto
            hlsRef.current.currentLevel = res;
            setCurrentQuality(res);
            return;
        }

        // 1. Internal Audio Switch
        if (useInternalAudio && typeof audio === 'number' && hlsRef.current) {
            hlsRef.current.audioTrack = audio;
            setCurrentAudio(audio);
            return;
        }

        // 2. Quality or Audio change
        setIsLoading(true);

        try {
            let newUrl: string | null = null;

            // If changing quality and qualities array exists, use the quality URL
            if (res !== undefined && qualities && qualities[res]) {
                newUrl = qualities[res].url;
                setCurrentQuality(res);
            }
            // Otherwise call API for audio change
            else {
                const reqAudio = audio !== undefined ? audio : languageId;
                newUrl = await getStreamUrl(movieId, episodeId, reqAudio);
                if (audio !== undefined) setCurrentAudio(audio);
            }

            if (newUrl) {
                const currentTime = videoRef.current?.currentTime || 0;
                setUrl(newUrl);

                setTimeout(() => {
                    if (videoRef.current) {
                        videoRef.current.currentTime = currentTime;
                        const playPromise = videoRef.current.play();
                        if (playPromise !== undefined) {
                            playPromise.catch(() => { });
                        }
                    }
                }, 500);
            }
        } catch (e) {
            console.error("Failed to switch stream", e);
        } finally {
            setIsLoading(false);
        }
    };

    // Decide which tracks to show and normalize
    const displayAudioTracks = useInternalAudio
        ? internalAudioTracks
        : audioTracks.map(t => ({ id: t.languageId, name: t.name }));

    const displayQualityOptions = useInternalQuality
        ? [{ id: -1, label: 'Auto' }, ...internalQualityLevels]
        : qualities.map((q, idx) => ({ id: idx, label: q.quality }));

    // Add keyboard controls
    useEffect(() => {
        const handleKeyPress = (e: KeyboardEvent) => {
            const video = videoRef.current;
            if (!video) return;

            switch (e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    video.currentTime = Math.max(0, video.currentTime - 10);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    video.currentTime = Math.min(video.duration, video.currentTime + 10);
                    break;
                case ' ':
                    e.preventDefault();
                    if (video.paused) {
                        video.play();
                    } else {
                        video.pause();
                    }
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    video.volume = Math.min(1, video.volume + 0.1);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    video.volume = Math.max(0, video.volume - 0.1);
                    break;
                case 'm':
                case 'M':
                    e.preventDefault();
                    video.muted = !video.muted;
                    break;
                case 'f':
                case 'F':
                    e.preventDefault();
                    if (document.fullscreenElement) {
                        document.exitFullscreen();
                    } else {
                        video.requestFullscreen();
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyPress);
        return () => window.removeEventListener('keydown', handleKeyPress);
    }, [videoRef]);

    const skipTime = (seconds: number) => {
        const video = videoRef.current;
        if (video) {
            video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
        }
    };

    if (!isMounted) {
        return (
            <div className="player-container" style={{ position: 'relative', width: '100%', height: '100%', backgroundColor: '#000', minHeight: '400px' }}>
                {/* Fallback/Loading state */}
            </div>
        );
    }

    return (
        <div className="player-container" style={{ position: 'relative' }}>
            <video
                ref={videoRef}
                controls
                crossOrigin="anonymous"
                poster={poster}
                style={{ width: '100%', height: '100%', backgroundColor: '#000' }}
            >
                {subtitles.map((sub, i) => (
                    <track
                        key={i}
                        kind="subtitles"
                        src={sub.url}
                        srcLang={sub.language}
                        label={sub.title}
                    />
                ))}
            </video>

            {/* Skip Controls */}
            <div style={{
                position: 'absolute',
                bottom: '60px',
                left: '10px',
                zIndex: 10,
                display: 'flex',
                gap: '8px',
                opacity: 0.6,
                transition: 'opacity 0.3s'
            }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '0.6'}
            >
                <button
                    onClick={() => skipTime(-10)}
                    style={{
                        background: 'rgba(0,0,0,0.8)',
                        color: 'white',
                        border: '1px solid #666',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                    }}
                    title="Rewind 10 seconds (Left Arrow)"
                >
                    <span style={{ fontSize: '14px' }}>⏪</span>
                </button>
                <button
                    onClick={() => skipTime(10)}
                    style={{
                        background: 'rgba(0,0,0,0.8)',
                        color: 'white',
                        border: '1px solid #666',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                    }}
                    title="Forward 10 seconds (Right Arrow)"
                >
                    <span style={{ fontSize: '14px' }}>⏩</span>
                </button>
            </div>

            {/* Overlay Controls */}
            <div style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                zIndex: 10,
                display: 'flex',
                gap: '10px'
            }}>
                {displayAudioTracks.length >= 1 && (
                    <select
                        style={{
                            background: 'rgba(0,0,0,0.7)',
                            color: 'white',
                            border: '1px solid #444',
                            padding: '5px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            maxWidth: '120px'
                        }}
                        onChange={(e) => {
                            // If internal (HLS), value is number index. 
                            // If external (API), value is string languageId.
                            const val = e.target.value;
                            const isNum = !isNaN(Number(val));
                            // However, we hardcode empty string for English default?
                            // Audio options: value={t.id}. t.id comes from audioTracks prop.
                            // In cncverse: {languageId: '', name: 'English'}, {languageId: 'hin', ...}
                            // So value is '' or 'hin'.

                            // If useInternalAudio is true, id is index (number).
                            if (useInternalAudio) {
                                changeStream(undefined, Number(val));
                            } else {
                                // External
                                changeStream(undefined, val);
                            }
                        }}
                        disabled={isLoading}
                        value={currentAudio ?? ""}
                    >
                        {displayAudioTracks.map(t => (
                            <option key={t.id} value={t.id}>
                                {t.name}
                            </option>
                        ))}
                    </select>
                )}

                {displayQualityOptions.length > 0 && (
                    <select
                        style={{
                            background: 'rgba(0,0,0,0.7)',
                            color: 'white',
                            border: '1px solid #444',
                            padding: '5px',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                        onChange={(e) => changeStream(Number(e.target.value), undefined)}
                        disabled={isLoading}
                        value={currentQuality !== null ? currentQuality : ""}
                    >
                        <option value="" disabled>Quality</option>
                        {displayQualityOptions.map((q) => (
                            <option key={`${q.id}-${q.label}`} value={q.id}>
                                {q.label}
                            </option>
                        ))}
                    </select>
                )}

                {subtitles.length > 0 && (
                    <select
                        style={{
                            background: 'rgba(0,0,0,0.7)',
                            color: 'white',
                            border: '1px solid #444',
                            padding: '5px',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                        onChange={(e) => {
                            const video = videoRef.current;
                            if (!video) return;

                            // Disable all text tracks first
                            for (let i = 0; i < video.textTracks.length; i++) {
                                video.textTracks[i].mode = 'disabled';
                            }

                            // Enable selected track
                            const idx = Number(e.target.value);
                            if (idx >= 0 && video.textTracks[idx]) {
                                video.textTracks[idx].mode = 'showing';
                            }
                        }}
                    >
                        <option value="-1">Subtitles: Off</option>
                        {subtitles.map((sub, idx) => (
                            <option key={idx} value={idx}>
                                {sub.title}
                            </option>
                        ))}
                    </select>
                )}
            </div>

            {error && (
                <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    color: '#ff6b6b',
                    background: 'rgba(0,0,0,0.8)',
                    padding: '20px',
                    borderRadius: '8px',
                    textAlign: 'center',
                    maxWidth: '80%',
                    zIndex: 20
                }}>
                    <p style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: 'bold' }}>{error}</p>
                    <p style={{ margin: '0', fontSize: '14px', color: '#ccc' }}>
                        The browser cannot play this video. <br />
                        Please use the <b>Open / Download</b> button in the top-left to play it externally (e.g. VLC).
                    </p>
                </div>
            )}

            {isLoading && (
                <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    color: 'white',
                    background: 'rgba(0,0,0,0.6)',
                    padding: '10px',
                    borderRadius: '5px'
                }}>
                    Switching...
                </div>
            )}

            {/* External Player / Download Link */}
            <div style={{
                position: 'absolute',
                top: '10px',
                left: '10px',
                zIndex: 10
            }}>
                <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                        background: 'rgba(0,0,0,0.6)',
                        color: '#fff',
                        textDecoration: 'none',
                        padding: '5px 10px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        border: '1px solid #444'
                    }}
                    title="If video fails (e.g. MKV), click to download or open directly"
                >
                    Open / Download
                </a>
            </div>
        </div>
    );
}
