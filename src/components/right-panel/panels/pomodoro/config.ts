import type { SessionType } from './types';

export const POMODORO_DURATIONS: Record<SessionType, number> = {
  work: 25,
  shortBreak: 5,
  longBreak: 15,
};

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function getProgress(
  sessionType: SessionType,
  selectedDuration: number,
  timeLeft: number
): number {
  const totalDuration =
    sessionType === 'work'
      ? selectedDuration * 60
      : POMODORO_DURATIONS[sessionType] * 60;
  return ((totalDuration - timeLeft) / totalDuration) * 100;
}

export function getSessionIcon(sessionType: SessionType) {
  // Icons imported lazily to avoid pulling lucide-react into this module.
  // Caller renders; we return the icon name for the component to map.
  switch (sessionType) {
    case 'work':
      return 'target';
    case 'shortBreak':
    case 'longBreak':
      return 'coffee';
    default:
      return 'timer';
  }
}

export function getSessionColor(sessionType: SessionType): string {
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
}

/**
 * Decide the next session after a timer completes.
 * Work → break (long every 4th); break → idle work.
 */
export function nextSessionAfterComplete(
  sessionType: SessionType,
  completedPomodoros: number,
  selectedDuration: number
): {
  sessionType: SessionType;
  timerState: 'idle' | 'break';
  timeLeft: number;
} {
  if (sessionType === 'work') {
    const isLongBreak = (completedPomodoros + 1) % 4 === 0;
    const breakType: SessionType = isLongBreak ? 'longBreak' : 'shortBreak';
    return {
      sessionType: breakType,
      timerState: 'break',
      timeLeft: POMODORO_DURATIONS[breakType] * 60,
    };
  }
  return {
    sessionType: 'work',
    timerState: 'idle',
    timeLeft: selectedDuration * 60,
  };
}
