'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SearchBar from '@/components/SearchBar';
import ProviderSwitcher from '@/components/ProviderSwitcher';

export default function SmartNavbar() {
    const pathname = usePathname();
    const isWatchPage = pathname?.startsWith('/watch/');

    useEffect(() => {
        if (isWatchPage) {
            document.documentElement.style.setProperty('--nav-height', '0px');
        } else {
            document.documentElement.style.removeProperty('--nav-height');
        }
    }, [isWatchPage]);

    const [isVisible, setIsVisible] = useState(true);
    const [isManuallyHidden, setIsManuallyHidden] = useState(false);
    const lastScrollYRef = React.useRef(0);

    useEffect(() => {
        const handleScroll = () => {
            if (isManuallyHidden) return; // Do not overwrite manual hide state
            
            requestAnimationFrame(() => {
                const currentScrollY = window.scrollY;

                // Hide only if we're scrolling down and past the very top
                if (currentScrollY > 50 && currentScrollY > lastScrollYRef.current) {
                    setIsVisible(false);
                } else {
                    setIsVisible(true);
                }

                lastScrollYRef.current = currentScrollY;
            });
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, [isManuallyHidden]);

    useEffect(() => {
        const handleManualToggle = (e: Event) => {
            const customEvent = e as CustomEvent<{ hidden: boolean }>;
            const hidden = customEvent.detail.hidden;
            setIsManuallyHidden(hidden);
            if (hidden) {
                setIsVisible(false);
            } else {
                setIsVisible(true);
            }
        };

        window.addEventListener('manualNavToggle', handleManualToggle);
        return () => window.removeEventListener('manualNavToggle', handleManualToggle);
    }, []);

    if (isWatchPage) return null;

    return (
        <header
            className="navbar"
            style={{
                transform: isVisible ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(calc(-100% - 40px))',
                transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
        >
            <div className="nav-shell">
                <div className="nav-left">
                    <Link href="/" className="logo">
                        <span className="material-symbols-outlined logo-mark">movie_filter</span>
                        <span className="logo-type">MEOW<span>TV</span></span>
                    </Link>
                    <nav className="nav-links">
                        <Link href="/discover" className="btn btn-secondary" style={{ height: '38px', padding: '0 16px', fontSize: '0.875rem', gap: '6px', borderRadius: '10px' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '1.25rem' }}>explore</span> Discover
                        </Link>
                        <Link href="/random" className="btn btn-secondary" style={{ height: '38px', padding: '0 16px', fontSize: '0.875rem', gap: '6px', borderRadius: '10px' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '1.25rem' }}>shuffle</span> Random
                        </Link>
                    </nav>
                </div>

                <div className="nav-right">
                    <div className="nav-search-row">
                        <SearchBar />
                        <ProviderSwitcher />
                    </div>
                </div>
            </div>
        </header>
    );
}
