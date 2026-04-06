import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Nav from '@/components/nav';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Mariabelle — Parser Validation',
  description: 'WhatsApp message parser playground',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="app-shell">
          <Nav />
          <main className="main-content">{children}</main>
        </div>
      </body>
    </html>
  );
}
