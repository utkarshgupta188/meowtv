'use client';

import { useRouter } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';

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
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    const handleSelect = (season: number) => {
        setIsOpen(false);
        const firstEp = options.find(o => o.season === season)?.firstEpisodeId;
        const ep = firstEp ?? currentEpisodeId;

        const params = new URLSearchParams();
        params.set('season', String(season));
        if (ep) params.set('ep', ep);

        router.push(`/watch/${showId}?${params.toString()}`);
    };

    if (options.length <= 1) return null;

    return (
        <div className="provider-dropdown" ref={dropdownRef} style={{ marginLeft: '12px' }}>
            <button
                type="button"
                className="provider-dropdown-btn"
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
            >
                Season {selectedSeason}
                <svg
                    xmlns='http://www.w3.org/2000/svg'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='2'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                >
                    <polyline points='6 9 12 15 18 9'></polyline>
                </svg>
            </button>

            <div className={`provider-dropdown-menu ${isOpen ? 'open' : ''}`} style={{ left: 0, right: 'auto', maxHeight: '300px', overflowY: 'auto' }}>
                {options.map(o => (
                    <button
                        key={o.season}
                        type="button"
                        className={`provider-dropdown-item ${selectedSeason === o.season ? 'active' : ''}`}
                        onClick={() => handleSelect(o.season)}
                    >
                        Season {o.season}
                    </button>
                ))}
            </div>
        </div>
    );
}
