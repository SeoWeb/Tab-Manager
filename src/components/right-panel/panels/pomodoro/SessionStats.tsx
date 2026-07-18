'use client';

import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, Clock, Target } from 'lucide-react';

interface SessionStatsProps {
  completedPomodoros: number;
  selectedDuration: number;
}

export function SessionStats({
  completedPomodoros,
  selectedDuration,
}: SessionStatsProps) {
  return (
    <div className='grid grid-cols-3 gap-2 text-xs'>
      <Card>
        <CardContent className='p-3 text-center'>
          <CheckCircle2 className='h-4 w-4 mx-auto mb-1 text-green-500' />
          <div className='font-bold text-green-600'>{completedPomodoros}</div>
          <div className='text-muted-foreground'>Completed</div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className='p-3 text-center'>
          <Clock className='h-4 w-4 mx-auto mb-1 text-blue-500' />
          <div className='font-bold text-blue-600'>
            {Math.floor((completedPomodoros * selectedDuration) / 60)}h{' '}
            {(completedPomodoros * selectedDuration) % 60}m
          </div>
          <div className='text-muted-foreground'>Focus Time</div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className='p-3 text-center'>
          <Target className='h-4 w-4 mx-auto mb-1 text-purple-500' />
          <div className='font-bold text-purple-600'>
            {Math.floor(completedPomodoros / 4)}
          </div>
          <div className='text-muted-foreground'>Cycles</div>
        </CardContent>
      </Card>
    </div>
  );
}
