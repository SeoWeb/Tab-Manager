import React, { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';

const TodosView = () => {
  const { todos, toggleTodo, removeTodo, addTodo } = useAppStore((state) => ({
    todos: state.todos,
    toggleTodo: state.toggleTodo,
    removeTodo: state.removeTodo,
    addTodo: state.addTodo,
  }));
  const [newTodoText, setNewTodoText] = useState('');

  const handleAddTodo = () => {
    if (newTodoText.trim()) {
      addTodo(newTodoText);
      setNewTodoText('');
    }
  };

  return (
    <div>
      <h1 className='text-2xl font-bold mb-4'>Todos</h1>
      <div className='flex space-x-2 mb-4'>
        <Input
          value={newTodoText}
          onChange={(e) => setNewTodoText(e.target.value)}
          placeholder='Add a new todo'
          onKeyDown={(e) => e.key === 'Enter' && handleAddTodo()}
        />
        <Button onClick={handleAddTodo}>Add</Button>
      </div>
      <div className='space-y-2'>
        {todos.map((todo) => (
          <div
            key={todo.id}
            className='flex items-center justify-between p-2 rounded-lg bg-gray-100 dark:bg-gray-800'
          >
            <div className='flex items-center space-x-2'>
              <Checkbox
                checked={todo.completed}
                onCheckedChange={() => toggleTodo(todo.id)}
              />
              <span
                className={`${
                  todo.completed ? 'line-through text-gray-500' : ''
                }`}
              >
                {todo.text}
              </span>
            </div>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => removeTodo(todo.id)}
            >
              <Trash2 className='h-4 w-4' />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TodosView;
