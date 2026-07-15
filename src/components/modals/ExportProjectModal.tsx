'use client';

import React, { useState } from 'react';
import ModalWrapper from '@/components/shared/ModalWrapper';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Project } from '@/types';
import { exportProject } from '@/lib/importExport/exportProject';
import { ExportFormat, ExportSelection } from '@/lib/importExport/types';

interface ExportProjectModalProps {
  project: Project;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const FORMATS: { value: ExportFormat; label: string; hint: string }[] = [
  { value: 'json', label: 'JSON', hint: 'Structured, re-importable' },
  { value: 'csv', label: 'CSV', hint: 'Flat spreadsheet data' },
  { value: 'html', label: 'HTML', hint: 'Read-only report' },
];

const SECTIONS: { key: keyof ExportSelection; label: string }[] = [
  { key: 'collections', label: 'Collections & Links' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'todos', label: 'Todos' },
  { key: 'notes', label: 'Notes' },
];

const ExportProjectModal: React.FC<ExportProjectModalProps> = ({
  project,
  isOpen,
  onOpenChange,
}) => {
  const { toast } = useToast();
  const [selection, setSelection] = useState<ExportSelection>({
    collections: true,
    tasks: true,
    todos: true,
    notes: true,
  });
  const [format, setFormat] = useState<ExportFormat>('json');

  const anySelected =
    selection.collections ||
    selection.tasks ||
    selection.todos ||
    selection.notes;

  const handleExport = () => {
    const ok = exportProject(project.id, format, selection);
    if (ok) {
      toast({
        title: 'Export ready',
        description: `'${project.name}' was exported as ${format.toUpperCase()}.`,
      });
      onOpenChange(false);
    } else {
      toast({
        title: 'Nothing to export',
        description: 'Select at least one section to export.',
        variant: 'destructive',
      });
    }
  };

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={() => onOpenChange(false)}
      title={`Export “${project.name}”`}
      description='Choose what to include and the file format.'
    >
      <div className='space-y-4'>
        <div>
          <p className='mb-2 text-sm font-medium'>Sections</p>
          <div className='space-y-2'>
            {SECTIONS.map((s) => (
              <div key={s.key} className='flex items-center space-x-2'>
                <Checkbox
                  id={`export-${s.key}`}
                  checked={selection[s.key]}
                  onCheckedChange={(checked) =>
                    setSelection((prev) => ({
                      ...prev,
                      [s.key]: checked === true,
                    }))
                  }
                />
                <Label htmlFor={`export-${s.key}`}>{s.label}</Label>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className='mb-2 text-sm font-medium'>Format</p>
          <div className='grid grid-cols-3 gap-2'>
            {FORMATS.map((f) => (
              <button
                key={f.value}
                type='button'
                onClick={() => setFormat(f.value)}
                className={`rounded-md border p-3 text-left transition-colors ${
                  format === f.value
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:bg-muted'
                }`}
              >
                <div className='text-sm font-semibold'>{f.label}</div>
                <div className='text-xs text-muted-foreground'>{f.hint}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className='mt-6 flex justify-end gap-2'>
        <Button variant='outline' onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={handleExport} disabled={!anySelected}>
          Export {format.toUpperCase()}
        </Button>
      </div>
    </ModalWrapper>
  );
};

export default ExportProjectModal;
