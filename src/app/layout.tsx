import './globals.css';
import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import SmartNavbar from '@/components/SmartNavbar';
import NextTopLoader from 'nextjs-toploader';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#120810',
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
        <div style={{ position: 'fixed', top: '-10%', left: '-10%', width: '40%', height: '40%', backgroundColor: 'rgba(236,19,164,0.1)', borderRadius: '9999px', filter: 'blur(120px)', pointerEvents: 'none' }}></div>
        <div style={{ position: 'fixed', bottom: '-10%', right: '-10%', width: '40%', height: '40%', backgroundColor: 'rgba(37,99,235,0.1)', borderRadius: '9999px', filter: 'blur(120px)', pointerEvents: 'none' }}></div>

        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: '100vh', position: 'relative' }}>
          <SmartNavbar />

          <main className="page-shell" style={{ flex: 1, paddingTop: '80px' }}>
            {children}
          </main>

          <footer className="glass-dark" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '24px 24px 16px', position: 'relative', zIndex: 10 }}>
            <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="logo" style={{ marginBottom: '8px' }}>
                  <span className="material-symbols-outlined logo-mark" style={{ fontSize: '24px' }}>movie_filter</span>
                  <span className="logo-type" style={{ fontSize: '1.25rem' }}>Meow<span>TV</span></span>
                </div>
                <p style={{ color: '#64748b', fontSize: '0.875rem' }}>Elevating your streaming experience with high-fidelity visuals and curated feline content from across the universe.</p>
                <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '16px' }}>Made With 💚 By Utkarsh Gupta | <a href="https://github.com/utkarshgupta188" target="_blank" rel="noopener noreferrer" style={{ color: '#ec13a4' }}>GitHub</a></p>
              </div>

              <div>
                <h3 style={{ color: '#fff', fontWeight: 'bold', marginBottom: '16px' }}>MeowTV</h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.875rem', color: '#64748b' }}>
                  <li><Link href="/dmca">DMCA</Link></li>
                  <li><a href="https://github.com/utkarshgupta188" target="_blank" rel="noopener noreferrer">GitHub</a></li>
                </ul>
              </div>

              <div>
                <h3 style={{ color: '#fff', fontWeight: 'bold', marginBottom: '16px' }}>Legal</h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.875rem', color: '#64748b' }}>
                  <li><Link href="/">Terms of Service</Link></li>
                  <li><Link href="/">Privacy Policy</Link></li>
                </ul>
              </div>
            </div>

            <div style={{ maxWidth: '1400px', margin: '24px auto 0', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: '#475569' }}>
              <p>© 2026 MeowTV Media Group. All rights reserved.</p>
              <p style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>This site does not store any files on our server.</p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
