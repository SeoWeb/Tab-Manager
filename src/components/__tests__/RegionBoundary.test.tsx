/**
 * Regional error boundaries (ui-resilience spec: "Regional error boundaries
 * with recovery" + "Selector failures are honest"; cleanup change 4.3/4.4).
 *
 * Covers, at the component level and against the real AppClient layout:
 *  - the error state is announced (role="alert") and focus moves to Reset;
 *  - Reset remounts the region subtree (old instance torn down, fresh state);
 *  - a crash is contained to its region — siblings keep working;
 *  - a region that crashes again after Reset re-enters the error state;
 *  - each of the four region names surfaces in its fallback;
 *  - a left-sidebar crash inside the real AppClient leaves the main content,
 *    right tabs bar and modals region interactive (root boundary untouched).
 *
 * The store-selector half of 4.4 (a throwing selector reaching the boundary)
 * lives in src/stores/__tests__/selectorWrappers.test.tsx.
 */
import React, { useEffect, useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegionBoundary from '@/components/RegionBoundary';
import AppClient from '@/components/AppClient';
import { useAppStore } from '@/stores/appStore';

jest.mock('nanoid', () => ({ nanoid: () => 'test-id' }));

// lucide-react is ESM-only and unparseable by jest; stub the icons pulled in
// by the (stubbed) modal/wizard children.
jest.mock('lucide-react', () => ({
  __esModule: true,
  X: () => null,
  FolderKanban: () => null,
  FolderOpen: () => null,
  Link2: () => null,
}));

// --- AppClient integration scaffolding (same technique as
// --- AppClient.onboarding.test.tsx): heavy children stubbed, only the
// --- boundary wiring is under test.

// Mutable probe state shared with the jest.mock factories below (the `mock`
// prefix lets factories reference these).
const mockProbeClicks = { rightTabs: 0 };

jest.mock('@/components/left-sidebar/LeftSidebar', () => ({
  __esModule: true,
  default: function LeftSidebarStub() {
    throw new Error('sidebar exploded');
  },
}));

jest.mock('@/components/main-content/MainContentArea', () => ({
  __esModule: true,
  default: () => <div>main-content-ok</div>,
}));

jest.mock('@/components/right-vertical-tabs/VerticalRightTabsBar', () => ({
  __esModule: true,
  default: function VerticalRightTabsBarStub() {
    return (
      <button
        type='button'
        onClick={() => {
          mockProbeClicks.rightTabs += 1;
        }}
      >
        right-tabs-ok
      </button>
    );
  },
}));

jest.mock('@/components/right-vertical-tabs/RightContentPanel', () => ({
  __esModule: true,
  default: () => <div>right-panel-ok</div>,
}));

jest.mock('@/components/drag-drop/GlobalDragDropProvider', () => ({
  __esModule: true,
  GlobalDragDropProvider: ({ children }: { children?: React.ReactNode }) =>
    children ?? null,
}));

jest.mock('@/components/modals/AddProjectModal', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

jest.mock('@/components/modals/AddCollectionModal', () => ({
  __esModule: true,
  default: () => <div>add-collection-modal-ok</div>,
}));

jest.mock('@/components/modals/AddLinkModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/modals/EditLinkModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/onboarding/OnboardingWizard', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/hooks/useChromeTabsMonitoring', () => ({
  useChromeTabsMonitoring: () => undefined,
}));

jest.mock('@/lib/cloudflareSync/orchestrator', () => ({
  reconcileAllCloudProjects: jest.fn(async () => ({})),
}));

jest.mock('@/lib/performanceUtils', () => ({
  deferUntilIdle: () => undefined,
  lazyImport: jest.fn(),
  preloadCriticalResources: () => undefined,
}));

// jsdom lacks window.matchMedia, which the theme-detection effect uses.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

describe('RegionBoundary', () => {
  it('announces the crash (role=alert, region name + message) and moves focus to Reset', () => {
    render(
      <RegionBoundary name='right panel'>
        <Boom message='panel exploded' />
      </RegionBoundary>
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/right panel/);
    expect(alert).toHaveTextContent('panel exploded');

    const reset = screen.getByRole('button', { name: /reset/i });
    expect(reset).toHaveFocus();
  });

  it('Reset remounts the region subtree: the crashed instance is torn down and the child starts fresh', () => {
    let shouldThrow = false;
    let instanceSeq = 0;
    const mounted: string[] = [];
    const unmounted: string[] = [];

    function FlippableChild() {
      const [id] = useState(() => `instance-${++instanceSeq}`);
      useEffect(() => {
        mounted.push(id);
        return () => {
          unmounted.push(id);
        };
      }, [id]);
      if (shouldThrow) throw new Error('render crash');
      return <div>alive:{id}</div>;
    }

    function Harness() {
      const [, setTick] = useState(0);
      return (
        <RegionBoundary name='main content'>
          <FlippableChild />
          <button type='button' onClick={() => setTick((t) => t + 1)}>
            retrigger
          </button>
        </RegionBoundary>
      );
    }

    render(<Harness />);
    expect(screen.getByText('alive:instance-1')).toBeInTheDocument();
    expect(mounted).toEqual(['instance-1']);

    // Crash on a later render (like a selector blowing up on new state).
    shouldThrow = true;
    fireEvent.click(screen.getByRole('button', { name: /retrigger/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('render crash');

    // The underlying issue clears, then Reset recreates the subtree from
    // scratch: old instance unmounted (effect cleanup ran), new instance
    // mounts with fresh state and a fresh lifecycle.
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('alive:instance-2')).toBeInTheDocument();
    expect(unmounted).toEqual(['instance-1']);
    expect(mounted).toEqual(['instance-1', 'instance-2']);
  });

  it('a crash is contained to its region: the sibling region keeps rendering and stays interactive', () => {
    function Healthy() {
      const [clicks, setClicks] = useState(0);
      return (
        <button type='button' onClick={() => setClicks((c) => c + 1)}>
          healthy clicks: {clicks}
        </button>
      );
    }

    render(
      <div>
        <RegionBoundary name='left sidebar'>
          <Boom message='sidebar gone' />
        </RegionBoundary>
        <RegionBoundary name='right panel'>
          <Healthy />
        </RegionBoundary>
      </div>
    );

    expect(screen.getByRole('alert')).toHaveTextContent('sidebar gone');

    fireEvent.click(screen.getByRole('button', { name: /healthy clicks: 0/i }));
    expect(
      screen.getByRole('button', { name: /healthy clicks: 1/i })
    ).toBeInTheDocument();
  });

  it('a region that crashes again after Reset re-enters the error state instead of blanking the app', () => {
    render(
      <RegionBoundary name='modals'>
        <Boom message='always broken' />
      </RegionBoundary>
    );

    expect(screen.getByRole('alert')).toHaveTextContent('always broken');

    fireEvent.click(screen.getByRole('button', { name: /reset/i }));

    expect(screen.getByRole('alert')).toHaveTextContent('always broken');
  });

  it.each(['left sidebar', 'main content', 'right panel', 'modals'])(
    'the %s fallback names the region so the announcement says what crashed',
    (region) => {
      const { unmount } = render(
        <RegionBoundary name={region}>
          <Boom message='kaput' />
        </RegionBoundary>
      );

      expect(screen.getByRole('alert')).toHaveTextContent(region);
      unmount();
    }
  );
});

describe('AppClient regional isolation', () => {
  it('a left-sidebar crash shows only that region’s fallback; main content, right tabs and modals stay interactive', async () => {
    mockProbeClicks.rightTabs = 0;
    // The store's persist hydrate is inert here (no chrome at module import);
    // keeping _hasHydrated false also keeps the onboarding/theme effects out.
    useAppStore.setState({ _hasHydrated: false });

    render(<AppClient />);

    // The crashed region announces itself…
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/left sidebar/);
    expect(alert).toHaveTextContent('sidebar exploded');

    // …while every other region renders normally (lazy modals resolve async).
    expect(screen.getByText('main-content-ok')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('add-collection-modal-ok')).toBeInTheDocument();
    });

    // The rest of the application remains interactive.
    fireEvent.click(screen.getByRole('button', { name: 'right-tabs-ok' }));
    expect(mockProbeClicks.rightTabs).toBe(1);

    // The root boundary (last resort) was never reached.
    expect(
      screen.queryByText(/Oops! Something went wrong/)
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});
