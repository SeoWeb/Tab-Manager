'use client';

import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useShallow } from 'zustand/react/shallow';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Plus, Search, Pin, Palette } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { NoteCard, NOTE_COLORS } from '@/components/views/NoteCard';

export default function NotesView() {
  const {
    notes,
    activeProjectId,
    addNote,
    updateNote,
    deleteNote,
    togglePinNote,
    duplicateNote,
  } = useAppStore(
    useShallow((state) => ({
      notes: state.notes,
      activeProjectId: state.activeProjectId,
      addNote: state.addNote,
      updateNote: state.updateNote,
      deleteNote: state.deleteNote,
      togglePinNote: state.togglePinNote,
      duplicateNote: state.duplicateNote,
    }))
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newColor, setNewColor] = useState('#ffffff');

  const handleCreateNote = () => {
    if (newTitle.trim() || newContent.trim()) {
      addNote(newTitle.trim() || 'Untitled', newContent.trim(), newColor);
      setNewTitle('');
      setNewContent('');
      setNewColor('#ffffff');
      setIsCreating(false);
    }
  };

  const handleCancelCreate = () => {
    setNewTitle('');
    setNewContent('');
    setNewColor('#ffffff');
    setIsCreating(false);
  };

  // Filter notes to the active project, then by search query
  const filteredNotes = notes
    .filter((note) => note.projectId === activeProjectId)
    .filter(
      (note) =>
        note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        note.content.toLowerCase().includes(searchQuery.toLowerCase())
    );

  // Separate pinned and unpinned notes
  const pinnedNotes = filteredNotes.filter((note) => note.isPinned);
  const unpinnedNotes = filteredNotes.filter((note) => !note.isPinned);

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h3 className='text-lg font-semibold text-foreground'>Notes</h3>
        <Button size='sm' onClick={() => setIsCreating(true)} className='h-8'>
          <Plus className='h-4 w-4 mr-1' />
          New Note
        </Button>
      </div>

      {/* Search Bar */}
      <div className='relative'>
        <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400' />
        <Input
          type='text'
          placeholder='Search notes...'
          className='pl-10'
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Create New Note */}
      {isCreating && (
        <Card className='border-2 border-dashed border-blue-300'>
          <CardHeader className='pb-2'>
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className='font-semibold text-sm bg-transparent border-none p-0 h-auto focus-visible:ring-0'
              placeholder='Note title...'
            />
          </CardHeader>
          <CardContent className='pt-0'>
            <div className='space-y-2'>
              <Textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                className='min-h-[80px] text-sm bg-transparent border-none p-0 resize-none focus-visible:ring-0'
                placeholder='Take a note...'
              />

              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <Palette className='h-4 w-4 text-gray-500' />
                  <Select value={newColor} onValueChange={setNewColor}>
                    <SelectTrigger className='w-32 h-8'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NOTE_COLORS.map((color) => (
                        <SelectItem key={color.value} value={color.value}>
                          <div className='flex items-center gap-2'>
                            <div
                              className={`w-4 h-4 rounded-full ${color.class} border`}
                            />
                            {color.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className='flex gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={handleCancelCreate}
                  >
                    Cancel
                  </Button>
                  <Button size='sm' onClick={handleCreateNote}>
                    Create
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notes Grid */}
      <div className='space-y-4'>
        {/* Pinned Notes */}
        {pinnedNotes.length > 0 && (
          <div>
            <h4 className='text-sm font-medium text-gray-600 mb-2 flex items-center'>
              <Pin className='h-3 w-3 mr-1' />
              Pinned
            </h4>
            <div className='grid gap-3'>
              {pinnedNotes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  onUpdate={updateNote}
                  onDelete={deleteNote}
                  onTogglePin={togglePinNote}
                  onDuplicate={duplicateNote}
                />
              ))}
            </div>
          </div>
        )}

        {/* Other Notes */}
        {unpinnedNotes.length > 0 && (
          <div>
            {pinnedNotes.length > 0 && (
              <h4 className='text-sm font-medium text-gray-600 mb-2'>Others</h4>
            )}
            <div className='grid gap-3'>
              {unpinnedNotes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  onUpdate={updateNote}
                  onDelete={deleteNote}
                  onTogglePin={togglePinNote}
                  onDuplicate={duplicateNote}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {filteredNotes.length === 0 && !isCreating && (
          <div className='text-center py-8'>
            <div className='text-gray-400 mb-2'>
              <Plus className='h-12 w-12 mx-auto mb-2' />
            </div>
            <p className='text-sm text-gray-500 mb-2'>
              {searchQuery ? 'No notes found' : 'No notes yet'}
            </p>
            {!searchQuery && (
              <Button
                variant='outline'
                size='sm'
                onClick={() => setIsCreating(true)}
              >
                Create your first note
              </Button>
            )}
          </div>
        )}
      </div>

      <p className='text-xs text-muted-foreground'>
        Your notes are saved automatically.
      </p>
    </div>
  );
}
