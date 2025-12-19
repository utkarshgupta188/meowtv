import Link from 'next/link';
import React from 'react';

interface CardProps {
    id: string | number;
    title: string;
    image: string;
    type?: number;
}

export default function Card({ id, title, image }: CardProps) {
    // Fallback image if none provided
    const imageUrl = image || 'https://via.placeholder.com/300x450?text=No+Image';

    return (
        <Link href={`/watch/${id}`} className="card" suppressHydrationWarning>
            <img src={imageUrl} alt={title} loading="lazy" />
            <div className="card-info">
                <div className="card-title">{title}</div>
            </div>
        </Link>
    );
}
