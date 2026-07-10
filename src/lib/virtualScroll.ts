import { useRef } from 'react';
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
  /** Enables dynamic measurement of real row heights after mount. */
  measureElement?: boolean;
}

export interface UseVirtualScrollResult<T extends Element> {
  /** Attach to the scrollable container element. */
  parentRef: React.RefObject<T>;
  /** The configured virtualizer instance. */
  virtualizer: Virtualizer<T, Element>;
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
  measureElement = true,
}: UseVirtualScrollOptions): UseVirtualScrollResult<T> {
  const parentRef = useRef<T>(null);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan,
    getItemKey,
    horizontal,
    measureElement: measureElement
      ? (node: Element) => {
          if (node instanceof HTMLElement) {
            return node.getBoundingClientRect()[horizontal ? 'width' : 'height'];
          }
          return estimateSize(0);
        }
      : undefined,
  });

  return { parentRef, virtualizer };
}
