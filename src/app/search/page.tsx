import { searchContent } from '@/lib/api';
import Card from '@/components/Card';

export default async function SearchPage({
    searchParams,
}: {
    searchParams: Promise<{ q: string }>;
}) {
    const { q: query } = await searchParams;
    const results = query ? await searchContent(query) : [];

    return (
        <div className="container page-pad">
            <h2 className="section-header">
                {query ? `Results for "${query}"` : 'Search'}
            </h2>

            {!query && <p>Type something in the search bar to start.</p>}

            {query && results.length === 0 && (
                <div className="no-results center" style={{ flexDirection: 'column', padding: '100px 20px', textAlign: 'center' }}>
                    <div className="glass-dark glow-hover" style={{ 
                        padding: '48px 32px', 
                        borderRadius: '32px', 
                        maxWidth: '560px', 
                        border: '1px solid var(--primary-soft)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '20px'
                    }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '64px', color: 'var(--primary)', opacity: 0.8 }}>search_off</span>
                        <h3 style={{ fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#fff' }}>No results for "{query}"</h3>
                        <p className="muted" style={{ fontSize: '1.05rem', lineHeight: 1.6 }}>
                            We couldn't find what you're looking for. But don't worry, you might find it on my other site!
                        </p>
                        <div style={{ width: '100%', height: '1px', background: 'linear-gradient(90deg, transparent, var(--primary-soft), transparent)', margin: '8px 0' }} />
                        <a 
                            href="https://meowly.vercel.app/" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="btn btn-primary"
                            style={{ 
                                padding: '0 40px', 
                                height: '54px', 
                                fontSize: '1rem',
                                boxShadow: '0 15px 35px rgba(239, 68, 68, 0.3)'
                            }}
                        >
                            <span className="material-symbols-outlined">auto_awesome</span>
                            Explore Meowly
                        </a>
                    </div>
                </div>
            )}

            {results.length > 0 && (
                <>
                    <div className="search-suggestion" style={{ marginBottom: '24px' }}>
                        <div className="glass" style={{ 
                            padding: '12px 20px', 
                            borderRadius: '14px', 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'space-between',
                            gap: '16px',
                            border: '1px solid var(--primary-soft)'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: '20px' }}>auto_awesome</span>
                                <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                    Not finding what you need? Try searching on <strong style={{ color: '#fff' }}>Meowly</strong>
                                </p>
                            </div>
                            <a 
                                href="https://meowly.vercel.app/" 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="btn btn-secondary glow-hover"
                                style={{ 
                                    height: '34px', 
                                    padding: '0 14px', 
                                    fontSize: '0.8rem', 
                                    gap: '6px',
                                    borderRadius: '8px'
                                }}
                            >
                                Visit Site <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>open_in_new</span>
                            </a>
                        </div>
                    </div>

                    <div className="grid">
                        {results.map((item) => (
                            <Card
                                key={item.id}
                                id={item.id}
                                title={item.title!}
                                image={item.coverImage!}
                            />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
