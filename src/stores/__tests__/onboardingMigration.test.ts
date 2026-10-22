/**
 * One-time onboarding migration marker (fix-cross-context-data-loss §6,
 * tasks 6.2 / 6.4).
 *
 * `resolveOnboardingMigration` classifies a user exactly once per session
 * against a mocked `chrome.storage.local`:
 *
 *  - no marker + no/only-default content  → fresh ('fresh' marker written),
 *    even when a blob exists because the first store write persisted the
 *    deterministic defaults (the "first store write must not complete
 *    onboarding" classification side);
 *  - no marker + real prior usage (created, edited, deleted, or an explicit
 *    completed flag) → upgrading ('upgrading' marker written);
 *  - marker present → the recorded decision, never rewritten or revisited;
 *  - repeated calls in one session hit the cached decision (no extra reads).
 */
import {
  ONBOARDING_MIGRATION_STORAGE_KEY,
  partializeAppState,
  resolveOnboardingMigration,
  resetOnboardingMigrationForTests,
  useAppStore,
} from '@/stores/appStore';
import { APP_STATE_STORAGE_KEY } from '@tabspace/shared/stores/storage';

jest.mock('nanoid', () => ({ nanoid: () => 'test-id' }));

console.warn = jest.fn();
console.error = jest.fn();

interface Harness {
  store: Record<string, unknown>;
  gets: string[];
  sets: Array<Record<string, unknown>>;
}

function installChrome(initial: Record<string, unknown> = {}): Harness {
  const h: Harness = { store: { ...initial }, gets: [], sets: [] };
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
          h.sets.push(obj);
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

// What the VERY first store write persists: the deterministic default state
// (mock project included), captured before any test mutates the store.
const baseState = useAppStore.getState();
const firstWriteEnvelope = (): string =>
  JSON.stringify({ state: partializeAppState(baseState), version: 1 });

const envelopeWith = (
  mutate: (state: Record<string, unknown>) => void
): string => {
  const parsed = JSON.parse(firstWriteEnvelope()) as {
    state: Record<string, unknown>;
  };
  mutate(parsed.state);
  return JSON.stringify(parsed);
};

const userProjectEnvelope = (): string =>
  envelopeWith((state) => {
    const [defaultProject] = state.projects as Array<Record<string, unknown>>;
    state.projects = [
      { ...defaultProject, id: 'user-created-1', name: 'Mine' },
    ];
  });

const deletedDefaultsEnvelope = (): string =>
  envelopeWith((state) => {
    state.projects = [];
  });

const completedFlagEnvelope = (): string =>
  envelopeWith((state) => {
    state.hasCompletedOnboarding = true;
  });

describe('onboarding migration marker', () => {
  beforeEach(() => {
    resetOnboardingMigrationForTests();
  });

  it('classifies a user with no marker and no persisted state as fresh', async () => {
    const h = installChrome();

    await expect(resolveOnboardingMigration()).resolves.toEqual({
      upgrading: false,
    });

    expect(h.store[ONBOARDING_MIGRATION_STORAGE_KEY]).toBe('fresh');
  });

  it('a first store write (defaults-only blob) does not classify as upgrading', async () => {
    const h = installChrome({ [APP_STATE_STORAGE_KEY]: firstWriteEnvelope() });

    await expect(resolveOnboardingMigration()).resolves.toEqual({
      upgrading: false,
    });

    expect(h.store[ONBOARDING_MIGRATION_STORAGE_KEY]).toBe('fresh');
  });

  it('classifies real prior usage (user-created content) as upgrading', async () => {
    const h = installChrome({
      [APP_STATE_STORAGE_KEY]: userProjectEnvelope(),
    });

    await expect(resolveOnboardingMigration()).resolves.toEqual({
      upgrading: true,
    });

    expect(h.store[ONBOARDING_MIGRATION_STORAGE_KEY]).toBe('upgrading');
  });

  it('classifies deleted default content as upgrading (proof of prior usage)', async () => {
    const h = installChrome({
      [APP_STATE_STORAGE_KEY]: deletedDefaultsEnvelope(),
    });

    await expect(resolveOnboardingMigration()).resolves.toEqual({
      upgrading: true,
    });
    expect(h.store[ONBOARDING_MIGRATION_STORAGE_KEY]).toBe('upgrading');
  });

  it('classifies an explicit completed flag in the blob as upgrading', async () => {
    installChrome({ [APP_STATE_STORAGE_KEY]: completedFlagEnvelope() });

    await expect(resolveOnboardingMigration()).resolves.toEqual({
      upgrading: true,
    });
  });

  it('never revisits an upgrading decision (marker present, nothing rewritten)', async () => {
    const h = installChrome({
      [ONBOARDING_MIGRATION_STORAGE_KEY]: 'upgrading',
      [APP_STATE_STORAGE_KEY]: firstWriteEnvelope(),
    });

    await expect(resolveOnboardingMigration()).resolves.toEqual({
      upgrading: true,
    });

    expect(h.sets).toHaveLength(0);
    expect(h.gets).toEqual([ONBOARDING_MIGRATION_STORAGE_KEY]);
    expect(h.store[ONBOARDING_MIGRATION_STORAGE_KEY]).toBe('upgrading');
  });

  it('a recorded fresh decision is never re-classified', async () => {
    const h = installChrome({
      [ONBOARDING_MIGRATION_STORAGE_KEY]: 'fresh',
      [APP_STATE_STORAGE_KEY]: userProjectEnvelope(),
    });

    await expect(resolveOnboardingMigration()).resolves.toEqual({
      upgrading: false,
    });

    expect(h.sets).toHaveLength(0);
  });

  it('resolves once per session: repeated calls reuse the cached decision', async () => {
    const h = installChrome();

    const first = await resolveOnboardingMigration();
    const second = await resolveOnboardingMigration();

    expect(second).toEqual(first);
    // Exactly one decision run: marker read + blob read, one marker write.
    expect(h.gets).toEqual([
      ONBOARDING_MIGRATION_STORAGE_KEY,
      APP_STATE_STORAGE_KEY,
    ]);
    expect(h.sets).toHaveLength(1);
  });

  it('behaves fresh without any chrome storage (non-extension context)', async () => {
    (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
    resetOnboardingMigrationForTests();

    await expect(resolveOnboardingMigration()).resolves.toEqual({
      upgrading: false,
    });
  });
});
