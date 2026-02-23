import { fetchHome } from '@/lib/api';
import Card from '@/components/Card';
import { ContentItem } from '@/lib/providers/types';

export const dynamic = 'force-dynamic';

export default async function DiscoverPage() {
    const rows = await fetchHome();

    // Collect all unique items
    const allItemsMap = new Map<string, ContentItem>();

    for (const row of rows) {
        if (!row.contents) continue;
        for (const item of row.contents) {
            if (item.id && !allItemsMap.has(item.id)) {
                allItemsMap.set(item.id, item);
            }
        }
    }

    const items = Array.from(allItemsMap.values());

    return (
        <div className="container page-pad animate-fade-in" style={{ paddingTop: '40px' }}>
            <div style={{ marginBottom: '32px' }}>
                <h1 style={{ fontSize: '2.5rem', fontWeight: 800, color: '#fff', marginBottom: '8px' }}>
                    Discover
                </h1>
                <p style={{ color: '#94a3b8', fontSize: '1rem' }}>
                    Explore the full cosmos of our curated content collection.
                </p>
            </div>

            {items.length === 0 ? (
                <div className="empty-state">
                    <h2>No content available to discover.</h2>
                </div>
            ) : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                    gap: '24px'
                }}>
                    {items.map((item, idx) => (
                        <div key={`${item.id}-${idx}`} style={{ animationDelay: `${(idx % 10) * 50}ms` }} className="animate-fade-in">
                            <Card
                                id={item.id}
                                title={item.title!}
                                image={item.coverImage!}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
