import { AppState } from '../../types';
import type { PomodoroSession } from '@/types/tasks';
import { generateId, generateTimestamp } from './utils';

export const createPomodoroActions = (
  set: (fn: (state: AppState) => AppState) => void
) => ({
  startPomodoroSession: (taskId: string, duration: number = 25) =>
    set((state: AppState) => {
      const newSession: PomodoroSession = {
        id: generateId(),
        taskId,
        duration,
        startTime: generateTimestamp(),
        isCompleted: false,
      };

      return {
        ...state,
        activePomodoroSession: newSession,
        pomodoroSessions: [...state.pomodoroSessions, newSession],
        activeTaskId: taskId,
      };
    }),

  pausePomodoroSession: () =>
    set((state: AppState) => {
      const session = state.activePomodoroSession;
      if (!session || session.isPaused) return state;

      const pausedSession: PomodoroSession = {
        ...session,
        isPaused: true,
        pausedAt: generateTimestamp(),
      };

      return {
        ...state,
        activePomodoroSession: pausedSession,
        pomodoroSessions: state.pomodoroSessions.map((s) =>
          s.id === pausedSession.id ? pausedSession : s
        ),
      };
    }),

  resumePomodoroSession: () =>
    set((state: AppState) => {
      const session = state.activePomodoroSession;
      if (!session || !session.isPaused) return state;

      const pausedMs = session.pausedAt
        ? Date.now() - session.pausedAt.getTime()
        : 0;

      const resumedSession: PomodoroSession = {
        ...session,
        isPaused: false,
        pausedAt: undefined,
        pausedDuration: (session.pausedDuration ?? 0) + pausedMs,
      };

      return {
        ...state,
        activePomodoroSession: resumedSession,
        pomodoroSessions: state.pomodoroSessions.map((s) =>
          s.id === resumedSession.id ? resumedSession : s
        ),
      };
    }),

  completePomodoroSession: () =>
    set((state: AppState) => {
      if (!state.activePomodoroSession) return state;

      const completedSession = {
        ...state.activePomodoroSession,
        endTime: generateTimestamp(),
        isCompleted: true,
      };

      const updatedSessions = state.pomodoroSessions.map((session) =>
        session.id === completedSession.id ? completedSession : session
      );

      return {
        ...state,
        activePomodoroSession: null,
        pomodoroSessions: updatedSessions,
      };
    }),

  cancelPomodoroSession: () =>
    set((state: AppState) => ({
      ...state,
      activePomodoroSession: null,
      pomodoroSessions: state.pomodoroSessions.filter(
        (session) => session.id !== state.activePomodoroSession?.id
      ),
    })),
});
