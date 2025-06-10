import React from 'react';
import { Calendar, momentLocalizer } from 'react-big-calendar';
import moment from 'moment';
import './react-big-calendar.css';

const localizer = momentLocalizer(moment);

import { AdvancedTask } from '@/types/tasks';

interface TaskCalendarViewProps {
  tasks: AdvancedTask[];
  onViewTask: (task: AdvancedTask) => void;
}

const TaskCalendarView: React.FC<TaskCalendarViewProps> = ({
  tasks,
  onViewTask,
}) => {
  const events = tasks
    .filter(
      (task) => !task.isArchived && task.status !== 'archived' && task.dueDate
    )
    .map((task) => ({
      title: task.title,
      start: new Date(task.dueDate!),
      end: new Date(task.dueDate!),
      allDay: true,
      resource: task,
    }));

  return (
    <div className='h-full'>
      <Calendar
        localizer={localizer}
        events={events}
        startAccessor='start'
        endAccessor='end'
        style={{ height: '100%' }}
        onSelectEvent={(event) => onViewTask(event.resource)}
      />
    </div>
  );
};

export default TaskCalendarView;
