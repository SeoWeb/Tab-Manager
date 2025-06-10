'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  TrendingUp,
  TrendingDown,
  Target,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  BarChart3,
  PieChart,
  Activity,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AdvancedTask, TaskStats, TaskPriority } from '@/types/tasks';

interface TaskAnalyticsDashboardProps {
  tasks: AdvancedTask[];
  stats: TaskStats;
}

const priorityColors = {
  low: 'bg-blue-500',
  medium: 'bg-yellow-500',
  high: 'bg-orange-500',
  urgent: 'bg-red-500',
};

export default function TaskAnalyticsDashboard({
  tasks,
  stats,
}: TaskAnalyticsDashboardProps) {
  // Calculate additional metrics
  const metrics = useMemo(() => {
    const activeTasks = tasks.filter(
      (t) => !t.isArchived && t.status !== 'completed'
    );
    const completedTasks = tasks.filter((t) => t.status === 'completed');

    // Calculate average completion time in days
    const avgCompletionDays =
      completedTasks.length > 0
        ? completedTasks.reduce((sum, task) => {
            if (task.completedAt) {
              const days =
                (task.completedAt.getTime() - task.createdAt.getTime()) /
                (1000 * 60 * 60 * 24);
              return sum + days;
            }
            return sum;
          }, 0) / completedTasks.length
        : 0;

    // Calculate productivity trend (last 7 days vs previous 7 days)
    const now = new Date();
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const previous7Days = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const recentCompleted = completedTasks.filter(
      (t) => t.completedAt && t.completedAt >= last7Days
    ).length;

    const previousCompleted = completedTasks.filter(
      (t) =>
        t.completedAt &&
        t.completedAt >= previous7Days &&
        t.completedAt < last7Days
    ).length;

    const productivityTrend =
      previousCompleted > 0
        ? ((recentCompleted - previousCompleted) / previousCompleted) * 100
        : recentCompleted > 0
          ? 100
          : 0;

    // Task distribution by category
    const categoryDistribution = tasks.reduce(
      (acc, task) => {
        if (!task.isArchived) {
          acc[task.category] = (acc[task.category] || 0) + 1;
        }
        return acc;
      },
      {} as Record<string, number>
    );

    // Upcoming deadlines (next 7 days)
    const upcomingDeadlines = activeTasks.filter((t) => {
      if (!t.dueDate) return false;
      const dueDate = new Date(t.dueDate);
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      return dueDate >= now && dueDate <= nextWeek;
    }).length;

    return {
      activeTasks: activeTasks.length,
      avgCompletionDays: Math.round(avgCompletionDays * 10) / 10,
      productivityTrend,
      categoryDistribution,
      upcomingDeadlines,
      recentCompleted,
    };
  }, [tasks]);

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h3 className='text-lg font-semibold'>Task Analytics</h3>
        <Badge variant='outline' className='text-xs'>
          <Activity className='h-3 w-3 mr-1' />
          Live Data
        </Badge>
      </div>

      {/* Key Metrics Grid */}
      <div className='grid grid-cols-2 gap-3'>
        {/* Completion Rate */}
        <Card>
          <CardContent className='p-3'>
            <div className='flex items-center justify-between mb-2'>
              <div className='flex items-center gap-2'>
                <Target className='h-4 w-4 text-green-600' />
                <span className='text-xs font-medium'>Completion Rate</span>
              </div>
              <span className='text-lg font-bold text-green-600'>
                {Math.round(stats.completionRate)}%
              </span>
            </div>
            <Progress value={stats.completionRate} className='h-2' />
          </CardContent>
        </Card>

        {/* Productivity Score */}
        <Card>
          <CardContent className='p-3'>
            <div className='flex items-center justify-between mb-2'>
              <div className='flex items-center gap-2'>
                <Zap className='h-4 w-4 text-blue-600' />
                <span className='text-xs font-medium'>Productivity</span>
              </div>
              <span className='text-lg font-bold text-blue-600'>
                {Math.round(stats.productivityScore)}
              </span>
            </div>
            <Progress value={stats.productivityScore} className='h-2' />
          </CardContent>
        </Card>

        {/* Average Completion Time */}
        <Card>
          <CardContent className='p-3'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Clock className='h-4 w-4 text-orange-600' />
                <span className='text-xs font-medium'>Avg. Completion</span>
              </div>
              <span className='text-lg font-bold text-orange-600'>
                {metrics.avgCompletionDays}d
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Productivity Trend */}
        <Card>
          <CardContent className='p-3'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                {metrics.productivityTrend >= 0 ? (
                  <TrendingUp className='h-4 w-4 text-green-600' />
                ) : (
                  <TrendingDown className='h-4 w-4 text-red-600' />
                )}
                <span className='text-xs font-medium'>7-Day Trend</span>
              </div>
              <span
                className={cn(
                  'text-lg font-bold',
                  metrics.productivityTrend >= 0
                    ? 'text-green-600'
                    : 'text-red-600'
                )}
              >
                {metrics.productivityTrend >= 0 ? '+' : ''}
                {Math.round(metrics.productivityTrend)}%
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Status Overview */}
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-sm flex items-center gap-2'>
            <BarChart3 className='h-4 w-4' />
            Task Status Overview
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-2'>
          <div className='grid grid-cols-2 gap-2 text-xs'>
            <div className='flex items-center justify-between'>
              <span className='flex items-center gap-1'>
                <div className='w-2 h-2 rounded-full bg-gray-500'></div>
                To Do
              </span>
              <span className='font-medium'>
                {
                  tasks.filter((t) => t.status === 'todo' && !t.isArchived)
                    .length
                }
              </span>
            </div>
            <div className='flex items-center justify-between'>
              <span className='flex items-center gap-1'>
                <div className='w-2 h-2 rounded-full bg-blue-500'></div>
                In Progress
              </span>
              <span className='font-medium'>{stats.inProgress}</span>
            </div>
            <div className='flex items-center justify-between'>
              <span className='flex items-center gap-1'>
                <div className='w-2 h-2 rounded-full bg-green-500'></div>
                Completed
              </span>
              <span className='font-medium'>{stats.completed}</span>
            </div>
            <div className='flex items-center justify-between'>
              <span className='flex items-center gap-1'>
                <div className='w-2 h-2 rounded-full bg-red-500'></div>
                Overdue
              </span>
              <span className='font-medium'>{stats.overdue}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Priority Distribution */}
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-sm flex items-center gap-2'>
            <PieChart className='h-4 w-4' />
            Priority Distribution
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-2'>
          {Object.entries(stats.priorityBreakdown).map(([priority, count]) => (
            <div
              key={priority}
              className='flex items-center justify-between text-xs'
            >
              <span className='flex items-center gap-2 capitalize'>
                <div
                  className={cn(
                    'w-2 h-2 rounded-full',
                    priorityColors[priority as TaskPriority]
                  )}
                ></div>
                {priority}
              </span>
              <div className='flex items-center gap-2'>
                <span className='font-medium'>{count}</span>
                <div className='w-12 bg-gray-200 rounded-full h-1'>
                  <div
                    className={cn(
                      'h-1 rounded-full',
                      priorityColors[priority as TaskPriority]
                    )}
                    style={{
                      width: `${stats.total > 0 ? (count / stats.total) * 100 : 0}%`,
                    }}
                  ></div>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Category Breakdown */}
      {Object.keys(metrics.categoryDistribution).length > 0 && (
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm flex items-center gap-2'>
              <BarChart3 className='h-4 w-4' />
              Category Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-2'>
            {Object.entries(metrics.categoryDistribution)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5)
              .map(([category, count]) => (
                <div
                  key={category}
                  className='flex items-center justify-between text-xs'
                >
                  <span className='truncate'>{category}</span>
                  <div className='flex items-center gap-2'>
                    <span className='font-medium'>{count}</span>
                    <div className='w-12 bg-gray-200 rounded-full h-1'>
                      <div
                        className='h-1 rounded-full bg-blue-500'
                        style={{
                          width: `${stats.total > 0 ? (count / stats.total) * 100 : 0}%`,
                        }}
                      ></div>
                    </div>
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      {/* Quick Stats */}
      <div className='grid grid-cols-2 gap-2 text-xs'>
        <Card>
          <CardContent className='p-3 text-center'>
            <Calendar className='h-4 w-4 mx-auto mb-1 text-orange-500' />
            <div className='font-bold text-orange-600'>
              {metrics.upcomingDeadlines}
            </div>
            <div className='text-muted-foreground'>Due This Week</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className='p-3 text-center'>
            <CheckCircle2 className='h-4 w-4 mx-auto mb-1 text-green-500' />
            <div className='font-bold text-green-600'>
              {metrics.recentCompleted}
            </div>
            <div className='text-muted-foreground'>Completed (7d)</div>
          </CardContent>
        </Card>
      </div>

      {/* Alerts */}
      {(stats.overdue > 0 || metrics.upcomingDeadlines > 3) && (
        <Card className='border-orange-200 bg-orange-50'>
          <CardContent className='p-3'>
            <div className='flex items-center gap-2 text-orange-800'>
              <AlertTriangle className='h-4 w-4' />
              <span className='text-xs font-medium'>Attention Needed</span>
            </div>
            <div className='text-xs text-orange-700 mt-1'>
              {stats.overdue > 0 && `${stats.overdue} overdue tasks. `}
              {metrics.upcomingDeadlines > 3 &&
                `${metrics.upcomingDeadlines} tasks due this week.`}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
