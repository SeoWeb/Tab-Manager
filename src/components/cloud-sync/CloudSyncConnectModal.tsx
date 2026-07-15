'use client';

import { useState } from 'react';
import { Cloud, AlertCircle, LogIn } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppStore } from '@/stores/appStore';
import { useToast } from '@/hooks/use-toast';
import { connectCloudAccount } from '@/lib/cloudflareSync/orchestrator';

interface CloudSyncConnectModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful connection (e.g. to convert/创建 the project). */
  onConnected?: () => void;
  title?: string;
  description?: string;
}

export function CloudSyncConnectModal({
  isOpen,
  onOpenChange,
  onConnected,
  title = 'Connect to Cloud Sync',
  description = 'Sign in or create an account to sync this project with the cloud. Your data stays on the Cloudflare Worker you configured.',
}: CloudSyncConnectModalProps) {
  const apiBaseUrl = useAppStore((state) => state.cloudSync.apiBaseUrl);
  const { toast } = useToast();

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleConnect = async () => {
    setBusy(true);
    setFormError(null);
    try {
      await connectCloudAccount({
        apiBaseUrl: apiBaseUrl ?? '',
        email,
        displayName: displayName.trim() || undefined,
      });
      toast({
        title: 'Connected to cloud',
        description: 'You can now sync projects with the cloud.',
      });
      onConnected?.();
      onOpenChange(false);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Failed to connect'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[425px]'>
        <DialogHeader>
          <div className='flex items-center gap-2'>
            <Cloud className='h-5 w-5 text-muted-foreground' />
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div className='grid gap-2'>
            <div className='space-y-1'>
              <Label htmlFor='connect-cloud-email'>Email</Label>
              <Input
                id='connect-cloud-email'
                type='email'
                placeholder='you@example.com'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='connect-cloud-name'>
                Display name (optional)
              </Label>
              <Input
                id='connect-cloud-name'
                placeholder='Your name'
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>

          {formError && (
            <p className='flex items-center gap-1.5 text-sm text-destructive'>
              <AlertCircle className='h-4 w-4' />
              {formError}
            </p>
          )}

          <Button
            onClick={handleConnect}
            disabled={busy || !apiBaseUrl?.trim() || !email.trim()}
            className='w-full'
          >
            <LogIn className='mr-2 h-4 w-4' />
            {busy ? 'Connecting…' : 'Sign in / Create account'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CloudSyncConnectModal;
