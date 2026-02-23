'use client';

import { useState, useEffect, useRef } from 'react';
import { setProviderAction, getProviderNameAction } from '@/lib/api';

const PROVIDERS = ['MeowTV', 'MeowVerse', 'MeowToon'];

export default function ProviderSwitcher() {
    const [provider, setProvider] = useState<string>('MeowTV');
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        getProviderNameAction().then(setProvider);
    }, []);

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

    const handleSelect = async (newProvider: string) => {
        setProvider(newProvider);
        setIsOpen(false);
        await setProviderAction(newProvider);

        // Hard navigation so server components pick up the new cookie immediately.
        window.location.assign('/');
    };

    return (
        <div className="provider-dropdown" ref={dropdownRef}>
            <button
                type="button"
                className="provider-dropdown-btn glass"
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
            >
                {provider}
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

            <div className={`provider-dropdown-menu glass-dark ${isOpen ? 'open' : ''}`}>
                {PROVIDERS.map((p) => (
                    <button
                        key={p}
                        type="button"
                        className={`provider-dropdown-item ${provider === p ? 'active' : ''}`}
                        onClick={() => handleSelect(p)}
                    >
                        {p}
                    </button>
                ))}
            </div>
        </div>
    );
}
