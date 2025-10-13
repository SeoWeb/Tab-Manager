'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, RefreshCw, CheckCircle } from 'lucide-react';
import {
  runFaviconMigrationIfNeeded,
  isMigrationComplete,
  type MigrationResult,
} from '@/lib/faviconMigration';

interface FaviconMigrationButtonProps {
  className?: string;
}

export function FaviconMigrationButton({
  className,
}: FaviconMigrationButtonProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasRunBefore, setHasRunBefore] = useState<boolean | null>(null);

  React.useEffect(() => {
    // Check if migration has already been run
    const checkMigrationStatus = async () => {
      try {
        const completed = await isMigrationComplete();
        setHasRunBefore(completed);
      } catch (err) {
        console.error('Error checking migration status:', err);
      }
    };

    checkMigrationStatus();
  }, []);

  const handleRunMigration = async () => {
    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      const migrationResult = await runFaviconMigrationIfNeeded();

      if (migrationResult) {
        setResult(migrationResult);
        setHasRunBefore(true);
      } else {
        // Migration was already run before
        setHasRunBefore(true);
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('Migration error:', err);
    } finally {
      setIsRunning(false);
    }
  };

  if (hasRunBefore === null) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <RefreshCw className='h-5 w-5' />
            Favicon Migration
          </CardTitle>
          <CardDescription>Checking migration status...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className='flex items-center justify-center py-4'>
            <Loader2 className='h-6 w-6 animate-spin' />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (hasRunBefore) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-green-600'>
            <CheckCircle className='h-5 w-5' />
            Favicon Migration Complete
          </CardTitle>
          <CardDescription>
            All favicons have been updated with the improved service.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {result && (
            <div className='text-sm text-muted-foreground'>
              <p>Total links processed: {result.totalLinks}</p>
              <p>Links updated: {result.updatedLinks}</p>
              {result.errors.length > 0 && (
                <p className='text-amber-600'>
                  Errors encountered: {result.errors.length}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <RefreshCw className='h-5 w-5' />
          Favicon Migration
        </CardTitle>
        <CardDescription>
          Update all existing favicons with the improved service for better
          quality and reliability.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <p className='text-sm text-muted-foreground'>
          This one-time migration will update all your saved link favicons using
          the improved favicon service, which prioritizes high-quality favicons
          from the Chrome tabs API and implements better caching.
        </p>

        {error && (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {result && (
          <Alert>
            <AlertDescription>
              <div className='space-y-1'>
                <p>Migration completed successfully!</p>
                <div className='text-sm'>
                  <p>Total links processed: {result.totalLinks}</p>
                  <p>Links updated: {result.updatedLinks}</p>
                  {result.errors.length > 0 && (
                    <p className='text-amber-600'>
                      Errors encountered: {result.errors.length}
                    </p>
                  )}
                </div>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <Button
          onClick={handleRunMigration}
          disabled={isRunning}
          className='w-full'
        >
          {isRunning ? (
            <>
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              Running Migration...
            </>
          ) : (
            <>
              <RefreshCw className='mr-2 h-4 w-4' />
              Update All Favicons
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
