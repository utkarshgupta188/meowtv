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
    showOpenDownload?: boolean;
}

export default function VideoPlayer({
    initialUrl,
    poster,
    subtitles = [],
    qualities = [],
    audioTracks = [],
    movieId,
    episodeId,
    languageId,
    showOpenDownload = true
}: VideoPlayerProps) {
    console.log('[VideoPlayer] Received:', {
        subtitlesCount: subtitles.length,
        qualitiesCount: qualities.length,
        audioTracksCount: audioTracks.length
    });

    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const plyrRef = useRef<any>(null);
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
        if (!isMounted) return;
        const video = videoRef.current;
        if (!video) return;
        if (plyrRef.current) return;

        let cancelled = false;
        let player: any = null;

        (async () => {
            try {
                const mod = await import('plyr');
                if (cancelled) return;
                const PlyrCtor = (mod as any)?.default ?? (mod as any);
                player = new PlyrCtor(video, {
                    autoplay: false,
                    controls: [
                        'play-large',
                        'play',
                        'progress',
                        'current-time',
                        'duration',
                        'mute',
                        'volume',
                        'captions',
                        'settings',
                        'airplay',
                        'fullscreen'
                    ],
                    tooltips: { controls: true, seek: true },
                    keyboard: { focused: false, global: false },
                    captions: { active: false, update: true },
                });

                plyrRef.current = player;
            } catch (e) {
                console.error('[VideoPlayer] Plyr failed to load', e);
            }
        })();

        return () => {
            cancelled = true;
            if (player) {
                player.destroy();
            }
            plyrRef.current = null;
        };
    }, [isMounted]);

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
                // These are VOD-style streams; low-latency mode can increase buffer/codec edge cases.
                lowLatencyMode: false,
                // Proxied/decrypted sources can be slow, but 60s stalls feel terrible.
                // Use a moderate timeout + retries instead.
                fragLoadingTimeOut: 30000,
                manifestLoadingTimeOut: 30000,
                levelLoadingTimeOut: 30000,
                // Retry transient network stalls/timeouts more patiently.
                fragLoadingMaxRetry: 6,
                fragLoadingRetryDelay: 1000,
                fragLoadingMaxRetryTimeout: 8000,
                levelLoadingMaxRetry: 6,
                levelLoadingRetryDelay: 1000,
                levelLoadingMaxRetryTimeout: 8000,
                manifestLoadingMaxRetry: 3,
                manifestLoadingRetryDelay: 1000,
                xhrSetup: function (xhr) {
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
            });

            hls.on(Hls.Events.ERROR, (event, data) => {
                const decodeUpstreamUrl = (maybeProxyUrl: string | undefined) => {
                    if (!maybeProxyUrl) return null;
                    try {
                        const u = new URL(maybeProxyUrl, window.location.origin);
                        const inner = u.searchParams.get('url');
                        return inner ? decodeURIComponent(inner) : null;
                    } catch {
                        return null;
                    }
                };

                const baseSnapshot = {
                    fatal: Boolean((data as any)?.fatal),
                    type: (data as any)?.type,
                    details: (data as any)?.details,
                    url: (data as any)?.url,
                    fragUrl: (data as any)?.frag?.url,
                    fragUpstreamUrl: decodeUpstreamUrl((data as any)?.frag?.url),
                    error: (data as any)?.error?.message ?? String((data as any)?.error ?? ''),
                    reason: (data as any)?.reason,
                    responseCode: (data as any)?.response?.code,
                    fragSn: (data as any)?.frag?.sn,
                    level: (data as any)?.level,
                    parent: (data as any)?.parent,
                };

                // Always print a JSON snapshot too, because DevTools sometimes renders objects as `{}`.
                // (e.g. when properties are non-enumerable/getters or get stripped in some builds)
                const isFragTimeout =
                    (data as any)?.type === Hls.ErrorTypes.NETWORK_ERROR &&
                    (data as any)?.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT;

                if (isFragTimeout && !(data as any)?.fatal) {
                    // This is common with slow proxy/decrypt hops; avoid spamming console as an "error".
                    console.warn('HLS Fragment Timeout', baseSnapshot);
                } else if ((data as any)?.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    console.error('HLS Media Error', baseSnapshot);
                    console.error('HLS Media Error JSON', JSON.stringify(baseSnapshot));
                } else if ((data as any)?.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    console.error('HLS Network Error', baseSnapshot);
                    console.error('HLS Network Error JSON', JSON.stringify(baseSnapshot));
                } else {
                    console.error('HLS Error', baseSnapshot);
                    console.error('HLS Error JSON', JSON.stringify(baseSnapshot));
                }

                if ((data as any)?.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            // Avoid tight retry loops
                            setTimeout(() => hls.startLoad(), 500);
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            // Media errors can happen due to codec/buffer issues. Try a few controlled recoveries.
                            hlsMediaErrorCountRef.current += 1;
                            const now = Date.now();
                            const msSinceLast = now - hlsLastRecoveryAtRef.current;

                            console.error('HLS Media Error recovery', {
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
                                setError(showOpenDownload
                                    ? 'HLS Media Error. Try switching quality or using Open / Download.'
                                    : 'HLS Media Error. Try switching quality or changing audio.');
                            }
                            break;
                        default:
                            hls.destroy();
                            setError(showOpenDownload
                                ? 'HLS Fatal Error. Try external player (Open / Download).'
                                : 'HLS Fatal Error. This stream may be unsupported in-browser.');
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

    useEffect(() => {
        // Default audio selection to first option when not provided
        if (currentAudio === undefined && displayAudioTracks.length > 0) {
            setCurrentAudio(displayAudioTracks[0].id);
        }
        // Default quality selection to first external option (matches our defaultSource)
        if (!useInternalQuality && currentQuality === null && displayQualityOptions.length > 0) {
            setCurrentQuality(displayQualityOptions[0].id);
        }
    }, [currentAudio, currentQuality, displayAudioTracks, displayQualityOptions, useInternalQuality]);

    const toggleFullscreen = async () => {
        const plyr = plyrRef.current;
        // Prefer Plyr's fullscreen handling so its controls remain visible.
        if (plyr?.fullscreen?.enabled) {
            plyr.fullscreen.toggle();
            return;
        }

        if (document.fullscreenElement) {
            await document.exitFullscreen();
            return;
        }

        const container = containerRef.current;
        if (container?.requestFullscreen) {
            await container.requestFullscreen();
            return;
        }

        const video = videoRef.current as any;
        if (video?.requestFullscreen) {
            await video.requestFullscreen();
            return;
        }

        // iOS Safari fallback
        if (video?.webkitEnterFullscreen) {
            video.webkitEnterFullscreen();
        }
    };

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
                    void toggleFullscreen();
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
            <div className="player-container player-shell" ref={containerRef}>
                {/* Fallback/Loading state */}
            </div>
        );
    }

    return (
        <div className="player-container player-shell" ref={containerRef}>
            <video
                ref={videoRef}
                crossOrigin="anonymous"
                playsInline
                poster={poster}
                className="player-video"
            >
                {subtitles.map((sub, i) => (
                    <track
                        key={i}
                        kind="captions"
                        src={sub.url}
                        srcLang={sub.language}
                        label={sub.title}
                    />
                ))}
            </video>

            {/* Top HUD (modern control bar) */}
            <div className="player-hud">
                <div className="player-hud-group">
                    <div className="player-hud-panel">
                        {showOpenDownload && (
                            <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="player-action"
                                title="If video fails (e.g. MKV), click to download or open directly"
                            >
                                Open / Download
                            </a>
                        )}
                    </div>
                </div>

                <div className="player-hud-group">
                    <div className="player-hud-panel">
                        <div className="player-overlay-controls">
                            {displayAudioTracks.length > 1 && (
                                <select
                                    className="select select--overlay"
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (useInternalAudio) {
                                            changeStream(undefined, Number(val));
                                        } else {
                                            changeStream(undefined, val);
                                        }
                                    }}
                                    disabled={isLoading}
                                    value={currentAudio ?? ""}
                                    aria-label="Audio"
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
                                    className="select select--overlay"
                                    onChange={(e) => changeStream(Number(e.target.value), undefined)}
                                    disabled={isLoading}
                                    value={currentQuality !== null ? currentQuality : ""}
                                    aria-label="Quality"
                                >
                                    <option value="" disabled>
                                        Quality
                                    </option>
                                    {displayQualityOptions.map((q) => (
                                        <option key={`${q.id}-${q.label}`} value={q.id}>
                                            {q.label}
                                        </option>
                                    ))}
                                </select>
                            )}

                            {subtitles.length > 0 && (
                                <select
                                    className="select select--overlay"
                                    onChange={(e) => {
                                        const video = videoRef.current;
                                        if (!video) return;

                                        const plyrAny = plyrRef.current as any;

                                        for (let i = 0; i < video.textTracks.length; i++) {
                                            video.textTracks[i].mode = 'disabled';
                                        }

                                        const idx = Number(e.target.value);
                                        if (idx >= 0 && subtitles[idx]) {
                                            const target = subtitles[idx];

                                            // Track order can differ from DOM order; try to match by label/language.
                                            let matchIndex = -1;
                                            for (let i = 0; i < video.textTracks.length; i++) {
                                                const tt = video.textTracks[i];
                                                if (tt.label && tt.label === target.title) {
                                                    matchIndex = i;
                                                    break;
                                                }
                                                if (tt.language && target.language && tt.language === target.language) {
                                                    matchIndex = i;
                                                }
                                            }

                                            // Fallback: assume DOM track order matches subtitles[] order.
                                            if (matchIndex < 0 && idx < video.textTracks.length) {
                                                matchIndex = idx;
                                            }

                                            if (matchIndex >= 0 && video.textTracks[matchIndex]) {
                                                video.textTracks[matchIndex].mode = 'showing';
                                                // Plyr manages captions internally; ensure we update its selected track.
                                                try { plyrAny.currentTrack = matchIndex; } catch { }
                                                try { plyrAny?.toggleCaptions?.(true); } catch { }
                                            } else {
                                                try { plyrAny.currentTrack = -1; } catch { }
                                                try { plyrAny?.toggleCaptions?.(false); } catch { }
                                            }
                                        } else {
                                            try { plyrAny.currentTrack = -1; } catch { }
                                            try { plyrAny?.toggleCaptions?.(false); } catch { }
                                        }
                                    }}
                                    aria-label="Subtitles"
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
                    </div>
                </div>
            </div>

            {error && (
                <div className="player-center-badge">
                    <p className="title">{error}</p>
                    <p className="hint">
                        The browser cannot play this video. <br />
                        Please use the <b>Open / Download</b> button in the top-left to play it externally (e.g. VLC).
                    </p>
                </div>
            )}

            {isLoading && (
                <div className="player-center-badge">
                    Switching...
                </div>
            )}

        </div>
    );
}
