'use client';

import { createContext, useContext } from 'react';

/**
 * Provides the main content scroll element to deeply nested virtualized lists
 * (e.g. each collection's link grid) so they can window against the shared
 * scroll container rather than introducing their own scrollbars.
 */
export const MainScrollContext =
  createContext<React.RefObject<HTMLElement | null> | null>(null);

export function useMainScroll() {
  return useContext(MainScrollContext);
}
