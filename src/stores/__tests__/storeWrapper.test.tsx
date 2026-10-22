import { act, render, screen } from '@testing-library/react';
import { useAppStore } from '@/stores/appStore';
import { StoreWrapper, useStoreWrapper } from '@/stores/storeWrapper';

// The store's action modules import `nanoid`, whose browser build is ESM and
// unparseable by jest; stub it with a deterministic implementation.
jest.mock('nanoid', () => ({
  nanoid: () => 'test-id',
}));

// The store module starts a real persist hydrate on import; mock the storage
// adapter with a `getItem` that never resolves so hydration only happens when
// a test explicitly forces `_hasHydrated`, keeping ordering deterministic.
jest.mock('@tabspace/shared/stores/storage', () => ({
  chromeStorageApi: {
    getItem: () => new Promise(() => {}),
    setItem: async () => {},
    removeItem: async () => {},
  },
}));

describe('StoreWrapper hydration gate', () => {
  beforeEach(() => {
    useAppStore.setState({ _hasHydrated: false });
  });

  it('does not render children before the store has hydrated', () => {
    render(
      <StoreWrapper>
        <div>READY</div>
      </StoreWrapper>
    );

    expect(screen.queryByText('READY')).not.toBeInTheDocument();
  });

  it('renders children once hydration completes', () => {
    render(
      <StoreWrapper>
        <div>READY</div>
      </StoreWrapper>
    );

    expect(screen.queryByText('READY')).not.toBeInTheDocument();

    act(() => {
      useAppStore.setState({ _hasHydrated: true });
    });

    expect(screen.getByText('READY')).toBeInTheDocument();
  });

  it('exposes isHydrated true through the context hook after hydration', () => {
    let contextValue: { isHydrated: boolean } | undefined;

    const Probe = () => {
      contextValue = useStoreWrapper();
      return null;
    };

    render(
      <StoreWrapper>
        <Probe />
      </StoreWrapper>
    );

    act(() => {
      useAppStore.setState({ _hasHydrated: true });
    });

    expect(contextValue).toEqual({ isHydrated: true });
  });
});
