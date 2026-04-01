'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';

export type HeroItem = {
  id: string;
  title: string;
  description?: string;
  year?: number;
  score?: number;
  coverImage?: string;
  backgroundImage?: string;
};

function normalizeItems(items: HeroItem[]): HeroItem[] {
  const seen = new Set<string>();
  const out: HeroItem[] = [];
  for (const it of items) {
    const id = String(it?.id ?? '').trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const title = String(it?.title ?? '').trim();
    const coverImage = String(it?.coverImage ?? '').trim();
    const backgroundImage = String(it?.backgroundImage ?? '').trim();
    out.push({
      id,
      title: title || 'Untitled',
      description: it?.description,
      year: it?.year,
      score: it?.score,
      coverImage: coverImage || undefined,
      backgroundImage: backgroundImage || undefined,
    });
  }
  return out;
}

export default function HeroRotator({
  items,
  initialIndex = 0,
  intervalMs = 5000,
}: {
  items: HeroItem[];
  initialIndex?: number;
  intervalMs?: number;
}) {
  const normalized = useMemo(() => normalizeItems(items), [items]);
  const safeInitial = Math.min(Math.max(initialIndex, 0), Math.max(normalized.length - 1, 0));

  const [index, setIndex] = useState<number>(safeInitial);
  const lastUserActionAt = useRef<number>(0);

  useEffect(() => {
    setIndex(safeInitial);
  }, [safeInitial]);

  const current = normalized[index] ?? normalized[0] ?? null;

  const pickRandomIndex = (maxExclusive: number, exclude: number) => {
    if (maxExclusive <= 1) return 0;
    // Try a few times to avoid repeats.
    for (let i = 0; i < 8; i++) {
      const next = Math.floor(Math.random() * maxExclusive);
      if (next !== exclude) return next;
    }
    return (exclude + 1) % maxExclusive;
  };

  useEffect(() => {
    if (normalized.length <= 1) return;

    const t = window.setInterval(() => {
      // If the user recently touched the slider, don't fight them.
      if (Date.now() - lastUserActionAt.current < 2500) return;
      setIndex((prev) => pickRandomIndex(normalized.length, prev));
    }, intervalMs);

    return () => window.clearInterval(t);
  }, [normalized.length, intervalMs]);

  if (!current) return null;

  const backdrop = current.backgroundImage || current.coverImage || '';

  return (
    <>
      <div className="absolute inset-0 w-full h-full">
        <Image 
          src={backdrop} 
          className="hero-backdrop object-cover" 
          alt={current.title} 
          fill 
          priority 
          sizes="100vw"
        />
        <div className="hero-gradient"></div>
      </div>

      <div className="hero-content">
        <div>
          <div className="hero-meta">
            <span className="hero-score-wrapper">
              <span className="material-symbols-outlined text-sm text-yellow-500 fill-1">star</span>
              {current.score ? `${current.score} Rating` : '9.8 Rating'}
              {current.year ? ` • ${current.year}` : null}
            </span>
          </div>

          <h1 className="hero-title">{current.title}</h1>

          <p className="hero-description">
            {current.description || 'In a universe of cosmic mystery, one feline adventurer must reclaim the lost throne of Orion. A visual masterpiece spanning across seven star systems.'}
          </p>

          <div className="hero-actions">
            <Link href={`/watch/${encodeURIComponent(String(current.id))}`} className="btn btn-primary" style={{ gap: '8px' }}>
              <span className="material-symbols-outlined fill-1" style={{ fontSize: '1.25rem' }}>play_arrow</span> Play Now
            </Link>
            <Link href={`/watch/${encodeURIComponent(String(current.id))}`} className="btn btn-secondary" style={{ gap: '8px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '1.25rem' }}>info</span> More Info
            </Link>
          </div>
        </div>
      </div>

      {normalized.length > 1 ? (
        <div className="hero-dots" aria-label="Hero selector">
          <div className="hero-dots-inner" role="tablist" aria-label="Hero items">
            {normalized.slice(0, 12).map((it, i) => (
              <button
                key={it.id}
                type="button"
                className={`hero-dot ${i === index ? 'is-active' : ''}`}
                onClick={() => {
                  lastUserActionAt.current = Date.now();
                  setIndex(i);
                }}
                aria-label={it.title}
                aria-current={i === index}
              />
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
