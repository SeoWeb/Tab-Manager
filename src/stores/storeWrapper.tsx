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

  useEffect(() => {
    // Much shorter fallback timeout for Chrome extensions (100ms max)
    // const fallbackTimeout = setTimeout(() => {
    //   setIsHydrated(true);
    // }, 100);

    // Try to access the store safely with immediate check
    const checkStore = () => {
      try {
        const store = useAppStore.getState();
        if (store && typeof store === 'object') {
          setIsHydrated(true);
          // clearTimeout(fallbackTimeout);
          return true;
        }
      } catch (error) {
        console.warn('Store access failed during hydration:', error);
      }
      return false;
    };

    // Check immediately - most Chrome extensions should be ready instantly
    if (checkStore()) {
      // return () => clearTimeout(fallbackTimeout);
    }

    // If not ready immediately, use requestAnimationFrame for next tick check
    const rafCheck = requestAnimationFrame(() => {
      if (checkStore()) {
        return;
      }

      // Final check after a minimal delay
      const finalCheck = setTimeout(() => {
        if (!checkStore()) {
          // Force hydration after minimal delay
          setIsHydrated(true);
        }
      }, 16); // Single frame delay

      return () => clearTimeout(finalCheck);
    });

    return () => {
      // clearTimeout(fallbackTimeout);
      cancelAnimationFrame(rafCheck);
    };
  }, []);

  useEffect(() => {
    // Listen for the store's hydration state
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state?._hasHydrated) {
        setIsHydrated(true);
      }
    });

    return unsubscribe;
  }, []);

  // For Chrome extensions, render immediately with minimal delay
  if (!isHydrated) {
    return <></>;
  }

  return (
    <StoreWrapperContext.Provider value={{ isHydrated }}>
      {children}
    </StoreWrapperContext.Provider>
  );
};
