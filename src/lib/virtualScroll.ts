import { useRef, useEffect } from 'react';
import { useVirtualizer, Virtualizer } from '@tanstack/react-virtual';
import {
  MeasuringConfiguration,
  MeasuringStrategy,
  AutoScrollOptions,
} from '@dnd-kit/core';

/**
 * Shared dnd-kit measuring configuration for virtualized lists.
 *
 * Virtualized rows mount/unmount as the user scrolls, so the sortable items
 * must be re-measured continuously while a drag is in progress. Otherwise
 * dnd-kit loses track of rows that have been virtualized out of the DOM.
 */
export const virtualListMeasuring: MeasuringConfiguration = {
  droppable: { strategy: MeasuringStrategy.Always },
};

/**
 * Auto-scroll configuration for virtualized scroll containers.
 *
 * Enables edge auto-scroll so dragging near the top/bottom of a windowed list
 * keeps the active item measured and the scroll position advances.
 */
export const virtualListAutoScroll: AutoScrollOptions = {
  enabled: true,
  threshold: { x: 0.15, y: 0.15 },
};

export interface UseVirtualScrollOptions {
  /** Total number of items in the list. */
  count: number;
  /** Estimated size (px) of a single row before it is measured. */
  estimateSize?: (index: number) => number;
  /** Extra rows rendered above/below the viewport to avoid blank flashes. */
  overscan?: number;
  /** Stable key for each item at the given index. */
  getItemKey?: (index: number) => string | number;
  /** When true, virtualizes along the horizontal axis. */
  horizontal?: boolean;
  /**
   * Optional external scroll element. When provided, the virtualizer uses this
   * element as the scroll container instead of an internally created `parentRef`.
   * Use this when the list scrolls within an ancestor (e.g. the main content
   * area) rather than its own wrapper.
   */
  scrollRef?: React.RefObject<Element | null>;
}

export interface UseVirtualScrollResult<T extends Element> {
  /** Attach to the scrollable container element. */
  parentRef: React.RefObject<T>;
  /** The configured virtualizer instance. */
  virtualizer: Virtualizer<T, Element>;
  /**
   * @deprecated Use `virtualizer.measureElement` directly as the ref on each
   * virtual item wrapper. Kept for backward compat; is an alias for the same.
   */
  measureElementRef: (node: Element | null) => void;
}

/**
 * Reusable windowing hook for large scrollable lists.
 *
 * Wraps `@tanstack/react-virtual`'s `useVirtualizer` and pairs it with the
 * dnd-kit `virtualListMeasuring` / `virtualListAutoScroll` configs so the same
 * pattern can be reused by the projects list, collections list, and link grid.
 *
 * The returned `parentRef` should be attached to the scroll container and the
 * `DndContext` (near the virtualized list) should receive:
 *   `measuring={virtualListMeasuring}` and `autoScroll={virtualListAutoScroll}`.
 */
export function useVirtualScroll<T extends Element = HTMLDivElement>({
  count,
  estimateSize = () => 64,
  overscan = 8,
  getItemKey,
  horizontal = false,
  scrollRef,
}: UseVirtualScrollOptions): UseVirtualScrollResult<T> {
  const parentRef = useRef<T>(null);

  // Pass measureElement: undefined to let @tanstack/react-virtual use its
  // built-in ResizeObserver-based measurement (offsetHeight). This is the
  // correct way in v3 — our virtualizer.measureElement is already a valid
  // ref callback that hooks up ResizeObserver internally.
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () =>
      (scrollRef?.current ?? parentRef.current) as T | null,
    estimateSize,
    overscan,
    getItemKey,
    horizontal,
  });

  /**
   * Re-measure whenever the scroll container changes size (including its very
   * first layout). The virtualizer is created before the shared external scroll
   * element (`mainScrollRef`) has dimensions, so its initial rect can be 0 and
   * `getVirtualItems()` returns nothing. Mirroring with our own observer (plus
   * a first-frame measure) clears the stuck-empty state without waiting for a
   * user-triggered resize.
   */
  useEffect(() => {
    const el = (scrollRef?.current ?? parentRef.current) as Element | null;
    if (!el) return;
    const ro = new ResizeObserver(() => virtualizer.measure());
    ro.observe(el);
    const raf = requestAnimationFrame(() => virtualizer.measure());
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [scrollRef, parentRef, virtualizer]);

  // virtualizer.measureElement is already a ResizeObserver-backed ref callback
  // in @tanstack/react-virtual v3. Expose it as measureElementRef for compat.
  return {
    parentRef,
    virtualizer,
    measureElementRef: virtualizer.measureElement,
  };
}
