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
  it('skips onboarding (hasCompletedOnboarding true) for a snapshot with projects', () => {
    const snapshot = {
      projects: [{ id: 'p1', name: 'Work' }],
      hasCompletedOnboarding: false,
    } as unknown as Partial<AppState>;

    const merged = mergeAppState(snapshot, baseState as AppState);

    expect(merged.hasCompletedOnboarding).toBe(true);
  });

  it('keeps hasCompletedOnboarding false for a fresh snapshot without projects', () => {
    const snapshot = {
      hasCompletedOnboarding: false,
    } as unknown as Partial<AppState>;

    const merged = mergeAppState(snapshot, baseState as AppState);

    expect(merged.hasCompletedOnboarding).toBe(false);
  });
});
