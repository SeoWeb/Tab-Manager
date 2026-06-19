'use client';

import { useEffect } from 'react';

/**
 * Performance monitoring component to track page load times
 */
export const PerformanceMonitor: React.FC = () => {
  useEffect(() => {
    // Only run performance monitoring in development or when explicitly enabled
    if (
      process.env.NODE_ENV !== 'development' &&
      !localStorage.getItem('enablePerformanceMonitoring')
    ) {
      return;
    }

    // Use requestIdleCallback for non-blocking performance measurement
    const measurePageLoad = () => {
      const measure = () => {
        try {
          if (typeof window !== 'undefined' && 'performance' in window) {
            const navigation = performance.getEntriesByType(
              'navigation'
            )[0] as PerformanceNavigationTiming;

            if (navigation) {
              const loadTime =
                navigation.loadEventEnd - navigation.loadEventStart;
              const domContentLoaded =
                navigation.domContentLoadedEventEnd -
                navigation.domContentLoadedEventStart;
              const totalTime = navigation.loadEventEnd - navigation.fetchStart;

              console.log('🚀 Performance Metrics:');
              console.log(`  - Page Load Time: ${loadTime.toFixed(2)}ms`);
              console.log(
                `  - DOM Content Loaded: ${domContentLoaded.toFixed(2)}ms`
              );
              console.log(`  - Total Load Time: ${totalTime.toFixed(2)}ms`);

              // Track if load time is under 1 second (our target)
              if (totalTime < 1000) {
                console.log(
                  '✅ Load time is under 1 second - Great performance!'
                );
              } else {
                console.log(
                  '⚠️ Load time is over 1 second - Consider further optimizations'
                );
              }
            }
          }
        } catch (error) {
          if (process.env.NODE_ENV === 'development') {
            console.warn('Performance measurement failed:', error);
          }
        }
      };

      // Use requestIdleCallback for better performance
      if ('requestIdleCallback' in window) {
        requestIdleCallback(measure, { timeout: 1000 });
      } else {
        setTimeout(measure, 0);
      }
    };

    // Measure after the page is fully loaded
    if (document.readyState === 'complete') {
      measurePageLoad();
    } else {
      window.addEventListener('load', measurePageLoad, { once: true });
    }

    // Monitor React hydration time with minimal overhead
    const hydrationStart = performance.now();
    const checkHydration = () => {
      try {
        const hydrationEnd = performance.now();
        const hydrationTime = hydrationEnd - hydrationStart;
        console.log(`⚡ React Hydration Time: ${hydrationTime.toFixed(2)}ms`);
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('Hydration measurement failed:', error);
        }
      }
    };

    // Use requestIdleCallback for hydration check too
    if ('requestIdleCallback' in window) {
      requestIdleCallback(checkHydration, { timeout: 100 });
    } else {
      setTimeout(checkHydration, 16); // Single frame delay
    }
  }, []);

  return null; // This component doesn't render anything
};
