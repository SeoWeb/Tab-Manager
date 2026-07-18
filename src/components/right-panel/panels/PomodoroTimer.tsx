'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Timer } from 'lucide-react';
import type { AdvancedTask, PomodoroSession } from '@/types/tasks';
import {
  nextSessionAfterComplete,
  POMODORO_DURATIONS,
} from './pomodoro/config';
import type { TimerState, SessionType } from './pomodoro/types';
import { TaskSelect } from './pomodoro/TaskSelect';
import { TimerDisplay } from './pomodoro/TimerDisplay';
import { SessionStats } from './pomodoro/SessionStats';

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
      setTimerState(activePomodoroSession.isPaused ? 'paused' : 'running');
      const elapsed = Math.floor(
        (Date.now() -
          activePomodoroSession.startTime.getTime() -
          (activePomodoroSession.pausedDuration ?? 0)) /
          1000
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
    const next = nextSessionAfterComplete(
      sessionType,
      completedPomodoros,
      selectedDuration
    );
    setCompletedPomodoros((prev) => prev + 1);
    if (sessionType === 'work') {
      onCompleteSession();
    }
    setSessionType(next.sessionType);
    setTimeLeft(next.timeLeft);
    setTimerState(next.timerState);
  }, [sessionType, completedPomodoros, selectedDuration, onCompleteSession]);

  // Timer countdown effect
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (timerState === 'running' && activePomodoroSession) {
      interval = setInterval(() => {
        const session = activePomodoroSession;
        const elapsed = Math.floor(
          (Date.now() -
            session.startTime.getTime() -
            (session.pausedDuration ?? 0)) /
            1000
        );
        const remaining = Math.max(0, session.duration * 60 - elapsed);
        setTimeLeft(remaining);
        if (remaining <= 0) {
          handleTimerComplete();
        }
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [timerState, activePomodoroSession, handleTimerComplete]);

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

  const handleDurationChange = (duration: number) => {
    setSelectedDuration(duration);
    if (timerState === 'idle') {
      setTimeLeft(duration * 60);
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

      <TaskSelect
        activeTask={activeTask}
        availableTasks={availableTasks}
        selectedDuration={selectedDuration}
        timerState={timerState}
        onSetActiveTask={onSetActiveTask}
        onDurationChange={handleDurationChange}
      />

      <TimerDisplay
        sessionType={sessionType}
        timerState={timerState}
        timeLeft={timeLeft}
        selectedDuration={selectedDuration}
        onStart={handleStart}
        onPause={handlePause}
        onStop={handleStop}
        onReset={handleReset}
        onStartWork={() => {
          setTimerState('idle');
          setTimeLeft(selectedDuration * 60);
          setSessionType('work');
        }}
      />

      <SessionStats
        completedPomodoros={completedPomodoros}
        selectedDuration={selectedDuration}
      />

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
