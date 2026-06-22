import { StoreWrapper } from '@/stores/storeWrapper';
import AppClientWrapper from '@/components/AppClientWrapper';

// Same shape as the extension entry: StoreWrapper (shadowed — awaits idb
// rehydration) wraps the dynamically-imported AppClient (also shadowed — skips
// extension-only init and wires the in-app cloud-sync interval).
export default function Home() {
  return (
    <StoreWrapper>
      <AppClientWrapper />
    </StoreWrapper>
  );
}
