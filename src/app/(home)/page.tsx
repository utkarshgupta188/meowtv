import { randomInt } from 'node:crypto';
import { Suspense } from 'react';

import { fetchDetails, fetchHome } from '@/lib/api';
import Card from '@/components/Card';
import HeroRotator from '@/components/HeroRotator';
import { HomePageRow } from '@/lib/providers/types';

export const dynamic = 'force-dynamic';

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export default async function Home() {
  const rowPromises = await fetchHome();

  return (
    <>
      <Suspense fallback={
        <section className="hero" style={{ minHeight: '600px', backgroundColor: '#0f1115' }}>
          {/* Simple skeleton for hero */}
        </section>
      }>
        <HeroSectionLoader rowPromises={rowPromises} />
      </Suspense>

      <div className="container page-pad">
        {rowPromises.length === 0 ? (
          <div className="empty-state">
            <h2>No content available.</h2>
            <p>Please check your configuration or try again later.</p>
          </div>
        ) : (
          rowPromises.map((promise, idx) => (
            <Suspense
              key={`row-suspense-${idx}`}
              fallback={
                <div style={{ padding: '2rem 1rem', display: 'flex', gap: '1rem', overflow: 'hidden' }}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={`skel-${idx}-${i}`} className="card-skeleton" />
                  ))}
                </div>
              }
            >
              <AsyncRowsLoader promise={promise} />
            </Suspense>
          ))
        )}
      </div>
    </>
  );
}

async function HeroSectionLoader({ rowPromises }: { rowPromises: Promise<HomePageRow[]>[] }) {
  if (rowPromises.length === 0) return null;

  // Wait for the first chunk of rows to load to pick hero items
  let rows: HomePageRow[] = [];
  try {
    // Await the fastest resolving promise or just the first one. 
    // we use the first one since it's typically the primary content (like Kartoons)
    rows = await rowPromises[0];
  } catch (err) {
    console.warn("Failed to load first row promise for hero section", err);
  }

  const featuredId = rows?.[0]?.contents?.[0]?.id;
  const featured = featuredId ? await fetchDetails(featuredId, false) : null;

  const candidateIds = Array.from(
    new Set(
      rows
        .flatMap((r) => r?.contents ?? [])
        .map((c) => c?.id)
        .filter((v): v is string => Boolean(v))
    )
  );

  const TARGET_HERO_ITEMS = 5;
  const MAX_CANDIDATE_FETCH = 10;
  const BATCH_SIZE = 10;

  const shuffledIds = [...candidateIds];
  shuffleInPlace(shuffledIds);

  const heroItems: Array<{
    id: string;
    title: string;
    description?: string;
    year?: number;
    score?: number;
    coverImage?: string;
    backgroundImage?: string;
  }> = [];
  const seenHeroIds = new Set<string>();

  const maxToFetch = Math.min(shuffledIds.length, MAX_CANDIDATE_FETCH);
  for (let start = 0; start < maxToFetch && heroItems.length < TARGET_HERO_ITEMS; start += BATCH_SIZE) {
    const batchIds = shuffledIds.slice(start, start + BATCH_SIZE);
    const batchDetails = await Promise.allSettled(batchIds.map((id) => fetchDetails(id, false)));

    for (const r of batchDetails) {
      if (r.status !== 'fulfilled') continue;
      const d = r.value;
      if (!d || !d.id) continue;
      if (!d.backgroundImage) continue;
      if (seenHeroIds.has(d.id)) continue;
      seenHeroIds.add(d.id);
      heroItems.push({
        id: d.id,
        title: d.title,
        description: d.description,
        year: d.year,
        score: d.score,
        coverImage: d.coverImage,
        backgroundImage: d.backgroundImage,
      });
      if (heroItems.length >= TARGET_HERO_ITEMS) break;
    }
  }

  if (heroItems.length > 0) {
    return (
      <section className="hero animate-fade-in">
        <HeroRotator items={heroItems} intervalMs={5000} />
      </section>
    );
  }

  if (featured && featured.backgroundImage) {
    return (
      <section className="hero animate-fade-in">
        <HeroRotator
          items={[{
            id: featured.id,
            title: featured.title,
            description: featured.description,
            year: featured.year,
            score: featured.score,
            coverImage: featured.coverImage,
            backgroundImage: featured.backgroundImage,
          }]}
          intervalMs={5000}
        />
      </section>
    );
  }

  return null;
}

async function AsyncRowsLoader({ promise }: { promise: Promise<HomePageRow[]> }) {
  let rows: HomePageRow[] = [];
  try {
    rows = await promise;
  } catch (err) {
    console.warn("Failed to load row promise", err);
    return null;
  }

  if (!rows || rows.length === 0) return null;

  return (
    <>
      {rows.map((row, idx) => (
        row.contents && row.contents.length > 0 && (
          <section key={`async-${row.name}-${idx}`} className="section animate-fade-in">
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
      ))}
    </>
  );
}
