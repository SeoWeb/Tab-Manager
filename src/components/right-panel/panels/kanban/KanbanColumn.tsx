import { useDroppable } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AdvancedTask, TaskStatus } from '@/types/tasks';
import type { CloudMember } from '@/lib/cloudflareSync/types';
import type { KanbanColumnConfig } from './kanban-config';
import { KanbanTaskCard } from './KanbanTaskCard';
import { SortableTaskCard } from './SortableTaskCard';

export interface KanbanColumnProps {
  column: KanbanColumnConfig;
  tasks: AdvancedTask[];
  onUpdate: (id: string, updates: Partial<AdvancedTask>) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onAddTask: (status: TaskStatus) => void;
  onEdit: (task: AdvancedTask) => void;
  onView: (task: AdvancedTask) => void;
  onArchive: (id: string) => void;
  projectMembers?: Record<string, CloudMember[]>;
  isMobile: boolean;
}

export const KanbanColumn = ({
  column,
  tasks,
  onUpdate,
  onStatusChange,
  onAddTask,
  onEdit,
  onView,
  onArchive,
  projectMembers,
  isMobile,
}: KanbanColumnProps) => {
  const Icon = column.icon;
  const { setNodeRef } = useDroppable({
    id: column.status,
    data: {
      type: 'Column',
    },
    disabled: isMobile,
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col h-full rounded-lg border-2 border-dashed w-[280px] shrink-0 md:w-auto md:shrink snap-center',
        column.color
      )}
    >
      {/* Column Header */}
      <div className='p-3 border-b bg-secondary rounded-t-lg'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <Icon className='h-4 w-4' />
            <h3 className='font-medium text-sm'>{column.title}</h3>
            <Badge variant='secondary' className='text-xs'>
              {tasks.length}
            </Badge>
          </div>
          <Button
            variant='ghost'
            size='sm'
            className='h-6 w-6 p-0'
            onClick={() => onAddTask(column.status)}
          >
            <Plus className='h-3 w-3' />
          </Button>
        </div>
      </div>

      {/* Column Content */}
      <ScrollArea className='flex-1 p-3'>
        <div className='space-y-2'>
          {isMobile ? (
            tasks.map((task) => (
              <KanbanTaskCard
                key={task.id}
                task={task}
                allTasks={tasks}
                onUpdate={onUpdate}
                onStatusChange={onStatusChange}
                onEdit={onEdit}
                onView={onView}
                onArchive={onArchive}
                projectMembers={projectMembers}
              />
            ))
          ) : (
            <SortableContext items={tasks.map((t) => t.id)}>
              {tasks.map((task) => (
                <SortableTaskCard
                  key={task.id}
                  task={task}
                  allTasks={tasks}
                  onUpdate={onUpdate}
                  onStatusChange={onStatusChange}
                  onEdit={onEdit}
                  onView={onView}
                  onArchive={onArchive}
                  projectMembers={projectMembers}
                />
              ))}
            </SortableContext>
          )}

          {tasks.length === 0 && (
            <div className='text-center py-8 text-muted-foreground'>
              <div className='text-xs'>No tasks</div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
