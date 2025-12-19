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
        <div className="container" style={{ marginTop: '30px' }}>
            <h2 className="section-header">
                {query ? `Results for "${query}"` : 'Search'}
            </h2>

            {!query && <p>Type something in the search bar to start.</p>}

            {query && results.length === 0 && <p>No results found.</p>}

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
        </div>
    );
}
