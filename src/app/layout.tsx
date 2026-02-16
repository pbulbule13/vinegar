import type { Metadata, Viewport } from 'next';
import { Inter, Orbitron, JetBrains_Mono } from 'next/font/google';
import { ClientOnly } from '@/components/client-only';
import { ErrorBoundary } from '@/components/error-boundary';
import './globals.css';

// Server-side init: register tools, start scheduler
import '@/lib/init';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const orbitron = Orbitron({ subsets: ['latin'], variable: '--font-orbitron', display: 'swap' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  title: 'Vinegar - Home AI Assistant',
  description: 'Your personal home AI assistant for the whole family',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Vinegar',
  },
};

export const viewport: Viewport = {
  themeColor: '#F59E0B',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${orbitron.variable} ${jetbrainsMono.variable}`}>
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className="bg-deep-space text-text-primary font-inter antialiased">
        <ErrorBoundary><ClientOnly>{children}</ClientOnly></ErrorBoundary>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js').catch(() => {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
