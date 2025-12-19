'use client';

import { useState, useEffect } from 'react';
import { setProviderAction, getProviderNameAction } from '@/lib/api';
import { useRouter } from 'next/navigation';

export default function ProviderSwitcher() {
    const [provider, setProvider] = useState<string>('MeowMov');
    const router = useRouter();

    useEffect(() => {
        getProviderNameAction().then(setProvider);
    }, []);

    const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newProvider = e.target.value;
        setProvider(newProvider);
        await setProviderAction(newProvider);
        router.refresh();
        window.location.reload(); // Force reload to ensure all data is re-fetched
    };

    return (
        <div style={{ marginRight: '20px' }}>
            <select
                suppressHydrationWarning
                value={provider}
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
                <option value="MeowMov">MeowMov</option>
                <option value="MeowVerse">MeowVerse</option>
                <option value="MeowToon">MeowToon</option>
            </select>
        </div>
    );
}
