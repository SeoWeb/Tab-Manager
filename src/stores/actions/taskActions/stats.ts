import type { AdvancedTask, TaskStats } from '@/types/tasks';

export const calculateTaskStats = (tasks: AdvancedTask[]): TaskStats => {
  const total = tasks.filter((t) => !t.isArchived).length;
  const completed = tasks.filter(
    (t) => t.status === 'completed' && !t.isArchived
  ).length;
  const inProgress = tasks.filter(
    (t) => t.status === 'in-progress' && !t.isArchived
  ).length;
  const overdue = tasks.filter(
    (t) =>
      t.dueDate &&
      new Date(t.dueDate) < new Date() &&
      t.status !== 'completed' &&
      !t.isArchived
  ).length;

  const completionRate = total > 0 ? (completed / total) * 100 : 0;

  // Calculate average completion time
  const completedTasks = tasks.filter(
    (t) => t.status === 'completed' && t.completedAt
  );
  const avgCompletionTime =
    completedTasks.length > 0
      ? completedTasks.reduce((sum, task) => {
          const duration =
            task.completedAt!.getTime() - task.createdAt.getTime();
          return sum + duration / (1000 * 60 * 60); // Convert to hours
        }, 0) / completedTasks.length
      : 0;

  // Category breakdown
  const categoryBreakdown: Record<string, number> = {};
  tasks
    .filter((t) => !t.isArchived)
    .forEach((task) => {
      categoryBreakdown[task.category] =
        (categoryBreakdown[task.category] || 0) + 1;
    });

  // Priority breakdown
  const priorityBreakdown = { low: 0, medium: 0, high: 0, urgent: 0 };
  tasks
    .filter((t) => !t.isArchived)
    .forEach((task) => {
      priorityBreakdown[task.priority]++;
    });

  // Productivity score (0-100 based on completion rate, overdue tasks, etc.)
  const productivityScore = Math.max(
    0,
    Math.min(100, completionRate - (overdue / Math.max(total, 1)) * 20)
  );

  // Calculate weekly progress (tasks completed per day for the last 7 days)
  const weeklyProgress = Array(7).fill(0);
  // Calculate monthly progress (tasks completed per day for the last 30 days)
  const monthlyProgress = Array(30).fill(0);
  const nowForProgress = new Date();
  nowForProgress.setHours(0, 0, 0, 0); // Start of today

  completedTasks.forEach((task) => {
    if (task.completedAt) {
      const completedDate = new Date(task.completedAt);
      completedDate.setHours(0, 0, 0, 0);
      const diffTime = nowForProgress.getTime() - completedDate.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays >= 0 && diffDays < 7) {
        // index 0 is oldest (6 days ago), index 6 is today
        weeklyProgress[6 - diffDays]++;
      }

      if (diffDays >= 0 && diffDays < 30) {
        // index 0 is oldest (29 days ago), index 29 is today
        monthlyProgress[29 - diffDays]++;
      }
    }
  });

  return {
    total,
    completed,
    inProgress,
    overdue,
    completionRate,
    averageCompletionTime: avgCompletionTime,
    productivityScore,
    categoryBreakdown,
    priorityBreakdown,
    weeklyProgress,
    monthlyProgress,
  };
};
