'use client';

import { useAppStore } from '@/stores/appStore';
import { useShallow } from 'zustand/react/shallow';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { CloudSyncSettingsPanel } from '@/components/cloud-sync/CloudSyncSettingsPanel';
import { CloudSyncMyProjectsCard } from '@/components/cloud-sync/CloudSyncMyProjectsCard';
import { CloudSyncInvitesCard } from '@/components/cloud-sync/CloudSyncInvitesCard';
import { useSidebarState } from '@/hooks/useSidebarState';
import { Menu, GraduationCap } from 'lucide-react';

export default function SettingsView() {
  const {
    themeColor,
    setThemeColor,
    isDarkMode,
    toggleDarkMode,
    hasHydrated,
    openOnboarding,
  } = useAppStore(
    useShallow((state) => ({
      themeColor: state.themeColor,
      setThemeColor: state.setThemeColor,
      isDarkMode: state.isDarkMode,
      toggleDarkMode: state.toggleDarkMode,
      hasHydrated: state._hasHydrated,
      openOnboarding: state.openOnboarding,
    }))
  );
  const { toggleSidebar } = useSidebarState();

  return (
    <div className='h-full flex flex-col bg-background'>
      <header className='flex items-center justify-between p-4 border-b border-border gap-3 shrink-0'>
        <div className='flex items-center gap-2 min-w-0'>
          <Button
            variant='ghost'
            size='icon'
            onClick={toggleSidebar}
            className='md:hidden h-8 w-8 shrink-0'
            aria-label='Toggle sidebar'
          >
            <Menu className='h-5 w-5' />
          </Button>
          <h1 className='text-xl md:text-2xl font-semibold text-foreground truncate'>
            Settings
          </h1>
        </div>
      </header>
      <div className='flex-grow p-4 md:p-8 overflow-y-auto'>
        <div className='mx-auto w-full max-w-3xl space-y-6'>
          <div>
            <Label htmlFor='theme-color'>Theme Color</Label>
            <Input
              id='theme-color'
              type='color'
              value={themeColor}
              onChange={(e) => setThemeColor(e.target.value)}
              className='w-24'
            />
          </div>

          <div>
            <Label htmlFor='dark-mode'>Dark Mode</Label>
            <p className='text-sm text-muted-foreground mb-2'>
              Switch between light and dark appearance.
            </p>
            <Switch
              id='dark-mode'
              checked={isDarkMode}
              onCheckedChange={toggleDarkMode}
              disabled={!hasHydrated}
            />
          </div>

          {/* Debug-only dev tooling: /favicon-migration is excluded from
              production builds (see next.config.ts pageExtensions). The env
              var is inlined at build time, so this whole block is
              dead-code-eliminated from the bundle when the flag is unset. */}
          {process.env.INCLUDE_DEBUG_ROUTES === '1' && (
            <div>
              <Label className='text-base font-medium'>
                Favicon Management
              </Label>
              <p className='text-sm text-muted-foreground mb-2'>
                Update all existing favicons with improved quality and caching.
              </p>
              <Button asChild variant='outline'>
                <Link href='/favicon-migration'>Update Favicons</Link>
              </Button>
            </div>
          )}

          <CloudSyncSettingsPanel />
          <CloudSyncMyProjectsCard />
          <CloudSyncInvitesCard />

          <div>
            <Label className='text-base font-medium'>Tutorial</Label>
            <p className='text-sm text-muted-foreground mb-2'>
              Replay the guided tour that explains Projects, Collections, and
              Links.
            </p>
            <Button variant='outline' onClick={openOnboarding}>
              <GraduationCap className='mr-2 h-4 w-4' />
              Show onboarding
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
