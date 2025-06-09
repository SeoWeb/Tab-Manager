'use client';

import { useState, useRef } from 'react';
import { useAppStoreWithDefaults } from '@/hooks/useAppStoreWithDefaults';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Bold, Italic, Underline } from 'lucide-react';

export default function NotesPanelContent() {
  const notes = useAppStoreWithDefaults((state) => state.notes, '');
  const updateNotes = useAppStoreWithDefaults(
    (state) => state.updateNotes,
    () => {}
  );
  const [searchQuery, setSearchQuery] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const getHighlightedText = (text: string, highlight: string) => {
    if (!highlight.trim()) {
      return <span>{text}</span>;
    }
    const parts = text.split(new RegExp(`(${highlight})`, 'gi'));
    return (
      <span>
        {parts.map((part, i) =>
          part.toLowerCase() === highlight.toLowerCase() ? (
            <mark key={i}>{part}</mark>
          ) : (
            part
          )
        )}
      </span>
    );
  };

  const applyFormat = (format: 'bold' | 'italic' | 'underline') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = notes.substring(start, end);
    const tag = format === 'bold' ? 'b' : format === 'italic' ? 'i' : 'u';
    const newText = `${notes.substring(
      0,
      start
    )}<${tag}>${selectedText}</${tag}>${notes.substring(end)}`;
    updateNotes(newText);
  };

  return (
    <div className='space-y-4'>
      <h3 className='text-lg font-semibold text-foreground'>Scratchpad</h3>
      <Input
        type='text'
        placeholder='Search notes...'
        className='w-full p-2 border rounded-md bg-background'
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      <div className='flex gap-2'>
        <Button onClick={() => applyFormat('bold')}>
          <Bold className='h-4 w-4' />
        </Button>
        <Button onClick={() => applyFormat('italic')}>
          <Italic className='h-4 w-4' />
        </Button>
        <Button onClick={() => applyFormat('underline')}>
          <Underline className='h-4 w-4' />
        </Button>
      </div>
      <Textarea
        ref={textareaRef}
        placeholder='Jot down your thoughts here...'
        value={notes}
        onChange={(e) => updateNotes(e.target.value)}
        className='min-h-[200px] text-sm'
        aria-label='Notes scratchpad'
      />
      <div
        className='p-2 border rounded-md bg-secondary/30'
        dangerouslySetInnerHTML={{ __html: notes }}
      />
      {searchQuery && (
        <div className='p-2 border rounded-md bg-secondary/30'>
          <h4 className='font-semibold'>Search Results</h4>
          <div className='mt-2 text-sm'>
            {getHighlightedText(notes, searchQuery)}
          </div>
        </div>
      )}
      <p className='text-xs text-muted-foreground'>
        Your notes are saved automatically.
      </p>
    </div>
  );
}
