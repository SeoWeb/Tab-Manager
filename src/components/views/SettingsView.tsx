'use client';

import { useAppStore } from '@/stores/appStore';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { CloudSyncSettingsPanel } from '@/components/cloud-sync/CloudSyncSettingsPanel';
import { CloudSyncInvitesCard } from '@/components/cloud-sync/CloudSyncInvitesCard';

export default function SettingsView() {
  const { themeColor, setThemeColor } = useAppStore((state) => ({
    themeColor: state.themeColor,
    setThemeColor: state.setThemeColor,
  }));

  return (
    <div className='p-8'>
      <h1 className='text-2xl font-bold mb-4'>Settings</h1>
      <div className='space-y-6'>
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
          <Label className='text-base font-medium'>Favicon Management</Label>
          <p className='text-sm text-muted-foreground mb-2'>
            Update all existing favicons with improved quality and caching.
          </p>
          <Button asChild variant='outline'>
            <Link href='/favicon-migration'>Update Favicons</Link>
          </Button>
        </div>

        <CloudSyncSettingsPanel />
        <CloudSyncInvitesCard />
      </div>
    </div>
  );
}
