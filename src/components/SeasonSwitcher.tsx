'use client';

import { useRouter } from 'next/navigation';

export type SeasonOption = {
    season: number;
    firstEpisodeId?: string;
};

export default function SeasonSwitcher({
    showId,
    options,
    selectedSeason,
    currentEpisodeId,
}: {
    showId: string;
    options: SeasonOption[];
    selectedSeason: number;
    currentEpisodeId?: string;
}) {
    const router = useRouter();

    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const season = Number(e.target.value);
        const firstEp = options.find(o => o.season === season)?.firstEpisodeId;
        const ep = firstEp ?? currentEpisodeId;

        const params = new URLSearchParams();
        params.set('season', String(season));
        if (ep) params.set('ep', ep);

        router.push(`/watch/${showId}?${params.toString()}`);
    };

    if (options.length <= 1) return null;

    return (
        <div style={{ marginTop: '16px', marginBottom: '10px', display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div style={{ color: '#ccc', fontSize: '14px' }}>Season</div>
            <select
                value={selectedSeason}
                onChange={handleChange}
                style={{
                    background: '#333',
                    color: 'white',
                    padding: '5px 10px',
                    borderRadius: '4px',
                    border: '1px solid #555',
                    outline: 'none',
                    cursor: 'pointer'
                }}
            >
                {options.map(o => (
                    <option key={o.season} value={o.season}>
                        Season {o.season}
                    </option>
                ))}
            </select>
        </div>
    );
}
