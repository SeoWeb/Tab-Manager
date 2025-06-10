'use client';

import { useState } from 'react';
import { useAppStoreWithDefaults } from '@/hooks/useAppStoreWithDefaults';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export default function SimpleTodoPanelContent() {
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
    <div className='p-4 h-full'>
      <h3 className='text-lg font-semibold text-foreground mb-4'>Todo List</h3>
      <div className='flex gap-2 mb-4'>
        <Input
          type='text'
          placeholder='Add a new task...'
          value={newTodoText}
          onChange={(e) => setNewTodoText(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleAddTodo()}
          className='flex-1 text-black dark:text-white'
        />
        <Button onClick={handleAddTodo} size='sm'>
          Add
        </Button>
      </div>

      {todos.length > 0 ? (
        <ul className='space-y-2'>
          {todos.map((todo) => (
            <li
              key={todo.id}
              className='flex items-center gap-2 p-2 bg-secondary/30 rounded-md'
            >
              <input
                type='checkbox'
                checked={todo.completed}
                onChange={() => toggleTodo(todo.id)}
                className='rounded'
              />
              <span
                className={cn(
                  'flex-1 text-sm',
                  todo.completed && 'line-through text-muted-foreground'
                )}
              >
                {todo.text}
              </span>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => removeTodo(todo.id)}
                className='h-6 w-6 p-0'
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className='text-sm text-muted-foreground text-center py-4'>
          No tasks yet. Add one above!
        </p>
      )}
    </div>
  );
}
