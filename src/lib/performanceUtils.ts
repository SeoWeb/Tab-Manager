/**
 * Performance optimization utilities
 */

/**
 * Defers execution of a function until the browser is idle
 */
export const deferUntilIdle = (
  callback: () => void | Promise<void>,
  timeout = 5000
): void => {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(
      () => {
        try {
          callback();
        } catch (error) {
          console.error('Error in deferred callback:', error);
        }
      },
      { timeout }
    );
  } else {
    // Fallback for browsers without requestIdleCallback
    setTimeout(() => {
      try {
        callback();
      } catch (error) {
        console.error('Error in deferred callback:', error);
      }
    }, 100);
  }
};

/**
 * Creates a debounced version of a function
 */
export const debounce = <T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => func(...args), wait);
  };
};

/**
 * Creates a throttled version of a function
 */
export const throttle = <T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): ((...args: Parameters<T>) => void) => {
  let inThrottle: boolean = false;

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
};

/**
 * Lazy loads a module and caches the result
 */
const moduleCache = new Map<string, unknown>();

export const lazyImport = async <T>(
  importFn: () => Promise<T>,
  cacheKey: string
): Promise<T> => {
  if (moduleCache.has(cacheKey)) {
    return moduleCache.get(cacheKey) as T;
  }

  const importedModule = await importFn();
  moduleCache.set(cacheKey, importedModule);
  return importedModule;
};

/**
 * Batches multiple operations to run in the next frame
 */
export const batchOperations = (operations: (() => void)[]): void => {
  requestAnimationFrame(() => {
    operations.forEach((op) => {
      try {
        op();
      } catch (error) {
        console.error('Error in batched operation:', error);
      }
    });
  });
};

/**
 * Measures and logs performance of a function
 */
export const measurePerformance = async <T>(
  name: string,
  fn: () => T | Promise<T>
): Promise<T> => {
  const start = performance.now();
  const result = await fn();
  const end = performance.now();
  console.log(`${name} took ${end - start} milliseconds`);
  return result;
};

/**
 * Preloads critical resources
 */
export const preloadCriticalResources = (): void => {
  deferUntilIdle(() => {
    // Preload commonly used modules
    import('@/lib/bookmarkStorage').catch(console.error);
    import('@/lib/tabSessionService').catch(console.error);
  });
};
