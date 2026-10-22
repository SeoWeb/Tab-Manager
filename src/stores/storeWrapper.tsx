'use client';

import React, { createContext, useContext } from 'react';
import { useAppStore } from './appStore';

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

export const StoreWrapper: React.FC<StoreWrapperProps> = ({ children }) => {
  // Gate on the store's real hydration signal: `_hasHydrated` is flipped to
  // true by the persist middleware's `onRehydrateStorage` callback once the
  // async chrome.storage.local load resolves (or definitively fails — errors
  // are logged, but hydration still completes). Subscribing directly to the
  // store (instead of polling or using timeouts) guarantees we never render
  // default/mock data as a flash before the persisted state arrives.
  const isHydrated = useAppStore((state) => state._hasHydrated);

  if (!isHydrated) {
    return <></>;
  }

  return (
    <StoreWrapperContext.Provider value={{ isHydrated }}>
      {children}
    </StoreWrapperContext.Provider>
  );
};
