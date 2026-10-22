'use client';

/**
 * Task calendar view (cleanup-and-regression-tests §1.2/§1.3).
 *
 * The implementation is the react-day-picker rework in `task-calendar/`.
 * This module remains the stable import point for the view now that the
 * pre-rework calendar path was deleted in task 1.3.
 */

import React from 'react';
import TaskCalendarModern from './task-calendar/TaskCalendarModern';
import type { TaskCalendarViewProps } from './task-calendar/types';

export type { TaskCalendarViewProps };

const TaskCalendarView: React.FC<TaskCalendarViewProps> = (props) => (
  <TaskCalendarModern {...props} />
);

export default TaskCalendarView;
