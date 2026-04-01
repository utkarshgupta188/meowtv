'use client';

import Link from 'next/link';
import { useState } from 'react';

interface CardProps {
    id: string | number;
    title: string;
    image: string;
}

export default function Card({ id, title, image }: CardProps) {
    const imageUrl = image || '';
    const safeTitle = title?.trim();
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);

    return (
        <div className="group cursor-pointer scroll-card-wrapper">
            <Link
                href={`/watch/${encodeURIComponent(String(id))}`}
                className="card"
                aria-label={safeTitle || 'Open'}
                style={{ display: 'block' }}
            >
                {/* Shimmer skeleton shown until image loads */}
                {!loaded && !error && (
                    <div
                        className="card-skeleton"
                        style={{
                            position: 'absolute',
                            inset: 0,
                            borderRadius: 'inherit',
                            zIndex: 1,
                        }}
                    />
                )}

                {imageUrl && !error ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={imageUrl}
                        alt={safeTitle || 'Cover'}
                        loading="lazy"
                        decoding="async"
                        onLoad={() => setLoaded(true)}
                        onError={() => setError(true)}
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            display: 'block',
                            opacity: loaded ? 1 : 0,
                            transition: 'opacity 0.3s ease',
                        }}
                    />
                ) : (
                    /* Fallback placeholder */
                    <div
                        style={{
                            width: '100%',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'linear-gradient(135deg, #1a1d2e 0%, #252840 100%)',
                            color: '#4a5568',
                            fontSize: '0.7rem',
                            textAlign: 'center',
                            padding: '8px',
                        }}
                    >
                        <span className="material-symbols-outlined" style={{ fontSize: '2rem', opacity: 0.4 }}>
                            movie
                        </span>
                    </div>
                )}

                {/* Overlay with play button */}
                <div className="card-overlay" aria-hidden="true">
                    <div className="card-overlay-btn">
                        <span className="material-symbols-outlined text-sm">play_arrow</span> Play
                    </div>
                </div>
            </Link>
            {safeTitle ? (
                <div className="card-info">
                    <div className="card-title">{safeTitle}</div>
                </div>
            ) : null}
        </div>
    );
}
