import Link from 'next/link';

interface CardProps {
    id: string | number;
    title: string;
    image: string;
}

export default function Card({ id, title, image }: CardProps) {
    // Fallback image if none provided
    const imageUrl = image || 'https://via.placeholder.com/300x450?text=No+Image';
    const safeTitle = title?.trim();

    return (
        <div className="group cursor-pointer scroll-card-wrapper">
            <Link
                href={`/watch/${encodeURIComponent(String(id))}`}
                className="card"
                aria-label={safeTitle || 'Open'}
                style={{ display: 'block' }}
            >
                <img src={imageUrl} alt={title} loading="lazy" />

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
