'use client';

import { useState, useEffect } from 'react';
import { useAppStoreWithDefaults } from '@/hooks/useAppStoreWithDefaults';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Sparkles,
  BarChart3,
  Timer,
  Grid3X3,
  ArrowRight,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { performMigrationIfNeeded } from '@/lib/taskMigration';

// Import the new enhanced components
import EnhancedTodosPanelContent from './EnhancedTodosPanelContent';
import PomodoroTimer from './PomodoroTimer';

export default function TodosPanelContent() {
  const [activeTab, setActiveTab] = useState('tasks');
  const [showMigrationPrompt, setShowMigrationPrompt] = useState(false);

  // Legacy todos and enhanced tasks
  const todos = useAppStoreWithDefaults((state) => state.todos, []);
  const tasks = useAppStoreWithDefaults((state) => state.tasks, []);
  const activeTask = useAppStoreWithDefaults(
    (state) => state.getActiveTask?.() || null,
    null
  );
  const activePomodoroSession = useAppStoreWithDefaults(
    (state) => state.activePomodoroSession,
    null
  );

  const startPomodoroSession = useAppStoreWithDefaults(
    (state) => state.startPomodoroSession,
    () => {}
  );
  const pausePomodoroSession = useAppStoreWithDefaults(
    (state) => state.pausePomodoroSession,
    () => {}
  );
  const resumePomodoroSession = useAppStoreWithDefaults(
    (state) => state.resumePomodoroSession,
    () => {}
  );
  const completePomodoroSession = useAppStoreWithDefaults(
    (state) => state.completePomodoroSession,
    () => {}
  );
  const cancelPomodoroSession = useAppStoreWithDefaults(
    (state) => state.cancelPomodoroSession,
    () => {}
  );
  const setActiveTask = useAppStoreWithDefaults(
    (state) => state.setActiveTask,
    () => {}
  );
  const setActiveView = useAppStoreWithDefaults(
    (state) => state.setActiveView,
    () => {}
  );

  // Check for migration needs
  useEffect(() => {
    if (todos.length > 0 && tasks.length === 0) {
      setShowMigrationPrompt(true);
    }
  }, [todos.length, tasks.length]);

  const handleMigration = () => {
    const { tasks: migratedTasks, migrated } = performMigrationIfNeeded(
      todos,
      tasks
    );
    if (migrated) {
      // In a real implementation, this would trigger the migration in the store
      console.log(
        'Migration would be triggered here for',
        migratedTasks.length,
        'tasks'
      );
      setShowMigrationPrompt(false);
    }
  };

  // Show migration prompt if needed
  if (showMigrationPrompt) {
    return (
      <div className='space-y-4'>
        <h3 className='text-lg font-semibold text-foreground'>
          Mini Tasks Upgrade
        </h3>

        <Card className='border-blue-200 bg-blue-50'>
          <CardContent className='p-4'>
            <div className='flex items-start gap-3'>
              <Sparkles className='h-5 w-5 text-blue-600 mt-0.5' />
              <div className='space-y-3'>
                <div>
                  <h4 className='font-medium text-blue-900'>
                    Enhanced Task Management Available!
                  </h4>
                  <p className='text-sm text-blue-800 mt-1'>
                    We&apos;ve detected {todos.length} legacy tasks. Upgrade to
                    unlock powerful new features:
                  </p>
                </div>

                <div className='grid grid-cols-2 gap-2 text-xs'>
                  <div className='flex items-center gap-1 text-blue-700'>
                    <Zap className='h-3 w-3' />
                    Priority levels & status tracking
                  </div>
                  <div className='flex items-center gap-1 text-blue-700'>
                    <BarChart3 className='h-3 w-3' />
                    Analytics & productivity insights
                  </div>
                  <div className='flex items-center gap-1 text-blue-700'>
                    <Timer className='h-3 w-3' />
                    Pomodoro timer integration
                  </div>
                  <div className='flex items-center gap-1 text-blue-700'>
                    <Grid3X3 className='h-3 w-3' />
                    Kanban board view
                  </div>
                </div>

                <div className='flex gap-2'>
                  <Button
                    onClick={handleMigration}
                    size='sm'
                    className='flex items-center gap-2'
                  >
                    <ArrowRight className='h-3 w-3' />
                    Upgrade Now
                  </Button>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => setShowMigrationPrompt(false)}
                  >
                    Maybe Later
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Show legacy interface while migration is pending */}
        <div className='opacity-75'>
          <LegacyTodosInterface />
        </div>
      </div>
    );
  }

  // Show enhanced interface
  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h3 className='text-lg font-semibold text-foreground'>
          Task Management
        </h3>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setActiveView('tasks')}
            className='text-xs'
          >
            Open Full View
          </Button>
          <Badge variant='outline' className='text-xs'>
            <Sparkles className='h-3 w-3 mr-1' />
            Enhanced
          </Badge>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className='w-full'>
        <TabsList className='grid w-full grid-cols-2'>
          <TabsTrigger value='tasks' className='text-xs'>
            Tasks
          </TabsTrigger>
          <TabsTrigger value='focus' className='text-xs'>
            Focus
          </TabsTrigger>
        </TabsList>

        <TabsContent value='tasks' className='mt-4'>
          <EnhancedTodosPanelContent />
        </TabsContent>

        <TabsContent value='focus' className='mt-4'>
          <PomodoroTimer
            tasks={tasks}
            activeTask={activeTask}
            activePomodoroSession={activePomodoroSession}
            onStartSession={startPomodoroSession}
            onPauseSession={pausePomodoroSession}
            onResumeSession={resumePomodoroSession}
            onCompleteSession={completePomodoroSession}
            onCancelSession={cancelPomodoroSession}
            onSetActiveTask={setActiveTask}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Legacy interface component for backward compatibility
function LegacyTodosInterface() {
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
  const [newTodoCategory, setNewTodoCategory] = useState('');

  const handleAddTodo = () => {
    if (newTodoText.trim()) {
      addTodo(newTodoText.trim(), newTodoCategory.trim());
      setNewTodoText('');
      setNewTodoCategory('');
    }
  };

  return (
    <div className='space-y-4'>
      <h4 className='text-md font-medium text-foreground'>Legacy Tasks</h4>
      <div className='flex gap-2'>
        <input
          type='text'
          placeholder='Add a new task...'
          value={newTodoText}
          onChange={(e) => setNewTodoText(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleAddTodo()}
          className='flex-1 px-3 py-2 text-sm border rounded-md'
        />
        <input
          type='text'
          placeholder='Category'
          value={newTodoCategory}
          onChange={(e) => setNewTodoCategory(e.target.value)}
          className='px-3 py-2 text-sm border rounded-md'
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
                {todo.category && (
                  <span className='ml-2 text-xs text-muted-foreground'>
                    ({todo.category})
                  </span>
                )}
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
          No legacy tasks.
        </p>
      )}
    </div>
  );
}
