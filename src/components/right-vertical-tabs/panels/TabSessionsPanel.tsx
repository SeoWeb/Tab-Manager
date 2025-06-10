/**
 * Tab Sessions Panel Component
 * Manages saving and restoring tab sessions
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Save,
  RotateCcw,
  Trash2,
  Clock,
  Monitor,
  Plus,
  Settings,
} from 'lucide-react';
import { useTabSessions } from '@/hooks/useTabSessions';
import type { TabSession } from '@/lib/tabSessionService';

export const TabSessionsPanel: React.FC = () => {
  const {
    sessions,
    isLoading,
    autoSaveEnabled,
    setAutoSaveEnabled,
    saveSession,
    restoreSession,
    deleteSession,
    loadSessions,
  } = useTabSessions();

  const [newSessionName, setNewSessionName] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);

  const handleSaveSession = async () => {
    if (!newSessionName.trim()) {
      return;
    }

    const success = await saveSession(newSessionName.trim());
    if (success) {
      setNewSessionName('');
      setShowSaveForm(false);
    }
  };

  const handleQuickSave = async () => {
    await saveSession();
  };

  const handleRestoreSession = async (sessionId: string) => {
    await restoreSession(sessionId);
  };

  const handleDeleteSession = async (sessionId: string) => {
    await deleteSession(sessionId);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatTimeAgo = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  return (
    <div className='flex flex-col h-full'>
      {/* Header */}
      <div className='px-4 py-3 border-b border-border'>
        <h2 className='text-xl font-semibold text-foreground flex items-center gap-2'>
          <Save className='h-5 w-5' />
          Tab Sessions
        </h2>
        <p className='text-sm text-muted-foreground mt-1'>
          Save and restore your tab sessions
        </p>
      </div>

      <ScrollArea className='flex-1'>
        <div className='p-4 space-y-4'>
          {/* Auto-save Settings */}
          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='text-sm flex items-center gap-2'>
                <Settings className='h-4 w-4' />
                Settings
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              <div className='flex items-center justify-between'>
                <Label htmlFor='auto-save' className='text-sm'>
                  Auto-save sessions
                </Label>
                <Switch
                  id='auto-save'
                  checked={autoSaveEnabled}
                  onCheckedChange={setAutoSaveEnabled}
                />
              </div>
              <p className='text-xs text-muted-foreground'>
                Automatically saves your current tabs every 30 seconds and
                restores them when you restart Chrome.
              </p>
            </CardContent>
          </Card>

          {/* Save Current Session */}
          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='text-sm'>Save Current Session</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              {!showSaveForm ? (
                <div className='space-y-2'>
                  <Button
                    onClick={handleQuickSave}
                    disabled={isLoading}
                    className='w-full'
                    size='sm'
                  >
                    <Save className='h-4 w-4 mr-2' />
                    Quick Save
                  </Button>
                  <Button
                    onClick={() => setShowSaveForm(true)}
                    variant='outline'
                    className='w-full'
                    size='sm'
                  >
                    <Plus className='h-4 w-4 mr-2' />
                    Save with Name
                  </Button>
                </div>
              ) : (
                <div className='space-y-2'>
                  <Input
                    placeholder='Session name...'
                    value={newSessionName}
                    onChange={(e) => setNewSessionName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSaveSession();
                      } else if (e.key === 'Escape') {
                        setShowSaveForm(false);
                        setNewSessionName('');
                      }
                    }}
                    autoFocus
                  />
                  <div className='flex gap-2'>
                    <Button
                      onClick={handleSaveSession}
                      disabled={isLoading || !newSessionName.trim()}
                      size='sm'
                      className='flex-1'
                    >
                      Save
                    </Button>
                    <Button
                      onClick={() => {
                        setShowSaveForm(false);
                        setNewSessionName('');
                      }}
                      variant='outline'
                      size='sm'
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Separator />

          {/* Saved Sessions */}
          <div>
            <div className='flex items-center justify-between mb-3'>
              <h3 className='text-sm font-medium'>Saved Sessions</h3>
              <Button
                onClick={loadSessions}
                variant='ghost'
                size='sm'
                disabled={isLoading}
              >
                <RotateCcw className='h-4 w-4' />
              </Button>
            </div>

            {isLoading ? (
              <div className='text-center py-8'>
                <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto'></div>
                <p className='text-sm text-muted-foreground mt-2'>
                  Loading sessions...
                </p>
              </div>
            ) : sessions.length === 0 ? (
              <div className='text-center py-8'>
                <Save className='h-12 w-12 text-muted-foreground mx-auto mb-3' />
                <p className='text-sm text-muted-foreground'>
                  No saved sessions
                </p>
                <p className='text-xs text-muted-foreground mt-1'>
                  Save your current tabs to get started
                </p>
              </div>
            ) : (
              <div className='space-y-3'>
                {sessions
                  .sort((a, b) => b.timestamp - a.timestamp)
                  .map((session) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      onRestore={() => handleRestoreSession(session.id)}
                      onDelete={() => handleDeleteSession(session.id)}
                      formatDate={formatDate}
                      formatTimeAgo={formatTimeAgo}
                      isLoading={isLoading}
                    />
                  ))}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};

interface SessionCardProps {
  session: TabSession;
  onRestore: () => void;
  onDelete: () => void;
  formatDate: (timestamp: number) => string;
  formatTimeAgo: (timestamp: number) => string;
  isLoading: boolean;
}

const SessionCard: React.FC<SessionCardProps> = ({
  session,
  onRestore,
  onDelete,
  formatDate,
  formatTimeAgo,
  isLoading,
}) => {
  return (
    <Card className='p-3'>
      <div className='space-y-2'>
        <div className='flex items-start justify-between'>
          <div className='flex-1 min-w-0'>
            <h4 className='text-sm font-medium truncate'>{session.name}</h4>
            <div className='flex items-center gap-2 mt-1'>
              <Badge variant='secondary' className='text-xs'>
                <Monitor className='h-3 w-3 mr-1' />
                {session.totalTabs} tabs
              </Badge>
              <Badge variant='outline' className='text-xs'>
                <Clock className='h-3 w-3 mr-1' />
                {formatTimeAgo(session.timestamp)}
              </Badge>
            </div>
          </div>
        </div>

        <p className='text-xs text-muted-foreground'>
          {formatDate(session.timestamp)}
        </p>

        <div className='flex gap-2'>
          <Button
            onClick={onRestore}
            disabled={isLoading}
            size='sm'
            className='flex-1'
          >
            <RotateCcw className='h-3 w-3 mr-1' />
            Restore
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant='outline' size='sm' disabled={isLoading}>
                <Trash2 className='h-3 w-3' />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Session</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete &quot;{session.name}&quot;?
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </Card>
  );
};
