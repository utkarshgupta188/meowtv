'use client';

import { useEffect, useRef, useState } from 'react';
import '@vidstack/react/player/styles/default/theme.css';
import '@vidstack/react/player/styles/default/layouts/video.css';
import {
    MediaPlayer,
    MediaProvider,
    Track,
    isHLSProvider,
    useMediaState,
    type MediaPlayerInstance,
    type MediaProviderAdapter
} from '@vidstack/react';
import { defaultLayoutIcons, DefaultVideoLayout } from '@vidstack/react/player/layouts/default';
import Hls from 'hls.js';
import { getStreamUrl } from '@/app/actions';
import type { Quality } from '@/lib/providers/types';

export interface VideoPlayerProps {
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

const SEEK_SECONDS = 10;

// Seek overlay: double-tap zones + always-visible side buttons
function SeekOverlay({ playerRef }: { playerRef: React.RefObject<MediaPlayerInstance | null> }) {
    const isControlsVisible = useMediaState('controlsVisible', playerRef);
    const [feedback, setFeedback] = useState<'left' | 'right' | null>(null);
    const lastTapRef = useRef<{ side: 'left' | 'right'; time: number } | null>(null);
    const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const seek = (direction: 'left' | 'right') => {
        const player = playerRef.current;
        if (!player) return;
        const delta = direction === 'right' ? SEEK_SECONDS : -SEEK_SECONDS;
        player.currentTime = Math.max(0, Math.min(player.currentTime + delta, player.duration || 0));
        setFeedback(direction);
        if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
        feedbackTimer.current = setTimeout(() => setFeedback(null), 700);
    };

    const handleTap = (side: 'left' | 'right') => {
        const now = Date.now();
        const last = lastTapRef.current;
        if (last && last.side === side && now - last.time < 300) {
            // Double tap
            lastTapRef.current = null;
            seek(side);
        } else {
            lastTapRef.current = { side, time: now };
        }
    };

    return (
        <div
            style={{
                position: 'absolute',
                top: 44,    /* leave room for Vidstack top bar (CC, settings) */
                bottom: 52, /* leave room for Vidstack bottom bar (progress, fullscreen) */
                left: 0,
                right: 0,
                zIndex: 10,
                display: 'flex',
                pointerEvents: 'none',
            }}
        >
            {/* Left zone */}
            <div
                className="seek-zone seek-zone--left"
                style={{ pointerEvents: 'auto' }}
                onClick={() => handleTap('left')}
                aria-label="Seek backward 10 seconds"
            >
                {/* Visible seek button */}
                <button
                    className="seek-btn"
                    style={{ opacity: isControlsVisible ? 1 : 0 }}
                    onClick={(e) => { e.stopPropagation(); seek('left'); }}
                    aria-label="-10s"
                >
                    <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
                        <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
                    </svg>
                    <span>10</span>
                </button>
                {/* Ripple feedback */}
                {feedback === 'left' && (
                    <div className="seek-ripple seek-ripple--left" key={Date.now()}>
                        <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                            <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
                        </svg>
                        <span>-{SEEK_SECONDS}s</span>
                    </div>
                )}
            </div>

            {/* Middle passthrough */}
            <div style={{ flex: 1 }} />

            {/* Right zone */}
            <div
                className="seek-zone seek-zone--right"
                style={{ pointerEvents: 'auto' }}
                onClick={() => handleTap('right')}
                aria-label="Seek forward 10 seconds"
            >
                {/* Visible seek button */}
                <button
                    className="seek-btn"
                    style={{ opacity: isControlsVisible ? 1 : 0 }}
                    onClick={(e) => { e.stopPropagation(); seek('right'); }}
                    aria-label="+10s"
                >
                    <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
                        <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z" />
                    </svg>
                    <span>10</span>
                </button>
                {/* Ripple feedback */}
                {feedback === 'right' && (
                    <div className="seek-ripple seek-ripple--right" key={Date.now()}>
                        <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                            <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z" />
                        </svg>
                        <span>+{SEEK_SECONDS}s</span>
                    </div>
                )}
            </div>
        </div>
    );
}

// A component to render the Open/Download button that fades with Vidstack controls
function CustomOverlayHUD({
    playerRef,
    url,
    showOpenDownload,
}: {
    playerRef: React.RefObject<MediaPlayerInstance | null>;
    url: string;
    showOpenDownload: boolean;
}) {
    const isControlsVisible = useMediaState('controlsVisible', playerRef);

    if (!showOpenDownload) {
        return null;
    }

    return (
        <div
            className="player-hud"
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                zIndex: 50,
                pointerEvents: 'none',  /* NEVER block clicks on the container */
            }}
        >
            <div
                className="player-hud-group"
                style={{
                    opacity: isControlsVisible ? 1 : 0,
                    transition: 'opacity 0.2s ease',
                    pointerEvents: isControlsVisible ? 'auto' : 'none',
                }}
            >
                <div className="player-hud-panel">
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="player-action"
                        title="If video fails (e.g. MKV), click to download or open directly"
                    >
                        Open / Download
                    </a>
                </div>
            </div>
        </div>
    );
}

// Native-style audio track submenu (renamed to Language to avoid conflict with Vidstack Audio menu)
function AudioMenuSection({
    audioTracks,
    nativeAudioTracks,
    currentAudio,
    currentNativeAudio,
    isLoading,
    changeExternalStream,
    switchNativeAudio
}: {
    audioTracks: { languageId: number | string; name: string }[];
    nativeAudioTracks: { id: number; label: string }[];
    currentAudio: number | string | undefined;
    currentNativeAudio: number;
    isLoading: boolean;
    changeExternalStream: (res?: number, audio?: number | string) => void;
    switchNativeAudio: (index: number) => void;
}) {
    const [open, setOpen] = useState(false);
    
    // Total tracks to show
    const hasNative = nativeAudioTracks.length > 1;
    const hasServer = audioTracks.length > 0;

    if (!hasNative && !hasServer && audioTracks.length === 0) return null;

    const activeLabel = hasNative 
        ? nativeAudioTracks[currentNativeAudio]?.label || 'Default'
        : audioTracks.find(t => String(t.languageId) === String(currentAudio))?.name ?? 'Default';

    if (open) {
        return (
            <div className="vds-quality-submenu">
                <button
                    className="vds-quality-back-btn"
                    onClick={() => setOpen(false)}
                    aria-label="Back to settings"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                    Language
                </button>
                <div className="vds-quality-options">
                    {/* Native Tracks (Inside the file) */}
                    {hasNative && (
                        <>
                            <div className="vds-quality-group-label">Embedded Tracks</div>
                            {nativeAudioTracks.map((t) => (
                                <button
                                    key={`native-${t.id}`}
                                    className={`vds-quality-option${currentNativeAudio === t.id ? ' vds-quality-option--active' : ''}`}
                                    onClick={() => { switchNativeAudio(t.id); setOpen(false); }}
                                >
                                    <span className="vds-quality-check">
                                        {currentNativeAudio === t.id && (
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12" />
                                            </svg>
                                        )}
                                    </span>
                                    {t.label}
                                </button>
                            ))}
                            <div style={{ height: 8 }} />
                        </>
                    )}

                    {/* Server Tracks (Switching URL) */}
                    {hasServer && (
                        <>
                            {hasNative && <div className="vds-quality-group-label">Server Versions</div>}
                            {audioTracks.map((t) => (
                                <button
                                    key={`a-${t.languageId}`}
                                    className={`vds-quality-option${String(currentAudio) === String(t.languageId) ? ' vds-quality-option--active' : ''}`}
                                    onClick={() => { if (!isLoading) { changeExternalStream(undefined, t.languageId); setOpen(false); } }}
                                    disabled={isLoading}
                                >
                                    <span className="vds-quality-check">
                                        {String(currentAudio) === String(t.languageId) && (
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12" />
                                            </svg>
                                        )}
                                    </span>
                                    {t.name}
                                </button>
                            ))}
                        </>
                    )}
                </div>
            </div>
        );
    }

    return (
        <button
            className="vds-quality-menu-btn"
            onClick={() => setOpen(true)}
        >
            <span className="vds-quality-menu-label">Language</span>
            <span className="vds-quality-menu-hint">
                {activeLabel}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            </span>
        </button>
    );
}

// Native-style quality submenu for the Vidstack settings panel
function QualityMenuSection({
    qualities,
    currentQuality,
    isLoading,
    changeExternalStream
}: {
    qualities: { id: number; label: string }[];
    currentQuality: number | null;
    isLoading: boolean;
    changeExternalStream: (res?: number, audio?: number | string) => void;
}) {
    const [open, setOpen] = useState(false);
    if (qualities.length <= 1) return null;

    const activeLabel = currentQuality !== null
        ? qualities.find(q => q.id === currentQuality)?.label ?? 'Auto'
        : qualities[0]?.label ?? 'Auto';

    if (open) {
        return (
            <div className="vds-quality-submenu">
                <button
                    className="vds-quality-back-btn"
                    onClick={() => setOpen(false)}
                    aria-label="Back to settings"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                    Quality
                </button>
                <div className="vds-quality-options">
                    {qualities.map((q) => (
                        <button
                            key={`q-${q.id}-${q.label}`}
                            className={`vds-quality-option${currentQuality === q.id ? ' vds-quality-option--active' : ''}`}
                            onClick={() => { if (!isLoading) { changeExternalStream(q.id, undefined); setOpen(false); } }}
                            disabled={isLoading}
                        >
                            <span className="vds-quality-check">
                                {currentQuality === q.id && (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                )}
                            </span>
                            {q.label}
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <button
            className="vds-quality-menu-btn"
            onClick={() => setOpen(true)}
        >
            <span className="vds-quality-menu-label">Quality</span>
            <span className="vds-quality-menu-hint">
                {activeLabel}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            </span>
        </button>
    );
}

export default function VideoPlayer({
    initialUrl,
    poster,
    subtitles = [],
    qualities = [],
    audioTracks: providerAudioTracks = [],
    movieId,
    episodeId,
    languageId,
    showOpenDownload = true
}: VideoPlayerProps) {
    const playerRef = useRef<MediaPlayerInstance>(null);
    const [url, setUrl] = useState(initialUrl);
    const [resolvedUrl, setResolvedUrl] = useState(initialUrl);
    const [currentQuality, setCurrentQuality] = useState<number | null>(null);
    const [currentAudio, setCurrentAudio] = useState<number | string | undefined>(languageId);
    const [nativeAudioTracks, setNativeAudioTracks] = useState<{ id: number; label: string }[]>([]);
    const [currentNativeAudio, setCurrentNativeAudio] = useState<number>(0);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // HLS Recovery State
    const hlsMediaErrorCountRef = useRef(0);
    const hlsLastRecoveryAtRef = useRef(0);

    const scoreQualityLabel = (label: string): number => {
        const s = String(label || '').toLowerCase();
        const pMatch = s.match(/(\d{3,4})\s*p/);
        if (pMatch?.[1]) return Number.parseInt(pMatch[1], 10);
        const kbpsMatch = s.match(/(\d{2,6})\s*kbps/);
        if (kbpsMatch?.[1]) return Number.parseInt(kbpsMatch[1], 10) / 1000;

        if (s.includes('uhd') || s.includes('4k')) return 2160;
        if (s.includes('fhd') || s.includes('1080')) return 1080;
        if (s.includes('hd') || s.includes('720')) return 720;
        if (s.includes('sd') || s.includes('480')) return 480;
        if (s.includes('basic') || s.includes('low') || s.includes('360')) return 360;
        return 0;
    };

    const sortedQualities = (() => {
        if (!qualities?.length) return [];
        return [...qualities]
            .filter((q) => q?.url)
            .sort((a, b) => scoreQualityLabel(b.quality) - scoreQualityLabel(a.quality));
    })();

    // Default quality selection for external qualities
    useEffect(() => {
        if (currentQuality === null && sortedQualities.length > 0) {
            setCurrentQuality(0);
            if (sortedQualities[0]?.url) {
                setUrl(sortedQualities[0].url);
            }
        }
    }, [currentQuality, sortedQualities]);

    // Reset state on new episode
    useEffect(() => {
        setUrl(initialUrl);
        setCurrentAudio(languageId);
        setCurrentQuality(null);
        hlsMediaErrorCountRef.current = 0;
        hlsLastRecoveryAtRef.current = 0;
        setError(null);
    }, [initialUrl, languageId]);

    // Handle blob: prefix for client-side playlist fetching
    useEffect(() => {
        let cleanupBlobUrl: string | null = null;
        let isCancelled = false;

        // VLC-style Deep Track Scanner
        const video = playerRef.current?.el?.querySelector('video') as any;
        if (video) {
            const handleTracks = () => {
                const nativeTracks: any[] = Array.from(video.audioTracks || []);
                if (nativeTracks.length > 0) {
                    setNativeAudioTracks(nativeTracks.map((t, i) => {
                        let label = t.label || t.language;
                        // Use VLC-observed mapping if labels are missing
                        if (!label || label === 'und' || label === 'Default') {
                            if (i === 0) label = 'Hindi';
                            else if (i === 1) label = 'English';
                            else label = `Track ${i + 1}`;
                        }
                        return { id: i, label };
                    }));
                    const activeIdx = nativeTracks.findIndex(t => t.enabled);
                    if (activeIdx !== -1) setCurrentNativeAudio(activeIdx);
                    console.log('[VideoPlayer] VLC Mode: Detected tracks', nativeTracks.length);
                }
                if (video.textTracks && video.textTracks.length > 0) {
                    for (let i = 0; i < video.textTracks.length; i++) {
                        video.textTracks[i].mode = i === 0 ? 'showing' : 'disabled';
                    }
                }
            };

            video.addEventListener('loadedmetadata', handleTracks);
            video.addEventListener('canplay', handleTracks);
            
            // Force a re-scan after a short delay (VLC-style poke)
            const poke = setInterval(() => {
                if (video.audioTracks && video.audioTracks.length > 1) {
                    handleTracks();
                    clearInterval(poke);
                }
            }, 2000);

            setTimeout(() => clearInterval(poke), 10000); // Stop after 10s
        }

        const setupUrl = async () => {
            const [baseUrl, hash] = url.split('#');
            const trackMatch = hash?.match(/audio=(\d+)/);
            const targetTrack = trackMatch ? parseInt(trackMatch[1]) : null;

            if (baseUrl.startsWith('blob:') && baseUrl.length > 5) {
                const actualUrl = baseUrl.slice('blob:'.length);
                try {
                    const response = await fetch(actualUrl);
                    const playlistText = await response.text();
                    if (isCancelled) return;
                    const blob = new Blob([playlistText], { type: 'application/vnd.apple.mpegurl' });
                    const blobUrl = URL.createObjectURL(blob);
                    cleanupBlobUrl = blobUrl;
                    setResolvedUrl(blobUrl);
                } catch (err) {
                    console.error('[VideoPlayer] Failed to fetch playlist:', err);
                    setError('Failed to load playlist');
                }
            } else {
                setResolvedUrl(baseUrl);
            }

            // Sync native track if marker present
            if (targetTrack !== null && video) {
                const syncTrack = () => {
                    if (video.audioTracks) {
                        const actualIdx = targetTrack < video.audioTracks.length ? targetTrack : 0;
                        for (let i = 0; i < video.audioTracks.length; i++) {
                            video.audioTracks[i].enabled = (i === actualIdx);
                        }
                        setCurrentNativeAudio(actualIdx);
                    }
                };
                if (video.readyState >= 1) syncTrack();
                video.addEventListener('loadedmetadata', syncTrack, { once: true });
            }
        };

        setupUrl();

        return () => {
            isCancelled = true;
            if (cleanupBlobUrl) URL.revokeObjectURL(cleanupBlobUrl);
        };
    }, [url]);

    const changeExternalStream = async (res?: number, audio?: number | string) => {
        setIsLoading(true);
        try {
            let newUrl: string | null = null;

            if (res !== undefined && sortedQualities[res]) {
                newUrl = sortedQualities[res].url;
                setCurrentQuality(res);
            } else {
                const reqAudio = audio !== undefined ? audio : languageId;
                newUrl = await getStreamUrl(movieId, episodeId, reqAudio);
                if (audio !== undefined) setCurrentAudio(audio);
            }

            if (newUrl) {
                const player = playerRef.current;
                const currentTime = player?.currentTime || 0;
                
                // Append audio track index as a hash if provided
                const audioHash = audio !== undefined ? `#audio=${audio}` : '';
                setUrl(newUrl + audioHash);

                // Wait for can-play event to restore time and play
                if (player) {
                    const onCanPlay = () => {
                        player.currentTime = currentTime;
                        player.play();
                        player.el?.removeEventListener('can-play', onCanPlay);
                    };
                    player.el?.addEventListener('can-play', onCanPlay);
                }
            }
        } catch (e) {
            console.error("Failed to switch stream", e);
        } finally {
            setIsLoading(false);
        }
    };

    const switchNativeAudio = (index: number) => {
        const video = playerRef.current?.el?.querySelector('video') as any;
        if (video && video.audioTracks) {
            for (let i = 0; i < video.audioTracks.length; i++) {
                video.audioTracks[i].enabled = (i === index);
            }
            setCurrentNativeAudio(index);
            console.log('[VideoPlayer] Switched native audio track to:', index);
        }
    };

    function onProviderChange(provider: MediaProviderAdapter | null) {
        if (isHLSProvider(provider)) {
            provider.config = {
                enableWorker: true,
                lowLatencyMode: false,
                fragLoadingTimeOut: 20000,
                maxBufferLength: 60,
                maxMaxBufferLength: 120,
                maxBufferSize: 100 * 1000 * 1000,
                maxBufferHole: 0.5,
                backBufferLength: 10,
                frontBufferFlushThreshold: 600,
                startFragPrefetch: true,
                testBandwidth: true,
                startLevel: -1,
                liveSyncDurationCount: 1,
                liveMaxLatencyDurationCount: 3,
                maxFragLookUpTolerance: 0.1,
                progressive: true,
                xhrSetup: function (xhr) {
                    xhr.withCredentials = false;
                }
            };
        }
    }

    function onProviderSetup(provider: MediaProviderAdapter) {
        if (isHLSProvider(provider)) {
            const hls = provider.instance;
            if (!hls) return;
            hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            setTimeout(() => hls.startLoad(), 500);
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            hlsMediaErrorCountRef.current += 1;
                            const now = Date.now();
                            const msSinceLast = now - hlsLastRecoveryAtRef.current;
                            if (msSinceLast < 1500) return;
                            hlsLastRecoveryAtRef.current = now;

                            if (hlsMediaErrorCountRef.current <= 2) {
                                hls.recoverMediaError();
                            } else if (hlsMediaErrorCountRef.current <= 4) {
                                try { hls.swapAudioCodec(); } catch { }
                                hls.recoverMediaError();
                            } else {
                                setError(showOpenDownload
                                    ? 'HLS Media Error. Try switching quality or using Open / Download.'
                                    : 'HLS Media Error. Try switching quality or changing audio.');
                            }
                            break;
                        default:
                            setError(showOpenDownload
                                ? 'HLS Fatal Error. Try external player (Open / Download).'
                                : 'HLS Fatal Error. This stream may be unsupported in-browser.');
                            break;
                    }
                }
            });
        }
    }

    const getSourceType = (srcUrl: string) => {
        if (srcUrl.includes('.m3u8') || srcUrl.includes('/api/hls?') || srcUrl.startsWith('blob:') || url.startsWith('blob:')) {
            return 'application/x-mpegurl';
        }
        return 'video/mp4';
    };

    const externalAudioTracks = providerAudioTracks.map(t => ({ id: t.languageId, name: t.name }));
    const externalQualityOptions = sortedQualities.map((q, idx) => ({ id: idx, label: q.quality }));

    return (
        <div className="player-container player-shell">
            <MediaPlayer
                ref={playerRef}
                src={{ src: resolvedUrl, type: getSourceType(resolvedUrl) }}
                crossOrigin
                playsInline
                poster={poster}
                onProviderChange={onProviderChange}
                onProviderSetup={onProviderSetup}
                onError={(err) => setError(err.message)}
                onPlaying={() => setError(null)}
                onCanPlay={() => setError(null)}
            >
                <MediaProvider>
                    {subtitles.map((sub, i) => (
                        <Track
                            key={String(i)}
                            src={sub.url}
                            kind="subtitles"
                            label={sub.title}
                            lang={sub.language || 'en'}
                            default={i === 0}
                        />
                    ))}
                </MediaProvider>

                <SeekOverlay playerRef={playerRef} />

                <CustomOverlayHUD
                    playerRef={playerRef}
                    url={url}
                    showOpenDownload={showOpenDownload}
                />

                <DefaultVideoLayout
                    icons={defaultLayoutIcons}
                    slots={{
                        settingsMenuItemsEnd: (
                            <>
                                <AudioMenuSection
                                    audioTracks={providerAudioTracks}
                                    nativeAudioTracks={nativeAudioTracks}
                                    currentAudio={currentAudio}
                                    currentNativeAudio={currentNativeAudio}
                                    isLoading={isLoading}
                                    changeExternalStream={changeExternalStream}
                                    switchNativeAudio={switchNativeAudio}
                                />
                                <QualityMenuSection
                                    qualities={externalQualityOptions}
                                    currentQuality={currentQuality}
                                    isLoading={isLoading}
                                    changeExternalStream={changeExternalStream}
                                />
                            </>
                        )
                    }}
                />

                {/* Error overlay removed per user request */}

                {isLoading && (
                    <div className="player-center-badge">
                        Switching...
                    </div>
                )}
            </MediaPlayer>
        </div>
    );
}
