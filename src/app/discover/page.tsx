import { fetchHome } from '@/lib/api';
import Card from '@/components/Card';
import { ContentItem } from '@/lib/providers/types';

export const dynamic = 'force-dynamic';

export default async function DiscoverPage() {
    const rowPromises = await fetchHome();
    const rowsArrays = await Promise.all(rowPromises);
    const rows = rowsArrays.flat();

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
        <div className="container page-pad animate-fade-in">
            <header className="page-header">
                <h1 className="page-title">Discover</h1>
                <p className="page-subtitle">
                    Explore the full cosmos of our curated content collection.
                </p>
            </header>

            {items.length === 0 ? (
                <div className="empty-state">
                    <h2>No content available to discover.</h2>
                </div>
            ) : (
                <div className="grid">
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
