'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Target,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  BarChart3,
  PieChart as PieIcon,
  Activity,
  Zap,
  Inbox,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AdvancedTask, TaskStats, TaskPriority } from '@/types/tasks';

interface TaskAnalyticsDashboardProps {
  tasks: AdvancedTask[];
  stats: TaskStats;
}

type RangeKey = '7d' | '30d' | 'all';

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: 'all', label: 'All Time' },
];

const priorityColors: Record<TaskPriority, string> = {
  low: '#3b82f6',
  medium: '#eab308',
  high: '#f97316',
  urgent: '#ef4444',
};

const statusColors: Record<string, string> = {
  todo: '#6b7280',
  'in-progress': '#3b82f6',
  blocked: '#a855f7',
  completed: '#22c55e',
  cancelled: '#9ca3af',
};

const categoryPalette = [
  '#3b82f6',
  '#22c55e',
  '#f97316',
  '#a855f7',
  '#ef4444',
  '#14b8a6',
  '#eab308',
  '#ec4899',
];

const chartAxisColor = 'hsl(var(--muted-foreground))';
const chartGridColor = 'hsl(var(--border))';
const chartTooltipStyle = {
  backgroundColor: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
  color: 'hsl(var(--foreground))',
  fontSize: 12,
};

function formatDuration(hours: number): string {
  if (!hours || hours <= 0) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function formatShortDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatFullDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function TaskAnalyticsDashboard({
  tasks,
  stats,
}: TaskAnalyticsDashboardProps) {
  const [range, setRange] = useState<RangeKey>('7d');

  const activeTasks = useMemo(
    () => tasks.filter((t) => !t.isArchived),
    [tasks]
  );

  // Completion time-series for the selected range, recomputed from raw tasks
  // so the toggle genuinely scopes the chart to the chosen window.
  const series = useMemo(() => {
    const completed = activeTasks.filter(
      (t) => t.status === 'completed' && t.completedAt
    );
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    if (range === 'all') {
      let earliest = now.getTime();
      completed.forEach((t) => {
        const d = new Date(t.completedAt!);
        d.setHours(0, 0, 0, 0);
        if (d.getTime() < earliest) earliest = d.getTime();
      });
      const weeks = Math.max(
        1,
        Math.ceil((now.getTime() - earliest) / (7 * 86400000))
      );
      const buckets = new Array(weeks).fill(0);
      completed.forEach((t) => {
        const d = new Date(t.completedAt!);
        d.setHours(0, 0, 0, 0);
        const daysAgo = Math.round((now.getTime() - d.getTime()) / 86400000);
        const idx = weeks - 1 - Math.floor(daysAgo / 7);
        if (idx >= 0 && idx < weeks) buckets[idx]++;
      });
      return buckets.map((value, i) => {
        const d = new Date(now.getTime() - (weeks - 1 - i) * 7 * 86400000);
        return { label: formatShortDate(d), full: formatFullDate(d), value };
      });
    }

    const n = range === '7d' ? 7 : 30;
    const buckets = new Array(n).fill(0);
    completed.forEach((t) => {
      const d = new Date(t.completedAt!);
      d.setHours(0, 0, 0, 0);
      const daysAgo = Math.round((now.getTime() - d.getTime()) / 86400000);
      if (daysAgo >= 0 && daysAgo < n) buckets[n - 1 - daysAgo]++;
    });
    return buckets.map((value, i) => {
      const d = new Date(now.getTime() - (n - 1 - i) * 86400000);
      return { label: formatShortDate(d), full: formatFullDate(d), value };
    });
  }, [activeTasks, range]);

  const completedInRange = useMemo(
    () => series.reduce((sum, p) => sum + p.value, 0),
    [series]
  );

  // Trend compares the most recent half of the window against the earlier half.
  const productivityTrend = useMemo(() => {
    const n = series.length;
    const half = Math.floor(n / 2);
    const prev = series.slice(0, half).reduce((s, p) => s + p.value, 0);
    const curr = series.slice(half).reduce((s, p) => s + p.value, 0);
    if (prev === 0) return curr > 0 ? 100 : 0;
    return ((curr - prev) / prev) * 100;
  }, [series]);

  // Upcoming deadlines (next 7 days) — independent of history range.
  const upcomingDeadlines = useMemo(() => {
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return activeTasks.filter((t) => {
      if (!t.dueDate || t.status === 'completed') return false;
      const due = new Date(t.dueDate);
      return due >= now && due <= nextWeek;
    }).length;
  }, [activeTasks]);

  const priorityData = useMemo(
    () =>
      (['low', 'medium', 'high', 'urgent'] as TaskPriority[])
        .map((p) => ({ name: p, value: stats.priorityBreakdown[p] }))
        .filter((d) => d.value > 0),
    [stats.priorityBreakdown]
  );

  const categoryData = useMemo(
    () =>
      Object.entries(
        activeTasks.reduce<Record<string, number>>((acc, t) => {
          acc[t.category] = (acc[t.category] || 0) + 1;
          return acc;
        }, {})
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, value]) => ({ name, value })),
    [activeTasks]
  );

  const statusData = useMemo(
    () =>
      [
        {
          name: 'To Do',
          value: activeTasks.filter((t) => t.status === 'todo').length,
          color: statusColors.todo,
        },
        {
          name: 'In Progress',
          value: stats.inProgress,
          color: statusColors['in-progress'],
        },
        {
          name: 'Blocked',
          value: activeTasks.filter((t) => t.status === 'blocked').length,
          color: statusColors.blocked,
        },
        {
          name: 'Completed',
          value: stats.completed,
          color: statusColors.completed,
        },
        {
          name: 'Cancelled',
          value: activeTasks.filter((t) => t.status === 'cancelled').length,
          color: statusColors.cancelled,
        },
      ].filter((s) => s.value > 0),
    [activeTasks, stats.inProgress, stats.completed]
  );

  const isEmpty = activeTasks.length === 0;

  if (isEmpty) {
    return (
      <div className='flex flex-col items-center justify-center text-center py-20 text-muted-foreground'>
        <Inbox className='h-10 w-10 mb-3 opacity-60' />
        <p className='text-sm font-medium'>No task data yet</p>
        <p className='text-xs mt-1 max-w-xs'>
          Create tasks on the Board or Calendar to start tracking your progress,
          priorities, and completion trends here.
        </p>
      </div>
    );
  }

  const rangeLabel =
    range === '7d'
      ? 'Last 7 days'
      : range === '30d'
        ? 'Last 30 days'
        : 'All time';

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex items-center gap-2'>
          <h3 className='text-lg font-semibold'>Task Analytics</h3>
          <Badge variant='outline' className='text-xs'>
            <Activity className='h-3 w-3 mr-1' />
            Live Data
          </Badge>
        </div>
        <div className='flex items-center gap-1 rounded-lg border border-border p-1'>
          {RANGE_OPTIONS.map((opt) => (
            <Button
              key={opt.key}
              size='sm'
              variant={range === opt.key ? 'default' : 'ghost'}
              className='h-7 px-2.5 text-xs'
              onClick={() => setRange(opt.key)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className='grid grid-cols-2 gap-3'>
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

        <Card>
          <CardContent className='p-3'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Clock className='h-4 w-4 text-orange-600' />
                <span className='text-xs font-medium'>Avg. Completion</span>
              </div>
              <span className='text-lg font-bold text-orange-600'>
                {formatDuration(stats.averageCompletionTime)}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className='p-3'>
            <div className='flex items-center justify-between gap-2'>
              <div className='flex items-center gap-2 min-w-0'>
                {productivityTrend >= 0 ? (
                  <TrendingUp className='h-4 w-4 text-green-600 shrink-0' />
                ) : (
                  <TrendingDown className='h-4 w-4 text-red-600 shrink-0' />
                )}
                <span className='text-xs font-medium truncate'>
                  {rangeLabel} Trend
                </span>
              </div>
              <span
                className={cn(
                  'text-lg font-bold shrink-0',
                  productivityTrend >= 0 ? 'text-green-600' : 'text-red-600'
                )}
              >
                {productivityTrend >= 0 ? '+' : ''}
                {Math.round(productivityTrend)}%
              </span>
            </div>
            <div className='h-9 mt-1'>
              <ResponsiveContainer width='100%' height='100%'>
                <AreaChart
                  data={series}
                  margin={{ top: 2, bottom: 0, left: 0, right: 0 }}
                >
                  <defs>
                    <linearGradient id='spark' x1='0' y1='0' x2='0' y2='1'>
                      <stop
                        offset='0%'
                        stopColor={
                          productivityTrend >= 0 ? '#22c55e' : '#ef4444'
                        }
                        stopOpacity={0.5}
                      />
                      <stop
                        offset='100%'
                        stopColor={
                          productivityTrend >= 0 ? '#22c55e' : '#ef4444'
                        }
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <Area
                    type='monotone'
                    dataKey='value'
                    stroke={productivityTrend >= 0 ? '#22c55e' : '#ef4444'}
                    strokeWidth={2}
                    fill='url(#spark)'
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Completion Trend Chart */}
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-sm flex items-center justify-between'>
            <span className='flex items-center gap-2'>
              <BarChart3 className='h-4 w-4' />
              Completion Trend
            </span>
            <span className='text-xs font-normal text-muted-foreground'>
              {rangeLabel}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className='h-[220px]'>
            <ResponsiveContainer width='100%' height='100%'>
              <AreaChart
                data={series}
                margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
              >
                <defs>
                  <linearGradient id='trend' x1='0' y1='0' x2='0' y2='1'>
                    <stop offset='0%' stopColor='#3b82f6' stopOpacity={0.4} />
                    <stop offset='100%' stopColor='#3b82f6' stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray='3 3'
                  stroke={chartGridColor}
                  vertical={false}
                />
                <XAxis
                  dataKey='label'
                  tick={{ fontSize: 10, fill: chartAxisColor }}
                  tickLine={false}
                  axisLine={{ stroke: chartGridColor }}
                  interval='preserveStartEnd'
                  minTickGap={16}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10, fill: chartAxisColor }}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  labelStyle={{ color: chartAxisColor }}
                  formatter={(value: number) => [`${value} completed`, 'Tasks']}
                />
                <Area
                  type='monotone'
                  dataKey='value'
                  stroke='#3b82f6'
                  strokeWidth={2}
                  fill='url(#trend)'
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Status Overview */}
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-sm flex items-center gap-2'>
            <BarChart3 className='h-4 w-4' />
            Task Status Overview
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='flex h-2.5 w-full overflow-hidden rounded-full bg-muted'>
            {statusData.map((s) => (
              <div
                key={s.name}
                className='h-full'
                style={{
                  width: `${stats.total > 0 ? (s.value / stats.total) * 100 : 0}%`,
                  backgroundColor: s.color,
                }}
                title={`${s.name}: ${s.value}`}
              />
            ))}
          </div>
          <div className='grid grid-cols-2 gap-2 text-xs'>
            {statusData.map((s) => (
              <div key={s.name} className='flex items-center justify-between'>
                <span className='flex items-center gap-1'>
                  <div
                    className='w-2 h-2 rounded-full'
                    style={{ backgroundColor: s.color }}
                  ></div>
                  {s.name}
                </span>
                <span className='font-medium'>{s.value}</span>
              </div>
            ))}
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

      {/* Priority & Category */}
      <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm flex items-center gap-2'>
              <PieIcon className='h-4 w-4' />
              Priority Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {priorityData.length > 0 ? (
              <div className='h-[180px]'>
                <ResponsiveContainer width='100%' height='100%'>
                  <PieChart>
                    <Pie
                      data={priorityData}
                      dataKey='value'
                      nameKey='name'
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={2}
                      isAnimationActive={false}
                    >
                      {priorityData.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={priorityColors[entry.name as TaskPriority]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      formatter={(value: number, name: string) => [
                        `${value}`,
                        name.charAt(0).toUpperCase() + name.slice(1),
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className='text-xs text-muted-foreground py-6 text-center'>
                No priority data
              </p>
            )}
            <div className='flex flex-wrap gap-x-3 gap-y-1 justify-center mt-1'>
              {priorityData.map((entry) => (
                <span
                  key={entry.name}
                  className='flex items-center gap-1 text-xs capitalize text-muted-foreground'
                >
                  <span
                    className='w-2 h-2 rounded-full'
                    style={{
                      backgroundColor:
                        priorityColors[entry.name as TaskPriority],
                    }}
                  />
                  {entry.name} ({entry.value})
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm flex items-center gap-2'>
              <BarChart3 className='h-4 w-4' />
              Category Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            {categoryData.length > 0 ? (
              <div className='h-[180px]'>
                <ResponsiveContainer width='100%' height='100%'>
                  <BarChart
                    data={categoryData}
                    layout='vertical'
                    margin={{ top: 0, right: 12, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray='3 3'
                      stroke={chartGridColor}
                      horizontal={false}
                    />
                    <XAxis type='number' hide allowDecimals={false} />
                    <YAxis
                      type='category'
                      dataKey='name'
                      width={70}
                      tick={{ fontSize: 10, fill: chartAxisColor }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: 'hsl(var(--muted))' }}
                      contentStyle={chartTooltipStyle}
                      formatter={(value: number) => [`${value}`, 'Tasks']}
                    />
                    <Bar
                      dataKey='value'
                      radius={[0, 4, 4, 0]}
                      isAnimationActive={false}
                    >
                      {categoryData.map((_, i) => (
                        <Cell
                          key={i}
                          fill={categoryPalette[i % categoryPalette.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className='text-xs text-muted-foreground py-6 text-center'>
                No category data
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Stats */}
      <div className='grid grid-cols-2 gap-2 text-xs'>
        <Card>
          <CardContent className='p-3 text-center'>
            <Calendar className='h-4 w-4 mx-auto mb-1 text-orange-500' />
            <div className='font-bold text-orange-600'>{upcomingDeadlines}</div>
            <div className='text-muted-foreground'>Due This Week</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className='p-3 text-center'>
            <CheckCircle2 className='h-4 w-4 mx-auto mb-1 text-green-500' />
            <div className='font-bold text-green-600'>{completedInRange}</div>
            <div className='text-muted-foreground'>
              Completed ({rangeLabel})
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alerts */}
      {(stats.overdue > 0 || upcomingDeadlines > 3) && (
        <Card className='border-orange-200 bg-orange-50 dark:bg-orange-950/40 dark:border-orange-900'>
          <CardContent className='p-3'>
            <div className='flex items-center gap-2 text-orange-800 dark:text-orange-300'>
              <AlertTriangle className='h-4 w-4' />
              <span className='text-xs font-medium'>Attention Needed</span>
            </div>
            <div className='text-xs text-orange-700 dark:text-orange-400/90 mt-1'>
              {stats.overdue > 0 && `${stats.overdue} overdue tasks. `}
              {upcomingDeadlines > 3 &&
                `${upcomingDeadlines} tasks due this week.`}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
