'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Play,
  Pause,
  Square,
  RotateCcw,
  Timer,
  Coffee,
  Target,
  Clock,
  CheckCircle2,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AdvancedTask, PomodoroSession } from '@/types/tasks';

interface PomodoroTimerProps {
  tasks: AdvancedTask[];
  activeTask: AdvancedTask | null;
  activePomodoroSession: PomodoroSession | null;
  onStartSession: (taskId: string, duration?: number) => void;
  onPauseSession: () => void;
  onResumeSession: () => void;
  onCompleteSession: () => void;
  onCancelSession: () => void;
  onSetActiveTask: (taskId: string | null) => void;
}

type TimerState = 'idle' | 'running' | 'paused' | 'break';
type SessionType = 'work' | 'shortBreak' | 'longBreak';

const POMODORO_DURATIONS = {
  work: 25,
  shortBreak: 5,
  longBreak: 15,
};

export default function PomodoroTimer({
  tasks,
  activeTask,
  activePomodoroSession,
  onStartSession,
  onPauseSession,
  onResumeSession,
  onCompleteSession,
  onCancelSession,
  onSetActiveTask,
}: PomodoroTimerProps) {
  const [timerState, setTimerState] = useState<TimerState>('idle');
  const [sessionType, setSessionType] = useState<SessionType>('work');
  const [timeLeft, setTimeLeft] = useState(POMODORO_DURATIONS.work * 60); // in seconds
  const [selectedDuration, setSelectedDuration] = useState(25);
  const [completedPomodoros, setCompletedPomodoros] = useState(0);

  // Update timer state based on active session
  useEffect(() => {
    if (activePomodoroSession) {
      setTimerState('running');
      const elapsed = Math.floor(
        (Date.now() - activePomodoroSession.startTime.getTime()) / 1000
      );
      const remaining = Math.max(
        0,
        activePomodoroSession.duration * 60 - elapsed
      );
      setTimeLeft(remaining);
    } else {
      setTimerState('idle');
    }
  }, [activePomodoroSession]);

  const handleTimerComplete = useCallback(() => {
    if (sessionType === 'work') {
      setCompletedPomodoros((prev) => prev + 1);
      onCompleteSession();

      // Auto-start break
      const isLongBreak = (completedPomodoros + 1) % 4 === 0;
      const breakType = isLongBreak ? 'longBreak' : 'shortBreak';
      setSessionType(breakType);
      setTimeLeft(POMODORO_DURATIONS[breakType] * 60);
      setTimerState('break');
    } else {
      // Break completed, ready for next work session
      setSessionType('work');
      setTimeLeft(selectedDuration * 60);
      setTimerState('idle');
    }
  }, [sessionType, completedPomodoros, selectedDuration, onCompleteSession]);

  // Timer countdown effect
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (timerState === 'running' && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            handleTimerComplete();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [timerState, timeLeft, handleTimerComplete]);

  const handleStart = () => {
    if (!activeTask) return;

    if (timerState === 'idle') {
      onStartSession(activeTask.id, selectedDuration);
      setTimerState('running');
      setTimeLeft(selectedDuration * 60);
      setSessionType('work');
    } else if (timerState === 'paused') {
      onResumeSession();
      setTimerState('running');
    }
  };

  const handlePause = () => {
    onPauseSession();
    setTimerState('paused');
  };

  const handleStop = () => {
    onCancelSession();
    setTimerState('idle');
    setTimeLeft(selectedDuration * 60);
    setSessionType('work');
  };

  const handleReset = () => {
    handleStop();
    setCompletedPomodoros(0);
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getProgress = (): number => {
    const totalDuration =
      sessionType === 'work'
        ? selectedDuration * 60
        : POMODORO_DURATIONS[sessionType] * 60;
    return ((totalDuration - timeLeft) / totalDuration) * 100;
  };

  const getSessionIcon = () => {
    switch (sessionType) {
      case 'work':
        return <Target className='h-4 w-4' />;
      case 'shortBreak':
      case 'longBreak':
        return <Coffee className='h-4 w-4' />;
      default:
        return <Timer className='h-4 w-4' />;
    }
  };

  const getSessionColor = () => {
    switch (sessionType) {
      case 'work':
        return 'text-blue-600';
      case 'shortBreak':
        return 'text-green-600';
      case 'longBreak':
        return 'text-purple-600';
      default:
        return 'text-gray-600';
    }
  };

  const availableTasks = tasks.filter(
    (task) =>
      !task.isArchived &&
      task.status !== 'completed' &&
      task.status !== 'cancelled'
  );

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h3 className='text-lg font-semibold flex items-center gap-2'>
          <Timer className='h-5 w-5' />
          Pomodoro Timer
        </h3>
        <Badge variant='outline' className='text-xs'>
          {completedPomodoros} completed
        </Badge>
      </div>

      {/* Task Selection */}
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-sm'>Select Task</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          <Select value={activeTask?.id || ''} onValueChange={onSetActiveTask}>
            <SelectTrigger className='text-sm'>
              <SelectValue placeholder='Choose a task to focus on...' />
            </SelectTrigger>
            <SelectContent>
              {availableTasks.map((task) => (
                <SelectItem key={task.id} value={task.id}>
                  <div className='flex items-center gap-2'>
                    <span className='truncate'>{task.title}</span>
                    <Badge variant='outline' className='text-xs'>
                      {task.priority}
                    </Badge>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {activeTask && (
            <div className='p-2 bg-secondary/30 rounded-md'>
              <div className='text-sm font-medium'>{activeTask.title}</div>
              {activeTask.description && (
                <div className='text-xs text-muted-foreground mt-1 line-clamp-2'>
                  {activeTask.description}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Timer Settings */}
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-sm flex items-center gap-2'>
            <Settings className='h-4 w-4' />
            Timer Settings
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='flex items-center gap-2'>
            <Select
              value={selectedDuration.toString()}
              onValueChange={(value) => {
                const duration = parseInt(value);
                setSelectedDuration(duration);
                if (timerState === 'idle') {
                  setTimeLeft(duration * 60);
                }
              }}
              disabled={timerState !== 'idle'}
            >
              <SelectTrigger className='text-sm'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='15'>15 minutes</SelectItem>
                <SelectItem value='25'>25 minutes (Classic)</SelectItem>
                <SelectItem value='30'>30 minutes</SelectItem>
                <SelectItem value='45'>45 minutes</SelectItem>
                <SelectItem value='60'>60 minutes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Timer Display */}
      <Card>
        <CardContent className='p-6'>
          <div className='text-center space-y-4'>
            {/* Session Type Indicator */}
            <div className='flex items-center justify-center gap-2'>
              <div className={cn('flex items-center gap-1', getSessionColor())}>
                {getSessionIcon()}
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
                <Progress value={getProgress()} className='h-2' />
              )}
            </div>

            {/* Timer Controls */}
            <div className='flex items-center justify-center gap-2'>
              {timerState === 'idle' ? (
                <Button
                  onClick={handleStart}
                  disabled={!activeTask}
                  className='flex items-center gap-2'
                >
                  <Play className='h-4 w-4' />
                  Start Focus Session
                </Button>
              ) : timerState === 'running' ? (
                <Button
                  onClick={handlePause}
                  variant='outline'
                  className='flex items-center gap-2'
                >
                  <Pause className='h-4 w-4' />
                  Pause
                </Button>
              ) : timerState === 'paused' ? (
                <Button
                  onClick={handleStart}
                  className='flex items-center gap-2'
                >
                  <Play className='h-4 w-4' />
                  Resume
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    setTimerState('idle');
                    setTimeLeft(selectedDuration * 60);
                    setSessionType('work');
                  }}
                  className='flex items-center gap-2'
                >
                  <Play className='h-4 w-4' />
                  Start Work Session
                </Button>
              )}

              {timerState !== 'idle' && (
                <Button
                  onClick={handleStop}
                  variant='outline'
                  size='sm'
                  className='flex items-center gap-1'
                >
                  <Square className='h-3 w-3' />
                  Stop
                </Button>
              )}

              <Button
                onClick={handleReset}
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

      {/* Session Stats */}
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

      {/* Tips */}
      {timerState === 'idle' && (
        <Card className='border-blue-200 bg-blue-50'>
          <CardContent className='p-3'>
            <div className='text-xs text-blue-800'>
              <strong>Pomodoro Technique:</strong> Work for {selectedDuration}{' '}
              minutes, then take a 5-minute break. After 4 cycles, take a longer
              15-minute break.
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
