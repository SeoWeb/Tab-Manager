'use client';

import * as React from 'react';
import { Cloud, AlertCircle, ArrowLeft, RefreshCw, Mail } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppStore } from '@/stores/appStore';
import { useToast } from '@/hooks/use-toast';
import {
  requestLoginCode,
  verifyAndConnect,
} from '@/lib/cloudflareSync/orchestrator';
import type { CloudAccount } from '@/lib/cloudflareSync';
import { PinInput } from '@/components/auth/PinInput';

export interface CloudSyncLoginFormProps {
  /** Called after a successful verification (e.g. to close a dialog). */
  onConnected?: (account: CloudAccount) => void;
  /** Called when the user cancels the flow. */
  onCancel?: () => void;
  /** Hide the descriptive header text (useful inside a compact settings card). */
  compact?: boolean;
}

const RESEND_COOLDOWN_MS = 30_000;

/**
 * Two-step email sign-in shared by the connect modal and the settings panel.
 *
 *   1. email + (optional) name → `requestLoginCode` emails an 8-digit code.
 *   2. the 8-digit code → `verifyAndConnect` exchanges it for a JWT.
 */
export function CloudSyncLoginForm({
  onConnected,
  onCancel,
  compact,
}: CloudSyncLoginFormProps) {
  const apiBaseUrl = useAppStore((state) => state.cloudSync.apiBaseUrl);
  const { toast } = useToast();

  const [step, setStep] = React.useState<'email' | 'code'>('email');
  const [email, setEmail] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resendIn, setResendIn] = React.useState(0);

  const canSubmitEmail =
    !busy &&
    !!apiBaseUrl?.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canVerify = !busy && code.length === 8;

  const startResendCooldown = React.useCallback(() => {
    setResendIn(RESEND_COOLDOWN_MS);
    const started = Date.now();
    const timer = setInterval(() => {
      const remaining = RESEND_COOLDOWN_MS - (Date.now() - started);
      if (remaining <= 0) {
        setResendIn(0);
        clearInterval(timer);
      } else {
        setResendIn(remaining);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleSendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestLoginCode({
        apiBaseUrl: apiBaseUrl ?? '',
        email: email.trim(),
        displayName: displayName.trim() || undefined,
      });
      setStep('code');
      startResendCooldown();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code');
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    setBusy(true);
    setError(null);
    try {
      const account = await verifyAndConnect({
        email: email.trim(),
        code,
      });
      toast({
        title: 'Signed in',
        description: 'You can now sync projects with the cloud.',
      });
      onConnected?.(account);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Incorrect or expired code'
      );
      // Wipe the bad code so the user re-enters it cleanly.
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    if (resendIn > 0) return;
    setBusy(true);
    setError(null);
    try {
      await requestLoginCode({
        apiBaseUrl: apiBaseUrl ?? '',
        email: email.trim(),
        displayName: displayName.trim() || undefined,
      });
      setCode('');
      startResendCooldown();
      toast({
        title: 'Code resent',
        description: `We sent a fresh code to ${email.trim()}.`,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not resend the code'
      );
    } finally {
      setBusy(false);
    }
  };

  if (step === 'email') {
    return (
      <div className='space-y-3'>
        {!compact && (
          <p className='text-sm text-muted-foreground'>
            We&apos;ll email you a one-time code. Pop it in and you&apos;re in —
            no password needed.
          </p>
        )}
        <div className='grid gap-2'>
          <div className='space-y-1'>
            <Label htmlFor='login-email'>Email</Label>
            <Input
              id='login-email'
              type='email'
              placeholder='you@example.com'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='login-name'>Display name (optional)</Label>
            <Input
              id='login-name'
              placeholder='Your name'
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={busy}
            />
          </div>
        </div>

        {error && (
          <p className='flex items-center gap-1.5 text-sm text-destructive'>
            <AlertCircle className='h-4 w-4' />
            {error}
          </p>
        )}

        <div className='flex gap-2'>
          {onCancel && (
            <Button
              type='button'
              variant='outline'
              onClick={onCancel}
              disabled={busy}
              className='shrink-0'
            >
              Cancel
            </Button>
          )}
          <Button
            type='button'
            onClick={handleSendCode}
            disabled={!canSubmitEmail}
            className='w-full'
          >
            <Mail className='mr-2 h-4 w-4' />
            {busy ? 'Sending…' : 'Send me a code'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className='space-y-3'>
      {!compact && (
        <p className='text-sm text-muted-foreground'>
          We sent an 8-digit code to{' '}
          <span className='font-medium'>{email}</span>. It&apos;s good for about
          10 minutes.
        </p>
      )}

      <PinInput
        value={code}
        onChange={setCode}
        onComplete={() => {
          if (canVerify) void handleVerify();
        }}
        disabled={busy}
        autoFocus
        aria-label='Login code'
      />

      {error && (
        <p className='flex items-center gap-1.5 text-sm text-destructive'>
          <AlertCircle className='h-4 w-4' />
          {error}
        </p>
      )}

      <Button
        type='button'
        onClick={handleVerify}
        disabled={!canVerify}
        className='w-full'
      >
        <Cloud className='mr-2 h-4 w-4' />
        {busy ? 'Verifying…' : 'Verify & sign in'}
      </Button>

      <div className='flex items-center justify-between'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={() => {
            setStep('email');
            setCode('');
            setError(null);
          }}
          disabled={busy}
        >
          <ArrowLeft className='mr-1.5 h-4 w-4' />
          Change email
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={handleResend}
          disabled={busy || resendIn > 0}
        >
          <RefreshCw className='mr-1.5 h-4 w-4' />
          {resendIn > 0
            ? `Resend in ${Math.ceil(resendIn / 1000)}s`
            : 'Resend code'}
        </Button>
      </div>
    </div>
  );
}

export default CloudSyncLoginForm;
