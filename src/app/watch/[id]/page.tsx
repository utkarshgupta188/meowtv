import { fetchDetails, fetchStreamUrl } from '@/lib/api';
import WatchClient from '@/components/WatchClient';
import SeasonSwitcher from '@/components/SeasonSwitcher';
import RecommendationsSection from '@/components/RecommendationsSection';
import { cookies } from 'next/headers';

export default async function WatchPage({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ ep?: string; season?: string }>;
}) {
    const cookieStore = await cookies();
    const providerName = cookieStore.get('provider')?.value;
    const showOpenDownload = providerName !== 'MeowVerse';

    const { id } = await params;
    const decodedId = decodeURIComponent(id);

    // Fetch details
    const details = await fetchDetails(decodedId);

    if (!details) {
        return <div className="container page-pad">Error loading content.</div>;
    }

    // Determine episode to play
    // Check searchParams for 'ep' ID, otherwise default to first available
    const { ep, season } = await searchParams;
    const decodedEp = ep ? decodeURIComponent(ep) : undefined;

    // Group episodes by season
    const episodesBySeason: { [key: number]: typeof details.episodes } = {};
    if (details.episodes) {
        details.episodes.forEach(epItem => {
            const s = epItem.season || 1;
            if (!episodesBySeason[s]) episodesBySeason[s] = [];
            episodesBySeason[s]?.push(epItem);
        });
    }
    Object.keys(episodesBySeason).forEach(k => {
        const num = Number(k);
        episodesBySeason[num]?.sort((a, b) => (a.number - b.number));
    });

    const seasonNumbers = Object.keys(episodesBySeason)
        .map(Number)
        .filter(n => Number.isFinite(n))
        .sort((a, b) => a - b);

    const totalEpisodes = details.episodes?.length ?? 0;
    const showEpisodeUi = seasonNumbers.length > 1 || totalEpisodes > 1;

    const requestedSeason = season ? Number.parseInt(season, 10) : undefined;
    const safeSeason =
        requestedSeason && seasonNumbers.includes(requestedSeason)
            ? requestedSeason
            : undefined;

    const epFromParam = details.episodes?.find(e => e.id === decodedEp);
    const epFromRequestedSeason = safeSeason ? episodesBySeason[safeSeason]?.[0] : undefined;

    // Decide what to play:
    // - If season param is set, we ensure the playing episode belongs to that season (fallback to first in that season)
    // - Otherwise keep existing behavior (ep param or first episode)
    const currentEpisode = safeSeason
        ? (epFromParam && (epFromParam.season || 1) === safeSeason ? epFromParam : epFromRequestedSeason)
        : (epFromParam || details.episodes?.[0]);

    const selectedSeason = safeSeason ?? (currentEpisode?.season || seasonNumbers[0] || 1);

    let videoData = null;
    let languageId: number | undefined;

    if (currentEpisode) {
        // Calculate languageId (Common Logic)
        if (currentEpisode.tracks && currentEpisode.tracks.length > 0) {
            const tracksAny = currentEpisode.tracks as any[];
            const hasIndividualVideo = tracksAny.some(t => t?.existIndividualVideo === true);
            if (hasIndividualVideo) {
                const defaultTrack = tracksAny.find(t => t?.isDefault) || tracksAny[0];
                languageId = defaultTrack?.languageId;
            }
        }

        // Only fetch on server if NOT MeowVerse
        if (providerName !== 'MeowVerse') {
            try {
                // Use sourceMovieId (Season ID) if available, otherwise main ID
                const movieIdToUse = currentEpisode.sourceMovieId || details.id;
                videoData = await fetchStreamUrl(movieIdToUse, currentEpisode.id, languageId);
            } catch (e) {
                console.error(e);
            }
        }
    }



    // Transform API data to Component Props
    // Note: If videoData is null (MeowVerse), these will be empty, but WatchClient will populate/render them later.
    const subtitles = videoData?.subtitles?.map(s => ({
        title: s.label || "Unknown",
        url: s.url,
        language: s.language
    })) || [];

    const audioTracks = videoData?.audioTracks?.map(t => ({
        languageId: t.languageId ?? '',
        name: t.name
    })) || currentEpisode?.tracks?.map(t => ({
        languageId: t.languageId ?? '',
        name: t.name
    })) || [];

    // Helper for props
    const initialData = videoData ? {
        videoUrl: videoData.videoUrl,
        subtitles: subtitles,
        qualities: videoData.qualities,
        audioTracks: audioTracks
    } : null;

    return (
        <div className="container page-pad">
            {/* Pass everything to Client Wrapper */}
            <div className="watch-player-wrapper" style={{ minHeight: '60vh' }}>
                {currentEpisode ? (
                    <script
                        dangerouslySetInnerHTML={{
                            __html: `console.log("Rendering WatchClient for ${providerName}");`
                        }}
                    />
                ) : null}
                {currentEpisode ? (
                    /* We need to import WatchClient. Since page is Server Component, 
                       we can just import it at top and render it. */
                    <WatchClient
                        initialVideoData={initialData}
                        providerName={providerName || 'MeowTV'}
                        movieId={currentEpisode.sourceMovieId || details.id}
                        episodeId={currentEpisode.id}
                        languageId={languageId}
                        poster={currentEpisode?.coverImage || details.coverImage || details.backgroundImage}
                        audioTracks={audioTracks}
                        showOpenDownload={showOpenDownload}
                    />
                ) : (
                    <div className="player-container player-shell player-empty center">
                        <p className="muted">No episode selected.</p>
                    </div>
                )}
            </div>

            <div className="details-container">
                <h1 className="details-title">{details.title}</h1>
                <div className="details-meta">
                    {details.year} • {details.score}
                    {showEpisodeUi && currentEpisode && (
                        <span> • {currentEpisode.title || `Episode ${currentEpisode.number}`}</span>
                    )}
                </div>
                <p>{details.description}</p>

                {showEpisodeUi && seasonNumbers.length > 0 && (
                    <SeasonSwitcher
                        showId={decodedId}
                        selectedSeason={selectedSeason}
                        currentEpisodeId={currentEpisode?.id}
                        options={seasonNumbers.map(s => ({
                            season: s,
                            firstEpisodeId: episodesBySeason[s]?.[0]?.id
                        }))}
                    />
                )}

                {showEpisodeUi && Object.keys(episodesBySeason).length > 0 && (
                    <div className="episode-list">
                        <div>
                            <h3 className="subsection-header">
                                Season {selectedSeason}
                            </h3>
                            <div className="episode-grid">
                                {episodesBySeason[selectedSeason]?.map((epItem, index) => (
                                    <a
                                        key={`${epItem.id}-${index}`}
                                        href={`/watch/${encodeURIComponent(decodedId)}?season=${selectedSeason}&ep=${encodeURIComponent(epItem.id)}`}
                                        className={`episode-item ${epItem.id === currentEpisode?.id ? 'active' : ''}`}
                                    >
                                        <div className="episode-number">Ep {epItem.number}</div>
                                        <div className="episode-title">{epItem.title}</div>
                                    </a>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Recommendations Section */}
            {details.relatedContent && details.relatedContent.length > 0 && (
                <RecommendationsSection items={details.relatedContent} />
            )}
        </div>
    );
}
