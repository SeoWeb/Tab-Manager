'use client';

import { useMemo } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { DragOverlay } from '@dnd-kit/core';
import type { AdvancedTask, TaskStatus } from '@/types/tasks';
import type { CloudMember } from '@/lib/cloudflareSync/types';
import { kanbanColumns } from './kanban/kanban-config';
import { KanbanColumn } from './kanban/KanbanColumn';
import { KanbanTaskCard } from './kanban/KanbanTaskCard';
import { useKanbanDnd } from './kanban/useKanbanDnd';

interface TaskKanbanViewProps {
  tasks: AdvancedTask[];
  onUpdate: (id: string, updates: Partial<AdvancedTask>) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onAddTask: (status: TaskStatus) => void;
  onEdit: (task: AdvancedTask) => void;
  onView: (task: AdvancedTask) => void;
  onArchive: (id: string) => void;
  showCompleted?: boolean;
  showArchived?: boolean;
  projectMembers?: Record<string, CloudMember[]>;
}

export default function TaskKanbanView({
  tasks,
  onUpdate,
  onStatusChange,
  onAddTask,
  onEdit,
  onView,
  onArchive,
  showCompleted = true,
  showArchived = false,
  projectMembers,
}: TaskKanbanViewProps) {
  const isMobile = useIsMobile();

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (!showCompleted && task.status === 'completed') return false;
      if (!showArchived && task.isArchived) return false;
      return true;
    });
  }, [tasks, showCompleted, showArchived]);

  const tasksByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, AdvancedTask[]> = {
      todo: [],
      'in-progress': [],
      blocked: [],
      completed: [],
      cancelled: [],
      archived: [],
    };

    filteredTasks.forEach((task) => {
      grouped[task.status].push(task);
    });

    return grouped;
  }, [filteredTasks]);

  const { activeTask, sensors, handleDragStart, handleDragEnd, DragContext } =
    useKanbanDnd({ tasks: filteredTasks, onStatusChange });

  const columns = (
    <div className='flex flex-row overflow-x-auto md:grid md:grid-cols-2 lg:grid-cols-4 gap-4 h-full w-full pb-4 scrollbar-thin snap-x snap-mandatory'>
      {kanbanColumns.map((column) => (
        <KanbanColumn
          key={column.status}
          column={column}
          tasks={tasksByStatus[column.status]}
          onUpdate={onUpdate}
          onStatusChange={onStatusChange}
          onAddTask={onAddTask}
          onEdit={onEdit}
          onView={onView}
          onArchive={onArchive}
          projectMembers={projectMembers}
          isMobile={isMobile}
        />
      ))}
    </div>
  );

  if (isMobile) {
    return <div className='h-full'>{columns}</div>;
  }

  return (
    <div className='h-full'>
      <DragContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {columns}
        <DragOverlay>
          {activeTask ? (
            <KanbanTaskCard
              task={activeTask}
              allTasks={tasks}
              onUpdate={() => {}}
              onStatusChange={() => {}}
              onEdit={() => {}}
              onView={() => {}}
              onArchive={() => {}}
              projectMembers={projectMembers}
            />
          ) : null}
        </DragOverlay>
      </DragContext>
    </div>
  );
}
