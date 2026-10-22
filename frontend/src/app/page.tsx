'use client';

import dynamic from 'next/dynamic';
import { StoreWrapper } from '../stores/WebStoreWrapper';

// Web entry — mirrors the extension's page shape: StoreWrapper (web variant,
// awaits the IndexedDB-backed store rehydration with a safety-net timeout)
// wraps the dynamically-imported web AppClient, which skips extension-only
// init (bookmarks, tab sessions, chrome.tabs monitoring) and instead wires the
// in-app cloud-sync cadence the extension ran via `chrome.alarms`.
const AppClient = dynamic(() => import('../components/WebAppClient'), {
  ssr: false,
});

export default function Home() {
  return (
    <StoreWrapper>
      <AppClient />
    </StoreWrapper>
  );
}
