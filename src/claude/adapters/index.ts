/**
 * Claude Adapters Module
 *
 * Exports adapters for integrating Claude Agent with UI frameworks.
 */

export {
  runChat,
  cancelActiveRun,
  // Concurrent sessions (P2): detach the local run without killing the backend
  // worker (session switch / new chat); unsubscribe a left-behind session's stream.
  detachActiveRun,
  unsubscribeSession,
  startPreview,
  stopPreview,
  sharePreview,
  respondApproval,
  abort,
  resumeSession,
  createSession,
  initSession,
  newSession,
  disconnect,
  getSessionId,
  setSessionId,
  clearSession,
  checkIsQueryRunning,
  notifyUserAbort,
  onSessionInit,
} from './ws-adapter';
