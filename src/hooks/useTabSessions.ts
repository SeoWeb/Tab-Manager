/**
 * Hook for managing tab sessions
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getSavedSessions,
  saveCurrentSession,
  restoreSession,
  deleteSession,
  startAutoSaveMonitoring,
  checkForSessionRestore,
  type TabSession,
} from '@/lib/tabSessionService';

export const useTabSessions = () => {
  const [sessions, setSessions] = useState<TabSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);

  // Load saved sessions
  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    try {
      const savedSessions = await getSavedSessions();
      setSessions(savedSessions);
    } catch (error) {
      console.error('Error loading sessions:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Save current session
  const saveSession = useCallback(
    async (name?: string) => {
      setIsLoading(true);
      try {
        const newSession = await saveCurrentSession(name);
        if (newSession) {
          await loadSessions(); // Refresh the list
          return newSession;
        }
      } catch (error) {
        console.error('Error saving session:', error);
      } finally {
        setIsLoading(false);
      }
      return null;
    },
    [loadSessions]
  );

  // Restore a session
  const restoreSessionById = useCallback(async (sessionId: string) => {
    setIsLoading(true);
    try {
      const success = await restoreSession(sessionId);
      return success;
    } catch (error) {
      console.error('Error restoring session:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Delete a session
  const deleteSessionById = useCallback(
    async (sessionId: string) => {
      setIsLoading(true);
      try {
        const success = await deleteSession(sessionId);
        if (success) {
          await loadSessions(); // Refresh the list
        }
        return success;
      } catch (error) {
        console.error('Error deleting session:', error);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [loadSessions]
  );

  // Initialize sessions and auto-save monitoring
  useEffect(() => {
    loadSessions();

    // Check for session restore on startup
    checkForSessionRestore();

    // Start auto-save monitoring if enabled
    let cleanup: (() => void) | null = null;
    if (autoSaveEnabled) {
      cleanup = startAutoSaveMonitoring();
    }

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, [loadSessions, autoSaveEnabled]);

  return {
    sessions,
    isLoading,
    autoSaveEnabled,
    setAutoSaveEnabled,
    loadSessions,
    saveSession,
    restoreSession: restoreSessionById,
    deleteSession: deleteSessionById,
  };
};
