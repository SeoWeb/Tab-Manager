import React from 'react';
import { Button } from '@/components/ui/button';
import { SunIcon, MoonIcon } from 'lucide-react';
import {
  useIsDarkMode,
  useToggleDarkMode,
  useHasHydrated,
} from '@/hooks/useAppStoreWithDefaults';

const ThemeToggle: React.FC = () => {
  const isDarkMode = useIsDarkMode();
  const toggleDarkMode = useToggleDarkMode();
  const _hasHydrated = useHasHydrated();

  // Don't render until hydrated to prevent hydration mismatches
  if (!_hasHydrated) {
    return (
      <Button variant='ghost' size='icon' disabled>
        <MoonIcon className='h-5 w-5' />
      </Button>
    );
  }

  return (
    <Button
      variant='ghost'
      size='icon'
      onClick={toggleDarkMode}
      aria-label={`Switch to ${isDarkMode ? 'light' : 'dark'} mode`}
    >
      {isDarkMode ? (
        <SunIcon className='h-5 w-5' />
      ) : (
        <MoonIcon className='h-5 w-5' />
      )}
    </Button>
  );
};

export default ThemeToggle;
