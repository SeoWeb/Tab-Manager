import { useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';

export function useSidebarState(defaultOpen: boolean = false) {
  const {
    isSidebarOpen: open,
    isSidebarLoaded: isLoaded,
    setSidebarOpen: setOpen,
    toggleSidebar,
    initializeSidebarState,
  } = useAppStore();

  // Initialize sidebar state from Chrome storage on mount
  useEffect(() => {
    if (!isLoaded) {
      initializeSidebarState(defaultOpen);
    }
  }, [isLoaded, initializeSidebarState, defaultOpen]);

  return {
    open,
    setOpen,
    toggleSidebar,
    isLoaded,
  };
}
