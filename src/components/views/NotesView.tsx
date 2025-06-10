'use client';

import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Plus,
  Search,
  Pin,
  PinOff,
  Trash2,
  Copy,
  Palette,
  MoreVertical,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Note } from '@/stores/types';

const NOTE_COLORS = [
  { name: 'Default', value: '#ffffff', class: 'bg-white' },
  { name: 'Yellow', value: '#fef3c7', class: 'bg-yellow-100' },
  { name: 'Orange', value: '#fed7aa', class: 'bg-orange-100' },
  { name: 'Pink', value: '#fce7f3', class: 'bg-pink-100' },
  { name: 'Purple', value: '#e9d5ff', class: 'bg-purple-100' },
  { name: 'Blue', value: '#dbeafe', class: 'bg-blue-100' },
  { name: 'Green', value: '#dcfce7', class: 'bg-green-100' },
  { name: 'Gray', value: '#f3f4f6', class: 'bg-gray-100' },
];

interface NoteCardProps {
  note: Note;
  onUpdate: (
    id: string,
    updates: Partial<Omit<Note, 'id' | 'createdAt'>>
  ) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onDuplicate: (id: string) => void;
}

function NoteCard({
  note,
  onUpdate,
  onDelete,
  onTogglePin,
  onDuplicate,
}: NoteCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(note.title);
  const [editContent, setEditContent] = useState(note.content);

  const handleSave = () => {
    onUpdate(note.id, {
      title: editTitle.trim() || 'Untitled',
      content: editContent.trim(),
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(note.title);
    setEditContent(note.content);
    setIsEditing(false);
  };

  const getColorClass = (color: string) => {
    const colorConfig = NOTE_COLORS.find((c) => c.value === color);
    return colorConfig?.class || 'bg-white';
  };

  return (
    <Card
      className={`${getColorClass(
        note.color
      )} text-black border-l-4 border-l-blue-500 hover:shadow-md transition-shadow cursor-pointer relative group`}
      onClick={() => !isEditing && setIsEditing(true)}
    >
      <CardHeader className='pb-2'>
        <div className='flex items-start justify-between'>
          {isEditing ? (
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className='font-semibold text-sm bg-transparent border-none p-0 h-auto focus-visible:ring-0'
              placeholder='Note title...'
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <h4 className='font-semibold text-sm line-clamp-2'>{note.title}</h4>
          )}

          <div className='flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity'>
            <Button
              variant='ghost'
              size='sm'
              className='h-6 w-6 p-0'
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin(note.id);
              }}
            >
              {note.isPinned ? (
                <PinOff className='h-3 w-3' />
              ) : (
                <Pin className='h-3 w-3' />
              )}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-6 w-6 p-0'
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className='h-3 w-3' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem onClick={() => onDuplicate(note.id)}>
                  <Copy className='h-3 w-3 mr-2' />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDelete(note.id)}
                  className='text-red-600'
                >
                  <Trash2 className='h-3 w-3 mr-2' />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>

      <CardContent className='pt-0'>
        {isEditing ? (
          <div className='space-y-2' onClick={(e) => e.stopPropagation()}>
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className='min-h-[80px] text-sm bg-transparent border-none p-0 resize-none focus-visible:ring-0'
              placeholder='Take a note...'
            />

            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Palette className='h-4 w-4 text-gray-500' />
                <Select
                  value={note.color}
                  onValueChange={(color) => onUpdate(note.id, { color })}
                >
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
                <Button size='sm' variant='outline' onClick={handleCancel}>
                  Cancel
                </Button>
                <Button size='sm' onClick={handleSave}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <p className='text-sm text-gray-700 whitespace-pre-wrap line-clamp-6'>
              {note.content}
            </p>
            {note.isPinned && (
              <div className='mt-2'>
                <Pin className='h-3 w-3 text-blue-500' />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function NotesView() {
  const {
    notes,
    addNote,
    updateNote,
    deleteNote,
    togglePinNote,
    duplicateNote,
  } = useAppStore((state) => ({
    notes: state.notes,
    addNote: state.addNote,
    updateNote: state.updateNote,
    deleteNote: state.deleteNote,
    togglePinNote: state.togglePinNote,
    duplicateNote: state.duplicateNote,
  }));

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

  // Filter notes based on search query
  const filteredNotes = notes.filter(
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
