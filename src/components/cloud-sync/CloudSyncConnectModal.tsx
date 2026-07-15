'use client';

import { Cloud } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAppStore } from '@/stores/appStore';
import { CloudSyncLoginForm } from './CloudSyncLoginForm';

interface CloudSyncConnectModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful connection (e.g. to convert/create the project). */
  onConnected?: () => void;
  title?: string;
  description?: string;
}

export function CloudSyncConnectModal({
  isOpen,
  onOpenChange,
  onConnected,
  title = 'Connect to Cloud Sync',
  description = 'Sign in with your email to sync this project with the cloud. Your data stays on the Cloudflare Worker you configured.',
}: CloudSyncConnectModalProps) {
  const apiBaseUrl = useAppStore((state) => state.cloudSync.apiBaseUrl);

  const handleConnected = () => {
    onConnected?.();
    onOpenChange(false);
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

        {!apiBaseUrl?.trim() ? (
          <p className='text-sm text-destructive'>
            Set your cloud sync API URL in Settings before signing in.
          </p>
        ) : (
          <CloudSyncLoginForm
            onConnected={handleConnected}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export default CloudSyncConnectModal;
