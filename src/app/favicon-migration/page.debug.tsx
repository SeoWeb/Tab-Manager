'use client';

import { useState } from 'react';
import { FaviconMigrationButton } from '@/components/FaviconMigrationButton';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { resetMigrationFlag } from '@/lib/faviconMigration';

export default function FaviconMigrationPage() {
  const [isResettingFlag, setIsResettingFlag] = useState(false);

  const handleResetMigrationFlag = async () => {
    setIsResettingFlag(true);
    try {
      await resetMigrationFlag();
      alert(
        'Migration flag reset successfully. You can now run the migration again.'
      );
      // Reload the page to refresh the migration button state
      window.location.reload();
    } catch (error) {
      console.error('Failed to reset migration flag:', error);
      alert(
        'Failed to reset migration flag. Please check the console for details.'
      );
    } finally {
      setIsResettingFlag(false);
    }
  };

  return (
    <div className='container mx-auto py-8'>
      <div className='max-w-2xl mx-auto space-y-6'>
        <div className='space-y-2'>
          <h1 className='text-3xl font-bold tracking-tight'>
            Favicon Migration
          </h1>
          <p className='text-muted-foreground'>
            Update all existing favicons with the improved service for better
            quality and reliability.
          </p>
        </div>

        <FaviconMigrationButton />

        <div className='flex gap-2 mt-6'>
          <Button
            variant='outline'
            onClick={handleResetMigrationFlag}
            disabled={isResettingFlag}
            className='flex items-center gap-2'
          >
            <RotateCcw
              className={`h-4 w-4 ${isResettingFlag ? 'animate-spin' : ''}`}
            />
            Reset Migration Flag
          </Button>
          <Link href='/'>
            <Button variant='secondary' className='flex items-center gap-2'>
              <ArrowLeft className='h-4 w-4' />
              Back to App
            </Button>
          </Link>
        </div>

        <div className='space-y-4'>
          <h2 className='text-xl font-semibold'>About This Migration</h2>
          <div className='space-y-2 text-sm text-muted-foreground'>
            <p>
              The favicon migration updates all your saved link favicons using
              an improved service that:
            </p>
            <ul className='list-disc pl-6 space-y-1'>
              <li>
                Prioritizes high-quality favicons from the Chrome tabs API
              </li>
              <li>Implements better caching with 30-day expiration</li>
              <li>Preserves tab favicons when dragging tabs to collections</li>
              <li>Provides more reliable fallback mechanisms</li>
            </ul>
            <p>
              This is a one-time migration that will improve the quality of all
              your existing favicons. After running, all new favicons will
              automatically use the improved service.
            </p>
            <div className='mt-4 p-3 bg-amber-50 border border-amber-200 rounded-md'>
              <p className='text-sm text-amber-800'>
                <strong>Troubleshooting:</strong> If favicons are not displaying
                after migration, try clicking the &quot;Reset Migration
                Flag&quot; button and run the migration again.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
