'use client';

import { useState, useEffect, useMemo } from 'react';
import { calculateTaskStats } from '@/stores/actions/taskActions';
import { fetchProjectMembers } from '@/lib/cloudflareSync';
import type { CloudMember } from '@/lib/cloudflareSync/types';
import { useAppStoreWithDefaults } from '@/hooks/useAppStoreWithDefaults';
import TaskFormModal from '../modals/TaskFormModal';
import TaskDetailModal from '../modals/TaskDetailModal';
import type { AdvancedTask } from '@/types/tasks';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart3, Grid3X3, Calendar, Archive } from 'lucide-react';
import type { TaskStatus } from '@/types/tasks';

// Import the enhanced components
import TaskKanbanView from '../right-panel/panels/TaskKanbanView';
import TaskAnalyticsDashboard from '../right-panel/panels/TaskAnalyticsDashboard';
import TaskCalendarView from './TaskCalendarView';
import ArchivedTasksView from './ArchivedTasksView';

interface TasksViewProps {
  initialTab?: string;
  /**
   * When provided, only tasks belonging to this project are shown. Omit it (the
   * global Tasks route in AppClient) to show tasks across every project.
   */
  projectId?: string;
}

export default function TasksView({
  initialTab = 'kanban',
  projectId,
}: TasksViewProps) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<AdvancedTask | undefined>(
    undefined
  );
  const [viewingTaskId, setViewingTaskId] = useState<string | null>(null);

  // Store data
  const allTasks = useAppStoreWithDefaults((state) => state.tasks, []);
  const projects = useAppStoreWithDefaults((state) => state.projects, []);
  const cloudSyncEnabled = useAppStoreWithDefaults(
    (state) => state.cloudSync?.enabled,
    false
  );
  const [projectMembers, setProjectMembers] = useState<
    Record<string, CloudMember[]>
  >({});

  useEffect(() => {
    if (!cloudSyncEnabled) {
      setProjectMembers({});
      return;
    }

    const targetIds = projectId
      ? projects.find((p) => p.id === projectId)?.cloudEnabled
        ? [projectId]
        : []
      : projects.filter((p) => p.cloudEnabled).map((p) => p.id);

    targetIds.forEach((id) => {
      fetchProjectMembers(id)
        .then((membersList) => {
          setProjectMembers((prev) => ({ ...prev, [id]: membersList }));
        })
        .catch((err) =>
          console.error(`Failed to load members for project ${id}`, err)
        );
    });
  }, [projectId, projects, cloudSyncEnabled]);
  // Scope to the active project when rendered per-project; the global route
  // (no projectId prop) intentionally shows tasks across all projects.
  const tasks = projectId
    ? allTasks.filter((task) => task.projectId === projectId)
    : allTasks;
  const globalTaskStats = useAppStoreWithDefaults((state) => state.taskStats, {
    total: 0,
    completed: 0,
    inProgress: 0,
    overdue: 0,
    completionRate: 0,
    averageCompletionTime: 0,
    productivityScore: 0,
    categoryBreakdown: {},
    priorityBreakdown: { low: 0, medium: 0, high: 0, urgent: 0 },
    weeklyProgress: [],
    monthlyProgress: [],
  });
  const taskStats = useMemo(() => {
    return projectId ? calculateTaskStats(tasks) : globalTaskStats;
  }, [projectId, tasks, globalTaskStats]);
  // Actions

  const updateTask = useAppStoreWithDefaults(
    (state) => state.updateTask,
    () => {}
  );
  const addTask = useAppStoreWithDefaults(
    (state) => state.addTask,
    () => {}
  );
  const setTaskStatus = useAppStoreWithDefaults(
    (state) => state.setTaskStatus,
    () => {}
  );
  const archiveTask = useAppStoreWithDefaults(
    (state) => state.archiveTask,
    () => {}
  );

  const handleStatusChange = (id: string, status: TaskStatus) => {
    setTaskStatus(id, status);
  };

  const handleAddTaskForStatus = (status: TaskStatus) => {
    if (status) {
      // Set the status for the new task
    }
    setEditingTask(undefined);
    setIsTaskModalOpen(true);
  };

  const handleEditTask = (task: AdvancedTask) => {
    setEditingTask(task);
    setIsTaskModalOpen(true);
  };

  const handleViewTask = (task: AdvancedTask) => {
    setViewingTaskId(task.id);
    setIsDetailModalOpen(true);
  };

  const handleSaveTask = (
    taskData:
      | Omit<AdvancedTask, 'id' | 'createdAt' | 'updatedAt' | 'activities'>
      | AdvancedTask
  ) => {
    if ('id' in taskData) {
      updateTask(taskData.id, taskData);
    } else {
      addTask(taskData);
    }
  };

  const viewingTask = tasks.find((t) => t.id === viewingTaskId) || null;

  return (
    <div className='h-full flex flex-col bg-background'>
      {/* Main Content */}
      <div className='flex-1 p-6'>
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className='h-full flex flex-col'
        >
          <TabsList className='grid w-full max-w-lg grid-cols-4'>
            <TabsTrigger value='kanban' className='flex items-center gap-2'>
              <Grid3X3 className='h-4 w-4' />
              Board
            </TabsTrigger>
            <TabsTrigger value='calendar' className='flex items-center gap-2'>
              <Calendar className='h-4 w-4' />
              Calendar
            </TabsTrigger>
            <TabsTrigger value='analytics' className='flex items-center gap-2'>
              <BarChart3 className='h-4 w-4' />
              Analytics
            </TabsTrigger>
            <TabsTrigger value='archived' className='flex items-center gap-2'>
              <Archive className='h-4 w-4' />
              Archived
            </TabsTrigger>
          </TabsList>

          <div className='flex-1 mt-6'>
            <TabsContent value='kanban' className='h-full m-0'>
              <div className='h-full'>
                <TaskKanbanView
                  tasks={tasks}
                  onUpdate={updateTask}
                  onStatusChange={handleStatusChange}
                  onAddTask={handleAddTaskForStatus}
                  onEdit={handleEditTask}
                  onView={handleViewTask}
                  onArchive={archiveTask}
                  showCompleted={true}
                  showArchived={false}
                  projectMembers={projectMembers}
                />
              </div>
            </TabsContent>

            <TabsContent value='calendar' className='h-full m-0'>
              <TaskCalendarView tasks={tasks} onViewTask={handleViewTask} />
            </TabsContent>

            <TabsContent value='analytics' className='h-full m-0'>
              <div className='h-full max-w-4xl'>
                <TaskAnalyticsDashboard tasks={tasks} stats={taskStats} />
              </div>
            </TabsContent>

            <TabsContent value='archived' className='h-full m-0'>
              <ArchivedTasksView tasks={tasks} />
            </TabsContent>
          </div>
        </Tabs>
      </div>
      <TaskFormModal
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
        onSave={handleSaveTask}
        task={editingTask}
      />
      <TaskDetailModal
        key={viewingTask?.id}
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setViewingTaskId(null);
        }}
        task={viewingTask}
        onEdit={handleEditTask}
        onView={handleViewTask}
      />
    </div>
  );
}
