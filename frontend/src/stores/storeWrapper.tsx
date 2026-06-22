'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';

interface StoreWrapperContextType {
  isHydrated: boolean;
}

const StoreWrapperContext = createContext<StoreWrapperContextType>({
  isHydrated: false,
});

export const useStoreWrapper = () => useContext(StoreWrapperContext);

interface StoreWrapperProps {
  children: React.ReactNode;
}

/**
 * Web version of StoreWrapper.
 *
 * With the async IndexedDB storage adapter, `useAppStore.getState()` is
 * non-null immediately but EMPTY until rehydration completes. The extension's
 * StoreWrapper could assume near-instant chrome.storage rehydration and fall
 * back to a rAF/timeout; here we must genuinely await the persist layer's
 * `_hasHydrated` flag, otherwise the UI briefly renders against the empty
 * initial state (flashing mock data or clobbering in-flight edits).
 *
 * `onRehydrateStorage` in `appStore` flips `_hasHydrated` to true once the idb
 * read settles (success or error). A 3s safety net guarantees the app can never
 * hang on a blank screen if that callback somehow never fires.
 */
export const StoreWrapper: React.FC<StoreWrapperProps> = ({ children }) => {
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let safety: ReturnType<typeof setTimeout> | undefined;

    const markHydrated = () => setIsHydrated(true);

    if (useAppStore.getState()._hasHydrated) {
      markHydrated();
      return;
    }

    unsub = useAppStore.subscribe((state) => {
      if (state._hasHydrated) {
        markHydrated();
        unsub?.();
        if (safety) clearTimeout(safety);
      }
    });

    // Pathological-case fallback so the UI never stays blank forever.
    safety = setTimeout(() => {
      markHydrated();
      unsub?.();
    }, 3000);

    return () => {
      unsub?.();
      if (safety) clearTimeout(safety);
    };
  }, []);

  if (!isHydrated) {
    return <></>;
  }

  return (
    <StoreWrapperContext.Provider value={{ isHydrated }}>
      {children}
    </StoreWrapperContext.Provider>
  );
};
