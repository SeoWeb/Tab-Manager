'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
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
  const [isHydrated, setIsHydrated] = useState(false);
  const [timeoutReached, setTimeoutReached] = useState(false);

  useEffect(() => {
    // Set a timeout to prevent infinite loading
    const timeout = setTimeout(() => {
      setTimeoutReached(true);
      setIsHydrated(true);
    }, 2000); // 2 seconds timeout

    // Try to access the store safely
    try {
      const store = useAppStore.getState();
      if (store && typeof store === 'object') {
        setIsHydrated(true);
        clearTimeout(timeout);
      }
    } catch (error) {
      console.warn('Store access failed during hydration:', error);
      // Still allow rendering after timeout
    }

    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    // Also listen for the store's hydration state
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state?._hasHydrated) {
        setIsHydrated(true);
      }
    });

    return unsubscribe;
  }, []);

  // Don't render children until store is hydrated or timeout is reached
  if (!isHydrated && !timeoutReached) {
    return (
      <div className='flex items-center justify-center h-screen bg-background'>
        <div className='text-lg text-muted-foreground'>Loading...</div>
      </div>
    );
  }

  return (
    <StoreWrapperContext.Provider value={{ isHydrated }}>
      {children}
    </StoreWrapperContext.Provider>
  );
};
