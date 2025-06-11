import { StoreWrapper } from '@/stores/storeWrapper';
import AppClientWrapper from '@/components/AppClientWrapper';

export default function Home() {
  return (
    <StoreWrapper>
      <AppClientWrapper />
    </StoreWrapper>
  );
}
