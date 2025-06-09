import AppClient from '@/components/AppClient';
import { StoreWrapper } from '@/stores/storeWrapper';

export default function Home() {
  return (
    <StoreWrapper>
      <AppClient />
    </StoreWrapper>
  );
}
