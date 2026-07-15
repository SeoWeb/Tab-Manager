'use client';

import React, { useMemo, useRef, useState } from 'react';
import ModalWrapper from '@/components/shared/ModalWrapper';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAppStore } from '@/stores/appStore';
import {
  parseBundle,
  previewImport,
  applyImport,
  getProjectChoices,
  type ImportOptions,
} from '@/lib/importExport/importProject';
import type { ParsedBundle } from '@/lib/importExport/schema';
import type { ImportPreview } from '@/lib/importExport/types';

interface ImportProjectModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

type Mode = 'new' | 'existing';

const ImportProjectModal: React.FC<ImportProjectModalProps> = ({
  isOpen,
  onOpenChange,
}) => {
  const { toast } = useToast();
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [bundle, setBundle] = useState<ParsedBundle | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('new');
  const [targetProjectId, setTargetProjectId] = useState<string>(
    activeProjectId ?? ''
  );
  const [busy, setBusy] = useState(false);

  const projects = useMemo(() => getProjectChoices(), []);

  const options: ImportOptions = useMemo(
    () => ({
      createNew: mode === 'new',
      targetProjectId: mode === 'existing' ? targetProjectId : null,
    }),
    [mode, targetProjectId]
  );

  const preview: ImportPreview | null = useMemo(
    () => (bundle ? previewImport(bundle, options) : null),
    [bundle, options]
  );

  const reset = () => {
    setBundle(null);
    setFileName('');
    setError('');
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setBundle(null);
    setFileName(file.name);
    const parsed = await parseBundle(file);
    if (!parsed) {
      setError(
        'Could not read this file. Make sure it is a valid project export (JSON).'
      );
      toast({
        title: 'Import failed',
        description: 'The selected file is not a valid export.',
        variant: 'destructive',
      });
      return;
    }
    setBundle(parsed);
  };

  const handleImport = () => {
    if (!bundle) return;
    setBusy(true);
    try {
      const result = applyImport(bundle, options);
      toast({
        title: 'Import complete',
        description: `${result.totalAdded} added, ${result.totalUpdated} updated, ${result.totalSkipped} skipped.`,
      });
      onOpenChange(false);
      reset();
    } catch (err) {
      toast({
        title: 'Import failed',
        description: err instanceof Error ? err.message : 'Unknown error.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const availableSections = bundle
    ? [
        {
          label: 'Collections & Links',
          count:
            bundle.project.collections.length +
            bundle.project.collections.reduce((s, c) => s + c.links.length, 0),
        },
        { label: 'Tasks', count: bundle.tasks.length },
        { label: 'Todos', count: bundle.todos.length },
        { label: 'Notes', count: bundle.notes.length },
      ]
    : [];

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={() => onOpenChange(false)}
      title='Import project data'
      description='Import merges data from a JSON export without removing anything already present.'
    >
      <div className='space-y-4'>
        <div>
          <input
            ref={fileInputRef}
            type='file'
            accept='application/json,.json'
            onChange={handleFile}
            className='hidden'
          />
          <Button
            variant='outline'
            onClick={() => fileInputRef.current?.click()}
          >
            {fileName ? `Selected: ${fileName}` : 'Choose JSON file…'}
          </Button>
          {error && <p className='mt-2 text-sm text-red-600'>{error}</p>}
        </div>

        {bundle && (
          <>
            <div className='rounded-md border p-3 text-sm'>
              <p className='font-medium'>File project: {bundle.project.name}</p>
              <ul className='mt-1 space-y-0.5 text-muted-foreground'>
                {availableSections.map((s) => (
                  <li key={s.label}>
                    {s.label}: {s.count}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className='mb-2 text-sm font-medium'>Import target</p>
              <div className='space-y-2'>
                <div className='flex items-center space-x-2'>
                  <Checkbox
                    id='target-new'
                    checked={mode === 'new'}
                    onCheckedChange={(c) => c && setMode('new')}
                  />
                  <Label htmlFor='target-new'>
                    New project (from this file)
                  </Label>
                </div>
                <div className='flex items-center space-x-2'>
                  <Checkbox
                    id='target-existing'
                    checked={mode === 'existing'}
                    onCheckedChange={(c) => c && setMode('existing')}
                  />
                  <Label htmlFor='target-existing'>Existing project</Label>
                </div>
                {mode === 'existing' && (
                  <Select
                    value={targetProjectId}
                    onValueChange={setTargetProjectId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder='Select project' />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            {preview && (
              <div className='rounded-md bg-muted p-3 text-sm'>
                <p className='font-medium'>Preview</p>
                <p className='text-muted-foreground'>
                  Target: {preview.project.name}
                </p>
                <div className='mt-1 grid grid-cols-3 gap-2'>
                  <span>
                    <strong className='text-green-600'>
                      {preview.totalAdded}
                    </strong>{' '}
                    added
                  </span>
                  <span>
                    <strong className='text-blue-600'>
                      {preview.totalUpdated}
                    </strong>{' '}
                    updated
                  </span>
                  <span>
                    <strong className='text-amber-600'>
                      {preview.totalSkipped}
                    </strong>{' '}
                    skipped
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className='mt-6 flex justify-end gap-2'>
        <Button variant='outline' onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={handleImport} disabled={!bundle || busy}>
          {busy ? 'Importing…' : 'Import'}
        </Button>
      </div>
    </ModalWrapper>
  );
};

export default ImportProjectModal;
