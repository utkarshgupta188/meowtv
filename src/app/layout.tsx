import './globals.css';
import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import SmartNavbar from '@/components/SmartNavbar';
import NextTopLoader from 'nextjs-toploader';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#000000',
};

export const metadata: Metadata = {
  title: 'MeowTV',
  description: 'MeowTV Website',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Spline+Sans:wght@300;400;500;600;700;800&display=swap" />
      </head>
      <body className="app-body">
        <NextTopLoader color="#ff0000" showSpinner={false} shadow="0 0 10px #ff0000,0 0 5px #ff0000" />
        {/* Background Glow Accents */}
        <div style={{ position: 'fixed', top: '-10%', left: '-10%', width: '40%', height: '40%', backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: '9999px', filter: 'blur(120px)', pointerEvents: 'none' }}></div>
        <div style={{ position: 'fixed', bottom: '-10%', right: '-10%', width: '40%', height: '40%', backgroundColor: 'rgba(239,68,68,0.05)', borderRadius: '9999px', filter: 'blur(120px)', pointerEvents: 'none' }}></div>

        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: '100vh', position: 'relative' }}>
          <SmartNavbar />

          <main className="page-shell" style={{ flex: 1, paddingTop: 'var(--nav-height, 80px)' }}>
            {children}
          </main>

          <footer className="glass-dark" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '14px 24px', position: 'relative', zIndex: 10 }}>
            <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
              <div className="logo" style={{ fontSize: '1rem' }}>
                <span className="material-symbols-outlined logo-mark" style={{ fontSize: '20px' }}>movie_filter</span>
                <span className="logo-type" style={{ fontSize: '1rem' }}>MEOW<span>TV</span></span>
              </div>
              <div style={{ display: 'flex', gap: '20px', alignItems: 'center', fontSize: '0.8rem', color: '#64748b' }}>
                <Link href="/dmca" style={{ color: '#64748b' }}>DMCA</Link>
                <a href="https://github.com/utkarshgupta188" target="_blank" rel="noopener noreferrer" style={{ color: '#64748b' }}>GitHub</a>
              </div>
              <p style={{ color: '#475569', fontSize: '0.75rem', margin: 0 }}>
                © 2026 MeowTV · Made with ❤️ by <a href="https://github.com/utkarshgupta188" target="_blank" rel="noopener noreferrer" style={{ color: '#ef4444' }}>Utkarsh Gupta</a> · Does not store files on server
              </p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
