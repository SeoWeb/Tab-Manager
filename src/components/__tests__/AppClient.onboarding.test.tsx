/**
 * AppClient onboarding trigger (fix-cross-context-data-loss §6, tasks
 * 6.3 / 6.4).
 *
 * Renders the real AppClient (heavy UI children stubbed) against a mocked
 * `chrome.storage.local` and asserts the pinned trigger behaviour:
 *
 *  - fresh install (no marker, no persisted state): the wizard opens after
 *    the store hydrates — and the one-time migration marker is written;
 *  - upgrading user (no marker, non-default persisted content): the wizard
 *    is NOT shown, the marker is written once, and a second mount in the
 *    same session never re-decides (cached resolution);
 *  - a user whose flag is already true never sees the wizard;
 *  - a fresh user's first store write (defaults-only blob) still gets the
 *    wizard.
 *
 * The store's persist hydrate is inert here (no chrome at module import), so
 * each test controls the hydration gate explicitly via `_hasHydrated` (same
 * technique as storeWrapper.test.tsx).
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import AppClient from '@/components/AppClient';
import {
  ONBOARDING_MIGRATION_STORAGE_KEY,
  partializeAppState,
  resetOnboardingMigrationForTests,
  useAppStore,
} from '@/stores/appStore';
import { APP_STATE_STORAGE_KEY } from '@tabspace/shared/stores/storage';
import type { AppState } from '@/stores/types';

jest.mock('nanoid', () => ({ nanoid: () => 'test-id' }));

// lucide-react is ESM-only and unparseable by jest; the (real) wizard and its
// dialog are the only rendered components that pull it in.
jest.mock('lucide-react', () => ({
  __esModule: true,
  X: () => null,
  FolderKanban: () => null,
  FolderOpen: () => null,
  Link2: () => null,
}));

// Heavy UI children: stub so the test exercises only the trigger logic.
jest.mock('@/components/left-sidebar/LeftSidebar', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/main-content/MainContentArea', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/right-vertical-tabs/VerticalRightTabsBar', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/right-vertical-tabs/RightContentPanel', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/drag-drop/GlobalDragDropProvider', () => ({
  __esModule: true,
  GlobalDragDropProvider: ({ children }: { children?: ReactNode }) =>
    children ?? null,
}));
jest.mock('@/components/modals/AddProjectModal', () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => children ?? null,
}));
jest.mock('@/components/modals/AddCollectionModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/modals/AddLinkModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/modals/EditLinkModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/hooks/useChromeTabsMonitoring', () => ({
  useChromeTabsMonitoring: () => undefined,
}));
jest.mock('@/lib/cloudflareSync/orchestrator', () => ({
  reconcileAllCloudProjects: jest.fn(async () => ({})),
}));
// Deferred side effects (bookmark init, tab-session nudge) are not under
// test here; keep them from running at all.
jest.mock('@/lib/performanceUtils', () => ({
  deferUntilIdle: () => undefined,
  lazyImport: jest.fn(),
  preloadCriticalResources: () => undefined,
}));

interface Harness {
  store: Record<string, unknown>;
  gets: string[];
  setCount: number;
}

function installChrome(initial: Record<string, unknown> = {}): Harness {
  const h: Harness = { store: { ...initial }, gets: [], setCount: 0 };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const keysArr = Array.isArray(keys) ? keys : [keys];
          keysArr.forEach((k) => h.gets.push(k));
          const out: Record<string, unknown> = {};
          for (const k of keysArr) if (k in h.store) out[k] = h.store[k];
          return out;
        },
        set: async (obj: Record<string, unknown>) => {
          h.setCount += 1;
          Object.assign(h.store, obj);
        },
        remove: async (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys])
            delete h.store[k];
        },
      },
    },
  };
  return h;
}

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

// The deterministic-defaults blob a fresh user's first store write persists.
const firstWriteEnvelope = JSON.stringify({
  state: partializeAppState(useAppStore.getState()),
  version: 1,
});

const hydrate = async (): Promise<void> => {
  act(() => {
    useAppStore.setState({ _hasHydrated: true });
  });
  await act(async () => {
    await Promise.resolve();
  });
};

describe('AppClient onboarding trigger', () => {
  let h: Harness;

  beforeEach(() => {
    jest.clearAllMocks();
    resetOnboardingMigrationForTests();
    h = installChrome();
    useAppStore.setState({
      _hasHydrated: false,
      hasCompletedOnboarding: false,
      isOnboardingOpen: false,
    });
  });

  it('opens the wizard after hydration for a fresh install and writes the marker', async () => {
    render(<AppClient />);

    // Not before hydration.
    expect(useAppStore.getState().isOnboardingOpen).toBe(false);

    await hydrate();

    await waitFor(() => {
      expect(useAppStore.getState().isOnboardingOpen).toBe(true);
    });
    expect(screen.getByText('Welcome to TabSpace')).toBeInTheDocument();
    expect(h.store[ONBOARDING_MIGRATION_STORAGE_KEY]).toBe('fresh');
    expect(h.setCount).toBe(1);
  });

  it('a defaults-only blob (first store write) still shows the wizard', async () => {
    h.store[APP_STATE_STORAGE_KEY] = firstWriteEnvelope;

    render(<AppClient />);
    await hydrate();

    await waitFor(() => {
      expect(useAppStore.getState().isOnboardingOpen).toBe(true);
    });
    expect(h.store[ONBOARDING_MIGRATION_STORAGE_KEY]).toBe('fresh');
  });

  it('an already-completed flag never opens the wizard', async () => {
    useAppStore.setState({ hasCompletedOnboarding: true });

    render(<AppClient />);
    await hydrate();

    // Give any (wrong) async trigger a chance to fire.
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(useAppStore.getState().isOnboardingOpen).toBe(false);
  });

  it('an upgrading user is skipped exactly once: marker written, second mount never re-decides', async () => {
    // Pre-marker storage with non-default (user) content: real prior usage.
    const seed = JSON.parse(firstWriteEnvelope) as {
      state: Record<string, unknown>;
    };
    const [defaultProject] = seed.state.projects as Array<
      Record<string, unknown>
    >;
    seed.state.projects = [
      { ...defaultProject, id: 'user-project-1', name: 'Mine' },
    ];
    h.store[APP_STATE_STORAGE_KEY] = JSON.stringify(seed);

    // First mount: classified upgrading, wizard suppressed, marker written.
    const first = render(<AppClient />);
    await hydrate();

    await waitFor(() => {
      expect(h.store[ONBOARDING_MIGRATION_STORAGE_KEY]).toBe('upgrading');
    });
    expect(useAppStore.getState().isOnboardingOpen).toBe(false);
    expect(h.setCount).toBe(1);

    // Second mount in the same session: the decision is cached and never
    // revisited — no extra marker writes, wizard still suppressed.
    first.unmount();
    useAppStore.setState({ _hasHydrated: false, isOnboardingOpen: false });
    render(<AppClient />);
    await hydrate();

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(useAppStore.getState().isOnboardingOpen).toBe(false);
    expect(h.setCount).toBe(1);
    expect(h.store[ONBOARDING_MIGRATION_STORAGE_KEY]).toBe('upgrading');
  });
});

// Task 5.7 (cleanup-and-regression-tests): the full fresh-install flow across
// launches — a persisted store write BEFORE completing must not set the
// completion flag, the wizard must RE-SHOW on the next launch, and completing
// the wizard must set the explicit flag (which then keeps it closed).
describe('AppClient onboarding fresh-install flow (task 5.7)', () => {
  let h: Harness;

  beforeEach(() => {
    jest.clearAllMocks();
    resetOnboardingMigrationForTests();
    h = installChrome();
    useAppStore.setState({
      _hasHydrated: false,
      hasCompletedOnboarding: false,
      isOnboardingOpen: false,
    });
  });

  it('write-before-complete re-shows the wizard on the next launch; completing sets the explicit flag', async () => {
    // ---- Launch 1: fresh install → the wizard opens, marker written. ----
    const first = render(<AppClient />);
    await hydrate();

    await waitFor(() => {
      expect(useAppStore.getState().isOnboardingOpen).toBe(true);
    });
    expect(screen.getByText('Welcome to TabSpace')).toBeInTheDocument();
    expect(h.store[ONBOARDING_MIGRATION_STORAGE_KEY]).toBe('fresh');

    // ---- The user changes something (a persisted store write) BEFORE
    // completing. What the persist layer serializes must NOT imply
    // completion. ----
    act(() => {
      useAppStore.getState().setThemeColor('#22c55e');
    });
    const written = JSON.parse(
      JSON.stringify({
        state: partializeAppState(useAppStore.getState()),
        version: 1,
      })
    ) as { state: Record<string, unknown> };
    expect(useAppStore.getState().hasCompletedOnboarding).toBe(false);
    expect(written.state.hasCompletedOnboarding).toBe(false);
    h.store[APP_STATE_STORAGE_KEY] = JSON.stringify(written);

    // ---- Launch 2 (new page session): the wizard must RE-SHOW. The blob now
    // differs from the deterministic defaults, but the write-once 'fresh'
    // marker protects the classification — it is never re-decided as
    // 'upgrading'. ----
    first.unmount();
    useAppStore.setState({
      ...(written.state as unknown as Partial<AppState>),
      _hasHydrated: false,
      isOnboardingOpen: false,
    });
    resetOnboardingMigrationForTests(); // simulate a fresh page session
    const second = render(<AppClient />);
    await hydrate();

    await waitFor(() => {
      expect(useAppStore.getState().isOnboardingOpen).toBe(true);
    });
    expect(screen.getByText('Welcome to TabSpace')).toBeInTheDocument();
    // The one-time decision was reused, not revisited: no extra marker write.
    expect(h.setCount).toBe(1);
    expect(h.store[ONBOARDING_MIGRATION_STORAGE_KEY]).toBe('fresh');

    // ---- Completing the wizard ("Get started") sets the explicit flag. ----
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));

    expect(useAppStore.getState().isOnboardingOpen).toBe(false);
    expect(useAppStore.getState().hasCompletedOnboarding).toBe(true);
    const completed = partializeAppState(useAppStore.getState());
    expect(completed.hasCompletedOnboarding).toBe(true);
    h.store[APP_STATE_STORAGE_KEY] = JSON.stringify({
      state: completed,
      version: 1,
    });

    // ---- Launch 3: the explicit completed flag keeps the wizard closed. ----
    second.unmount();
    useAppStore.setState({
      ...completed,
      _hasHydrated: false,
      isOnboardingOpen: false,
    });
    resetOnboardingMigrationForTests(); // fresh page session again
    render(<AppClient />);
    await hydrate();

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(useAppStore.getState().isOnboardingOpen).toBe(false);
    expect(screen.queryByText('Welcome to TabSpace')).not.toBeInTheDocument();
    // Still exactly one decision write across all three launches.
    expect(h.setCount).toBe(1);
  });
});
