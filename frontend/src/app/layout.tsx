import type { Metadata } from 'next';
import { Inter as FontSans } from 'next/font/google';
import './globals.css';
import { SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/toaster';
import ThemeManager from '@/components/ThemeManager';
import ErrorBoundary from '@/components/ErrorBoundary';
import { CloudSyncProvider } from '@/components/cloud-sync/CloudSyncProvider';
import { CloudSyncRealtime } from '@/components/cloud-sync/CloudSyncRealtime';
import { cn } from '@/lib/utils';

const fontSans = FontSans({
  subsets: ['latin'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'TabSpace',
  description: 'Tab and workspace management — web edition',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang='en' suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(function(registrations) {
                  for (var i = 0; i < registrations.length; i++) {
                    registrations[i].unregister();
                    console.warn('TabSpace: Unregistered stale service worker to prevent conflicts.');
                  }
                });
              }
            `,
          }}
        />
      </head>
      <body
        className={cn(
          'min-h-screen bg-background font-sans antialiased',
          fontSans.variable
        )}
      >
        <ThemeManager />
        <ErrorBoundary>
          <CloudSyncProvider>
            {/* CloudSyncRealtime's chrome.storage.onChanged listener is a guarded
                no-op in the browser (there is no background service worker to
                push writes), so it is safe to keep here; realtime still works via
                the Worker WebSocket + the in-app sync interval wired in AppClient. */}
            <CloudSyncRealtime />
            <SidebarProvider>{children}</SidebarProvider>
          </CloudSyncProvider>
        </ErrorBoundary>
        <Toaster />
      </body>
    </html>
  );
}
