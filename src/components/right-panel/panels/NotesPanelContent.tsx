'use client';

import { useAppStoreWithDefaults } from '@/hooks/useAppStoreWithDefaults';
import { Textarea } from '@/components/ui/textarea';

export default function NotesPanelContent() {
  const notes = useAppStoreWithDefaults((state) => state.notes, '');
  const updateNotes = useAppStoreWithDefaults(
    (state) => state.updateNotes,
    () => {}
  );

  return (
    <div className='space-y-4'>
      <h3 className='text-lg font-semibold text-foreground'>Scratchpad</h3>
      <Textarea
        placeholder='Jot down your thoughts here...'
        value={notes}
        onChange={(e) => updateNotes(e.target.value)}
        className='min-h-[200px] text-sm'
        aria-label='Notes scratchpad'
      />
      <p className='text-xs text-muted-foreground'>
        Your notes are saved automatically.
      </p>
    </div>
  );
}
