import type { Metadata } from 'next';
import { Roboto } from 'next/font/google';
import './globals.css';
import { SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/toaster';
import ThemeManager from '@/components/ThemeManager';
import ErrorBoundary from '@/components/ErrorBoundary';

const roboto = Roboto({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
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
        className={`${roboto.className} antialiased`}
        suppressHydrationWarning
      >
        <ThemeManager />
        <ErrorBoundary>
          <SidebarProvider>{children}</SidebarProvider>
        </ErrorBoundary>
        <Toaster />
      </body>
    </html>
  );
}
