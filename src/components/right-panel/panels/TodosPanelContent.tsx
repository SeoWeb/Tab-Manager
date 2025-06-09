'use client';

import { useState } from 'react';
import { useAppStoreWithDefaults } from '@/hooks/useAppStoreWithDefaults';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { PlusCircle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function TodosPanelContent() {
  const todos = useAppStoreWithDefaults((state) => state.todos, []);
  const addTodo = useAppStoreWithDefaults(
    (state) => state.addTodo,
    () => {}
  );
  const toggleTodo = useAppStoreWithDefaults(
    (state) => state.toggleTodo,
    () => {}
  );
  const removeTodo = useAppStoreWithDefaults(
    (state) => state.removeTodo,
    () => {}
  );
  const [newTodoText, setNewTodoText] = useState('');

  const handleAddTodo = () => {
    if (newTodoText.trim()) {
      addTodo(newTodoText.trim());
      setNewTodoText('');
    }
  };

  return (
    <div className='space-y-4'>
      <h3 className='text-lg font-semibold text-foreground'>Mini Tasks</h3>
      <div className='flex gap-2'>
        <Input
          type='text'
          placeholder='Add a new task...'
          value={newTodoText}
          onChange={(e) => setNewTodoText(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleAddTodo()}
          className='text-sm'
        />
        <Button onClick={handleAddTodo} size='sm' className='shrink-0'>
          <PlusCircle className='mr-2 h-4 w-4' /> Add
        </Button>
      </div>
      {todos.length > 0 ? (
        <ul className='space-y-2'>
          {todos.map((todo) => (
            <li
              key={todo.id}
              className='flex items-center gap-2 p-2 bg-secondary/30 rounded-md border border-input'
            >
              <Checkbox
                id={`todo-${todo.id}`}
                checked={todo.completed}
                onCheckedChange={() => toggleTodo(todo.id)}
                aria-labelledby={`todo-label-${todo.id}`}
              />
              <label
                htmlFor={`todo-${todo.id}`}
                id={`todo-label-${todo.id}`}
                className={cn(
                  'flex-1 text-sm cursor-pointer',
                  todo.completed && 'line-through text-muted-foreground'
                )}
              >
                {todo.text}
              </label>
              <Button
                variant='ghost'
                size='icon'
                className='h-6 w-6 shrink-0'
                onClick={() => removeTodo(todo.id)}
              >
                <Trash2 className='h-3 w-3 text-destructive' />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className='text-sm text-muted-foreground text-center py-4'>
          No tasks yet. Add some!
        </p>
      )}
    </div>
  );
}
