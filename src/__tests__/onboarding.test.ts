import { useAppStore, mergeAppState } from '@/stores/appStore';
import type { AppState } from '@/stores/types';

jest.mock('nanoid', () => ({ nanoid: () => 'test-id' }));

console.log = jest.fn();

const baseState = useAppStore.getState();

describe('onboarding store state', () => {
  it('defaults hasCompletedOnboarding to false', () => {
    expect(useAppStore.getState().hasCompletedOnboarding).toBe(false);
  });

  it('completeOnboarding sets hasCompletedOnboarding to true and closes the wizard', () => {
    useAppStore.getState().openOnboarding();
    expect(useAppStore.getState().isOnboardingOpen).toBe(true);

    useAppStore.getState().completeOnboarding();

    expect(useAppStore.getState().hasCompletedOnboarding).toBe(true);
    expect(useAppStore.getState().isOnboardingOpen).toBe(false);
  });
});

describe('onboarding merge migration', () => {
  it('keeps hasCompletedOnboarding false for a snapshot that has projects (§6: no projects inference)', () => {
    // Regression: the merge used to force `true` whenever the persisted
    // snapshot contained a projects array, so a fresh user's first store
    // write (which persists the deterministic default projects) silently
    // completed onboarding. The flag is governed solely by the explicit flag.
    const snapshot = {
      projects: [{ id: 'p1', name: 'Work' }],
      hasCompletedOnboarding: false,
    } as unknown as Partial<AppState>;

    const merged = mergeAppState(snapshot, baseState as AppState);

    expect(merged.hasCompletedOnboarding).toBe(false);
  });

  it('keeps the persisted flag false on a cross-context rehydrate, even with projects', () => {
    const snapshot = {
      projects: [{ id: 'p1', name: 'Work' }],
      hasCompletedOnboarding: false,
    } as unknown as Partial<AppState>;
    const hydratedState = {
      ...baseState,
      _hasHydrated: true,
    } as unknown as AppState;

    const merged = mergeAppState(snapshot, hydratedState);

    expect(merged.hasCompletedOnboarding).toBe(false);
  });

  it('keeps the persisted flag true when onboarding was completed elsewhere', () => {
    const snapshot = {
      hasCompletedOnboarding: true,
    } as unknown as Partial<AppState>;

    const merged = mergeAppState(snapshot, baseState as AppState);

    expect(merged.hasCompletedOnboarding).toBe(true);
  });

  it('falls back to the current state flag when the snapshot omits it', () => {
    const snapshot = { projects: [] } as unknown as Partial<AppState>;
    const current = {
      ...baseState,
      hasCompletedOnboarding: true,
    } as unknown as AppState;

    const merged = mergeAppState(snapshot, current);

    expect(merged.hasCompletedOnboarding).toBe(true);
  });
});
