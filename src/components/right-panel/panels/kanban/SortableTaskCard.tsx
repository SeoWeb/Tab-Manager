import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { KanbanTaskCard, KanbanTaskCardProps } from './KanbanTaskCard';

export const SortableTaskCard = ({
  task,
  allTasks,
  onUpdate,
  onStatusChange,
  onEdit,
  onView,
  onArchive,
  projectMembers,
}: KanbanTaskCardProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { type: 'Task', task } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className='bg-card opacity-50 p-3 rounded-lg border-2 border-primary'
      ></div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <KanbanTaskCard
        task={task}
        allTasks={allTasks}
        onUpdate={onUpdate}
        onStatusChange={onStatusChange}
        onEdit={onEdit}
        onView={onView}
        onArchive={onArchive}
        projectMembers={projectMembers}
      />
    </div>
  );
};
