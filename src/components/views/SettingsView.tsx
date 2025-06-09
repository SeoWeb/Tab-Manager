'use client';

import { useAppStore } from '@/stores/appStore';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

export default function SettingsView() {
  const { themeColor, setThemeColor } = useAppStore((state) => ({
    themeColor: state.themeColor,
    setThemeColor: state.setThemeColor,
  }));

  return (
    <div className='p-8'>
      <h1 className='text-2xl font-bold mb-4'>Settings</h1>
      <div className='space-y-4'>
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
      </div>
    </div>
  );
}
