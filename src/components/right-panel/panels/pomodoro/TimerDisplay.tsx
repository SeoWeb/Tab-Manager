'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Play,
  Pause,
  Square,
  RotateCcw,
  Target,
  Coffee,
  Timer,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTime, getProgress, getSessionColor } from './config';
import type { SessionType, TimerState } from './types';

function getSessionIcon(sessionType: SessionType) {
  if (sessionType === 'work') return Target;
  if (sessionType === 'shortBreak' || sessionType === 'longBreak')
    return Coffee;
  return Timer;
}

interface TimerDisplayProps {
  sessionType: SessionType;
  timerState: TimerState;
  timeLeft: number;
  selectedDuration: number;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  onReset: () => void;
  onStartWork: () => void;
}

export function TimerDisplay({
  sessionType,
  timerState,
  timeLeft,
  selectedDuration,
  onStart,
  onPause,
  onStop,
  onReset,
  onStartWork,
}: TimerDisplayProps) {
  const SessionIcon = getSessionIcon(sessionType);

  return (
    <Card>
      <CardContent className='p-6'>
        <div className='text-center space-y-4'>
          {/* Session Type Indicator */}
          <div className='flex items-center justify-center gap-2'>
            <div
              className={cn(
                'flex items-center gap-1',
                getSessionColor(sessionType)
              )}
            >
              <SessionIcon className='h-4 w-4' />
              <span className='text-sm font-medium capitalize'>
                {sessionType === 'shortBreak'
                  ? 'Short Break'
                  : sessionType === 'longBreak'
                    ? 'Long Break'
                    : sessionType}
              </span>
            </div>
            {timerState !== 'idle' && (
              <Badge variant='outline' className='text-xs'>
                {timerState}
              </Badge>
            )}
          </div>

          {/* Timer Display */}
          <div className='space-y-3'>
            <div className='text-4xl font-mono font-bold'>
              {formatTime(timeLeft)}
            </div>

            {timerState !== 'idle' && (
              <Progress
                value={getProgress(sessionType, selectedDuration, timeLeft)}
                className='h-2'
              />
            )}
          </div>

          {/* Timer Controls */}
          <div className='flex items-center justify-center gap-2'>
            {timerState === 'idle' ? (
              <Button
                onClick={onStart}
                disabled={!selectedDuration}
                className='flex items-center gap-2'
              >
                <Play className='h-4 w-4' />
                Start Focus Session
              </Button>
            ) : timerState === 'running' ? (
              <Button
                onClick={onPause}
                variant='outline'
                className='flex items-center gap-2'
              >
                <Pause className='h-4 w-4' />
                Pause
              </Button>
            ) : timerState === 'paused' ? (
              <Button onClick={onStart} className='flex items-center gap-2'>
                <Play className='h-4 w-4' />
                Resume
              </Button>
            ) : (
              <Button onClick={onStartWork} className='flex items-center gap-2'>
                <Play className='h-4 w-4' />
                Start Work Session
              </Button>
            )}

            {timerState !== 'idle' && (
              <Button
                onClick={onStop}
                variant='outline'
                size='sm'
                className='flex items-center gap-1'
              >
                <Square className='h-3 w-3' />
                Stop
              </Button>
            )}

            <Button
              onClick={onReset}
              variant='ghost'
              size='sm'
              className='flex items-center gap-1'
            >
              <RotateCcw className='h-3 w-3' />
              Reset
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
