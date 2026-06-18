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
  description: 'Advanced tab and bookmark management by Firebase Studio',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang='en' suppressHydrationWarning>
      <body
        className={cn(
          'min-h-screen bg-background font-sans antialiased',
          fontSans.variable
        )}
      >
        <ThemeManager />
        <ErrorBoundary>
          <CloudSyncProvider>
            <CloudSyncRealtime />
            <SidebarProvider>{children}</SidebarProvider>
          </CloudSyncProvider>
        </ErrorBoundary>
        <Toaster />
      </body>
    </html>
  );
}
