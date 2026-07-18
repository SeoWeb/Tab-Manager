'use client';

import { useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { AdvancedTask, TaskStatus } from '@/types/tasks';
import { kanbanColumns } from './kanban-config';

interface UseKanbanDndArgs {
  tasks: AdvancedTask[];
  onStatusChange: (id: string, status: TaskStatus) => void;
}

export function useKanbanDnd({ tasks, onStatusChange }: UseKanbanDndArgs) {
  const [activeTask, setActiveTask] = useState<AdvancedTask | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 10,
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    if (event.active.data.current?.type === 'Task') {
      setActiveTask(event.active.data.current.task as AdvancedTask);
    }
  };

  const resolveTargetColumn = (
    activeId: string,
    overId: string | number
  ): (typeof kanbanColumns)[0] | undefined => {
    if (overId === activeId) return undefined;

    const overColumn = kanbanColumns.find((c) => c.status === overId);
    if (overColumn) return overColumn;

    const overTask = tasks.find((t) => t.id === overId);
    if (overTask) {
      return kanbanColumns.find((c) => c.status === overTask.status);
    }
    return undefined;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const target = resolveTargetColumn(active.id as string, over.id as string);
    const activeTaskData = tasks.find((t) => t.id === active.id);
    if (!activeTaskData || !target) return;

    if (activeTaskData.status !== target.status) {
      onStatusChange(activeTaskData.id, target.status);
    }
  };

  return {
    activeTask,
    sensors,
    handleDragStart,
    handleDragEnd,
    DragContext: DndContext,
  };
}
