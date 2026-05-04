'use client';

import { useRouter } from 'next/navigation';

export default function BackButton() {
    const router = useRouter();

    return (
        <button 
            onClick={() => router.back()} 
            className="player-action"
            style={{ 
                width: '44px',
                height: '44px',
                padding: 0,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(0, 0, 0, 0.45)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255, 255, 255, 0.12)'
            }}
            aria-label="Go back"
        >
            <span className="material-symbols-outlined" style={{ fontSize: '24px', marginLeft: '-2px' }}>arrow_back_ios</span>
        </button>
    );
}
