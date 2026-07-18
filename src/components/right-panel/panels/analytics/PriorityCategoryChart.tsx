'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PieChart as PieIcon } from 'recharts';
import { BarChart3 } from 'lucide-react';
import type { TaskPriority } from '@/types/tasks';
import {
  categoryPalette,
  chartAxisColor,
  chartGridColor,
  chartTooltipStyle,
  priorityColors,
} from '@/components/right-panel/panels/analytics/theme';

interface PriorityDistributionChartProps {
  priorityData: { name: TaskPriority; value: number }[];
}

export function PriorityDistributionChart({
  priorityData,
}: PriorityDistributionChartProps) {
  return (
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
                  backgroundColor: priorityColors[entry.name as TaskPriority],
                }}
              />
              {entry.name} ({entry.value})
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface CategoryBreakdownChartProps {
  categoryData: { name: string; value: number }[];
}

export function CategoryBreakdownChart({
  categoryData,
}: CategoryBreakdownChartProps) {
  return (
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
  );
}
