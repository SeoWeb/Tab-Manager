'use client';
import React, { Component, ErrorInfo, ReactNode } from 'react';

interface RegionBoundaryProps {
  /** Human-readable region name shown in the fallback UI (e.g. "left sidebar"). */
  name: string;
  children: ReactNode;
}

interface RegionBoundaryState {
  error: Error | null;
  /** Increments on Reset; used as a key so the region subtree is recreated. */
  resetCount: number;
}

/**
 * Per-region error boundary (left sidebar / main content / right panel /
 * modals). A crash inside the region is contained here and the rest of the
 * application stays interactive; the root boundary in `app/layout.tsx` remains
 * the last resort.
 *
 * The fallback announces the error via `role="alert"` and moves focus to the
 * Reset button. Reset clears the error and re-mounts the children (keyed
 * fragment) so the region subtree is recreated fresh.
 */
class RegionBoundary extends Component<
  RegionBoundaryProps,
  RegionBoundaryState
> {
  public state: RegionBoundaryState = {
    error: null,
    resetCount: 0,
  };

  public static getDerivedStateFromError(error: Error): RegionBoundaryState {
    return { error, resetCount: 0 };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`Error in "${this.props.name}" region:`, error, errorInfo);
  }

  private handleReset = () => {
    this.setState((state) => ({
      error: null,
      resetCount: state.resetCount + 1,
    }));
  };

  public render() {
    const { error } = this.state;
    const { name, children } = this.props;

    if (error) {
      return (
        <div
          role='alert'
          className='p-4 m-2 rounded border border-red-300 bg-red-50 text-center'
        >
          <h2 className='text-sm font-semibold text-red-500'>
            The &ldquo;{name}&rdquo; section crashed.
          </h2>
          <p className='mt-1 text-xs text-gray-600'>{error.message}</p>
          <button
            type='button'
            autoFocus
            onClick={this.handleReset}
            className='mt-3 rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100'
          >
            Reset
          </button>
        </div>
      );
    }

    // Keyed fragment: bumping `resetCount` on Reset forces React to unmount
    // and remount the whole region subtree.
    return (
      <React.Fragment key={this.state.resetCount}>{children}</React.Fragment>
    );
  }
}

export default RegionBoundary;
