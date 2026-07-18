import { useState } from 'react';
import { Pin, PinOff, Trash2, Copy, Palette, MoreVertical } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { Note } from '@/stores/types';

import { NOTE_COLORS } from '@/components/views/note-config';

export { NOTE_COLORS };

export interface NoteCardProps {
  note: Note;
  onUpdate: (
    id: string,
    updates: Partial<Omit<Note, 'id' | 'createdAt'>>
  ) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onDuplicate: (id: string) => void;
}

export function NoteCard({
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
