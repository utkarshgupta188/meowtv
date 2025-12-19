import { fetchHome } from '@/lib/api';
import Card from '@/components/Card';

export const revalidate = 60; // Revalidate every minute

export default async function Home() {
  const rows = await fetchHome();

  return (
    <div className="container" style={{ marginTop: '20px' }}>
      {rows.length === 0 ? (
        <div style={{ padding: '50px', textAlign: 'center' }}>
          <h2>No content loaded.</h2>
          <p>Please check your configuration or try again later.</p>
        </div>
      ) : (
        rows.map((row, idx) => (
          row.contents && row.contents.length > 0 && (
            <section key={`${row.name}-${idx}`} className="section">
              <h2 className="section-header">{row.name}</h2>
              <div className="horizontal-scroll">
                {row.contents.map((content, cIdx) => (
                  <Card
                    key={`${content.id}-${cIdx}`}
                    id={content.id}
                    title={content.title!}
                    image={content.coverImage!}
                  />
                ))}
              </div>
            </section>
          )
        ))
      )}
    </div>
  );
}
