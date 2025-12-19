import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import SearchBar from '@/components/SearchBar';
import ProviderSwitcher from '@/components/ProviderSwitcher';

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
    <html lang="en" suppressHydrationWarning>
      <body>
        <nav className="navbar">
          <Link href="/" className="logo">MeowTV</Link>
          <div className="nav-links">
            <ProviderSwitcher />
            <Link href="/" className="nav-link">Home</Link>
          </div>
          <SearchBar />
        </nav>
        <main>
          {children}
        </main>
      </body>
    </html>
  );
}
