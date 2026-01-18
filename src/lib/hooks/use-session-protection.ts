/**
 * Session Protection Hook
 *
 * Provides comprehensive session protection features:
 * 1. beforeunload warning - Prevents accidental page close during active query
 * 2. Draft auto-save - Saves unsent input to localStorage
 * 3. Reconnection state recovery - Restores state after WebSocket reconnection
 */

import { useEffect, useCallback, useRef } from 'react';
import { useChatSessionStore } from '~/lib/chat-session-store';

// Storage keys
const DRAFT_STORAGE_KEY = 'claude-chat-draft';
const DRAFT_SESSION_KEY = 'claude-chat-draft-session';

interface DraftData {
  text: string;
  sessionId: string | null;
  timestamp: number;
}

/**
 * Hook for beforeunload protection
 * Shows a warning when user tries to close/refresh page during active query
 */
export function useBeforeUnloadProtection() {
  const isRunning = useChatSessionStore((state) => state.isRunning);

  useEffect(() => {
    if (!isRunning) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      // Standard way to show browser's native confirmation dialog
      event.preventDefault();
      // Chrome requires returnValue to be set
      event.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isRunning]);
}

/**
 * Hook for draft auto-save
 * Automatically saves unsent input text to localStorage
 */
export function useDraftAutoSave(
  getText: () => string,
  setText: (text: string) => void
) {
  const currentSessionId = useChatSessionStore((state) => state.currentSessionId);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');

  // Save draft to localStorage (debounced)
  const saveDraft = useCallback((text: string) => {
    if (typeof window === 'undefined') return;

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce save by 500ms
    saveTimeoutRef.current = setTimeout(() => {
      // Skip if text hasn't changed
      if (text === lastSavedRef.current) return;

      if (text.trim()) {
        const draft: DraftData = {
          text,
          sessionId: currentSessionId,
          timestamp: Date.now(),
        };
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
        lastSavedRef.current = text;
        console.log('[Draft] Saved draft:', text.slice(0, 50) + (text.length > 50 ? '...' : ''));
      } else {
        // Clear draft if empty
        localStorage.removeItem(DRAFT_STORAGE_KEY);
        lastSavedRef.current = '';
      }
    }, 500);
  }, [currentSessionId]);

  // Load draft from localStorage on mount or session change
  const loadDraft = useCallback(() => {
    if (typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!stored) return;

      const draft: DraftData = JSON.parse(stored);

      // Only restore if draft is for current session (or no session specified)
      // and draft is less than 24 hours old
      const isValidSession = !draft.sessionId || draft.sessionId === currentSessionId;
      const isRecent = Date.now() - draft.timestamp < 24 * 60 * 60 * 1000;

      if (isValidSession && isRecent && draft.text.trim()) {
        setText(draft.text);
        lastSavedRef.current = draft.text;
        console.log('[Draft] Restored draft:', draft.text.slice(0, 50) + (draft.text.length > 50 ? '...' : ''));
      } else if (!isRecent) {
        // Clear stale drafts
        localStorage.removeItem(DRAFT_STORAGE_KEY);
      }
    } catch (error) {
      console.warn('[Draft] Failed to load draft:', error);
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    }
  }, [currentSessionId, setText]);

  // Clear draft (called after successful send)
  const clearDraft = useCallback(() => {
    if (typeof window === 'undefined') return;

    localStorage.removeItem(DRAFT_STORAGE_KEY);
    lastSavedRef.current = '';
    console.log('[Draft] Cleared draft');
  }, []);

  // Load draft on mount
  useEffect(() => {
    loadDraft();
  }, [loadDraft]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return {
    saveDraft,
    clearDraft,
    loadDraft,
  };
}

/**
 * Hook for WebSocket reconnection state recovery
 * Tracks connection state and attempts to recover session state after reconnection
 */
export function useReconnectionRecovery(
  onReconnected?: () => void
) {
  const wasConnectedRef = useRef(false);
  const reconnectCallbackRef = useRef(onReconnected);

  // Update callback ref
  useEffect(() => {
    reconnectCallbackRef.current = onReconnected;
  }, [onReconnected]);

  // Listen for custom reconnection events (dispatched by ws-adapter)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleReconnected = () => {
      console.log('[Protection] WebSocket reconnected');
      if (reconnectCallbackRef.current) {
        reconnectCallbackRef.current();
      }
    };

    const handleDisconnected = () => {
      console.log('[Protection] WebSocket disconnected');
      wasConnectedRef.current = true;
    };

    window.addEventListener('ws-reconnected', handleReconnected);
    window.addEventListener('ws-disconnected', handleDisconnected);

    return () => {
      window.removeEventListener('ws-reconnected', handleReconnected);
      window.removeEventListener('ws-disconnected', handleDisconnected);
    };
  }, []);
}

/**
 * Combined hook for all session protection features
 */
export function useSessionProtection(options?: {
  getText?: () => string;
  setText?: (text: string) => void;
  onReconnected?: () => void;
}) {
  // beforeunload protection - always enabled
  useBeforeUnloadProtection();

  // Draft auto-save - only if text accessors provided
  const draftHook = options?.getText && options?.setText
    ? useDraftAutoSave(options.getText, options.setText)
    : { saveDraft: () => {}, clearDraft: () => {}, loadDraft: () => {} };

  // Reconnection recovery
  useReconnectionRecovery(options?.onReconnected);

  return {
    ...draftHook,
  };
}
