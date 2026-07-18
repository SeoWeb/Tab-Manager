'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AreaChart,
  Area,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import {
  chartAxisColor,
  chartGridColor,
  chartTooltipStyle,
} from '@/components/right-panel/panels/analytics/theme';

interface CompletionTrendChartProps {
  series: { label: string; full: string; value: number }[];
  rangeLabel: string;
}

export function CompletionTrendChart({
  series,
  rangeLabel,
}: CompletionTrendChartProps) {
  return (
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
  );
}

interface StatusOverviewChartProps {
  statusData: {
    name: string;
    value: number;
    color: string;
  }[];
  total: number;
  overdue: number;
}

export function StatusOverviewChart({
  statusData,
  total,
  overdue,
}: StatusOverviewChartProps) {
  return (
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
                width: `${total > 0 ? (s.value / total) * 100 : 0}%`,
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
            <span className='font-medium'>{overdue}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
