export default function Loading() {
  // Generate 4 rows of placeholders
  const skeletonRows = Array.from({ length: 4 });
  // Make 8 cards for each row to fill horizontal-scroll fully
  const skeletonCards = Array.from({ length: 8 });

  return (
    <>
      {/* Hero Skeleton */}
      <section className="hero animate-fade-in hero-skeleton-container" aria-hidden="true">
        <div className="skeleton hero-skeleton"></div>
      </section>

      {/* Rows Skeleton */}
      <div className="container page-pad" aria-hidden="true">
        {skeletonRows.map((_, idx) => (
          <section key={idx} className="section animate-fade-in">
            <div className="skeleton section-header-skeleton"></div>
            <div className="horizontal-scroll" style={{ overflowX: 'hidden' }}>
              {skeletonCards.map((_, cIdx) => (
                <div key={cIdx} className="scroll-card-wrapper">
                  <div className="skeleton card card-skeleton"></div>
                  <div className="skeleton card-text-skeleton"></div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
