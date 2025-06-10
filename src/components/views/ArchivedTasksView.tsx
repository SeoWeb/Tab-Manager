import React from 'react';
import { AdvancedTask } from '@/types/tasks';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArchiveRestore, Trash2 } from 'lucide-react';
import { useAppStoreWithDefaults } from '@/hooks/useAppStoreWithDefaults';

interface ArchivedTasksViewProps {
  tasks: AdvancedTask[];
}

const ArchivedTasksView: React.FC<ArchivedTasksViewProps> = ({ tasks }) => {
  const unarchiveTask = useAppStoreWithDefaults(
    (state) => state.unarchiveTask,
    () => {}
  );
  const deleteTask = useAppStoreWithDefaults(
    (state) => state.deleteTask,
    () => {}
  );

  const archivedTasks = tasks.filter(
    (task) => task.isArchived || task.status === 'archived'
  );

  return (
    <div className='space-y-2'>
      {archivedTasks.length > 0 ? (
        archivedTasks.map((task) => (
          <Card key={task.id} className='p-2'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-4'>
                <span className='font-medium'>{task.title}</span>
                <div className='flex items-center gap-2'>
                  <Badge variant='outline'>{task.priority}</Badge>
                  <Badge variant='secondary'>{task.category}</Badge>
                </div>
              </div>
              <div className='flex items-center gap-2'>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => unarchiveTask(task.id)}
                  title='Unarchive'
                >
                  <ArchiveRestore className='h-4 w-4' />
                </Button>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => deleteTask(task.id)}
                  title='Delete Permanently'
                  className='text-destructive hover:text-destructive'
                >
                  <Trash2 className='h-4 w-4' />
                </Button>
              </div>
            </div>
          </Card>
        ))
      ) : (
        <div className='text-center py-8'>
          <p className='text-muted-foreground'>No archived tasks.</p>
        </div>
      )}
    </div>
  );
};

export default ArchivedTasksView;
