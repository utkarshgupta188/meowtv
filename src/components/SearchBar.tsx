'use client';

import { useRouter } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';

export default function SearchBar() {
    const router = useRouter();
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        if (query.trim()) {
            router.push(`/search?q=${encodeURIComponent(query)}`);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        // Stop propagation so spacebar (or other keys) doesn't bubble up to video player controls
        e.stopPropagation();
    };

    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            // Focus the search bar when '/' is pressed, unless we're already typing in an input/textarea
            if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
                e.preventDefault();
                inputRef.current?.focus();
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, []);

    return (
        <form className="search-form" onSubmit={handleSearch} role="search" style={{ position: 'relative', width: '100%' }}>
            <span className="material-symbols-outlined search-icon" aria-hidden="true" style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: '24px' }}>search</span>
            <input
                ref={inputRef}
                type="text"
                className="glass search-input"
                placeholder="Search titles... (Press '/' to focus)"
                aria-label="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                style={{
                    width: '100%',
                    padding: '12px 20px 12px 52px',
                    borderRadius: '9999px',
                    border: '1px solid rgba(255,255,255,0.15)',
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    color: '#fff',
                    outline: 'none',
                    fontSize: '1rem',
                    transition: 'all 0.3s ease',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                }}
            />
        </form>
    );
}
