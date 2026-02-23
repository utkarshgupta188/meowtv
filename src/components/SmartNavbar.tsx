'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import SearchBar from '@/components/SearchBar';
import ProviderSwitcher from '@/components/ProviderSwitcher';

export default function SmartNavbar() {
    const [isVisible, setIsVisible] = useState(true);
    const [lastScrollY, setLastScrollY] = useState(0);

    useEffect(() => {
        const handleScroll = () => {
            const currentScrollY = window.scrollY;

            // Hide only if we're scrolling down and past the very top
            if (currentScrollY > 50 && currentScrollY > lastScrollY) {
                setIsVisible(false);
            } else {
                setIsVisible(true);
            }

            setLastScrollY(currentScrollY);
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, [lastScrollY]);

    return (
        <header
            className="navbar"
            style={{
                transform: isVisible ? 'translateY(0)' : 'translateY(-100%)',
                transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
        >
            <div className="nav-shell">
                <div className="nav-left">
                    <Link href="/" className="logo">
                        <span className="material-symbols-outlined logo-mark">movie_filter</span>
                        <span className="logo-type">Meow<span>TV</span></span>
                    </Link>
                    <nav style={{ display: 'flex', gap: '12px', alignItems: 'center', marginLeft: '24px' }} className="nav-links">
                        <Link href="/discover" className="btn btn-secondary" style={{ height: '38px', padding: '0 16px', fontSize: '0.875rem', gap: '6px', borderRadius: '10px' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '1.25rem' }}>explore</span> Discover
                        </Link>
                        <Link href="/random" className="btn btn-secondary" style={{ height: '38px', padding: '0 16px', fontSize: '0.875rem', gap: '6px', borderRadius: '10px' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '1.25rem' }}>shuffle</span> Random
                        </Link>
                    </nav>
                </div>

                <div className="nav-right" style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: '16px' }}>
                    <div style={{ flex: 1, maxWidth: '600px' }}>
                        <SearchBar />
                    </div>
                    <ProviderSwitcher />
                </div>
            </div>
        </header>
    );
}
