/**
 * SessionRegistry — a module-level, connection-INDEPENDENT registry of running
 * agent sessions. It decouples a worker's lifecycle from the WebSocket
 * connection that started it, which is what makes concurrent sessions /
 * background-continue possible (PRD 2026-06-15 «并发会话 / 后台续跑»).
 *
 * Why connection-independent (vs. the per-connection `ws.workers` the PRD §4.1
 * sketched):
 *  - FR3 (per-user cap of 3) must count a user's running sessions across ALL
 *    their tabs — and each tab is a separate WS connection. A per-connection map
 *    can't see the other connection's workers.
 *  - FR4 (running-state) must survive a page refresh, which is a brand-new WS
 *    connection. A per-connection map is empty immediately after refresh.
 * This mirrors claude-agent-kit's `sessionManager` (sessions owned centrally; a
 * client just holds a "subscribe" pointer — see references/.../websocket-handler.ts).
 *
 * Responsibilities (pure bookkeeping — it never spawns or kills processes; the
 * caller owns the child_process and tells the registry about lifecycle events):
 *  - track which session ids have a live worker, and who owns them (userId);
 *  - track which connections are currently SUBSCRIBED to (i.e. viewing) a
 *    session, so a worker's output can be fanned out to the right sockets even
 *    after the original connection navigated away / refreshed;
 *  - answer "how many sessions is this user running" (cap) and "which sessions
 *    is this user running" (sidebar running-state).
 *
 * Plain JS ESM so ws-server.mjs imports it without a build step (same as
 * semaphore.js / idle-reaper.js).
 *
 * @typedef {Object} SessionRuntime
 * @property {string} sessionId   The OUTPUT workspace session id this worker writes to.
 * @property {string} userId      Owner of the run (for the per-user cap / FR3).
 * @property {*} worker           The spawned child_process handle.
 * @property {boolean} silent     A silent init run (init_session); excluded from
 *                                the per-user cap and the running-state list.
 * @property {Set<*>} subscribers Connections currently viewing this session.
 */

export class SessionRegistry {
  constructor() {
    /** @type {Map<string, SessionRuntime>} sessionId → runtime (ALL live workers). */
    this._runtimes = new Map();
    /** @type {Map<string, Set<string>>} userId → set of NON-silent session ids (cap / FR4 index). */
    this._byUser = new Map();
  }

  /**
   * Register a freshly-spawned worker for a session. If a runtime already exists
   * for this session (a same-session re-run that raced its predecessor's close),
   * its subscribers are carried over so a live viewer isn't dropped; the caller
   * is responsible for having killed/closed the old worker first.
   * @param {{ sessionId: string, userId: string, worker: *, silent?: boolean }} params
   * @returns {SessionRuntime}
   */
  register({ sessionId, userId, worker, silent = false }) {
    if (!sessionId) throw new Error('register: sessionId required');
    const existing = this._runtimes.get(sessionId);
    const subscribers = existing ? existing.subscribers : new Set();
    const runtime = { sessionId, userId, worker, silent, subscribers };
    this._runtimes.set(sessionId, runtime);
    if (!silent && userId) {
      let set = this._byUser.get(userId);
      if (!set) {
        set = new Set();
        this._byUser.set(userId, set);
      }
      set.add(sessionId);
    }
    return runtime;
  }

  /**
   * Remove a session's runtime (worker closed/aborted/crashed). Idempotent.
   * Subscribers are dropped with it — a closed run has nothing left to stream.
   * @param {string} sessionId
   * @returns {boolean} true if a runtime was removed.
   */
  unregister(sessionId) {
    const runtime = this._runtimes.get(sessionId);
    if (!runtime) return false;
    this._runtimes.delete(sessionId);
    if (runtime.userId) {
      const set = this._byUser.get(runtime.userId);
      if (set) {
        set.delete(sessionId);
        if (set.size === 0) this._byUser.delete(runtime.userId);
      }
    }
    return true;
  }

  /** @param {string} sessionId @returns {SessionRuntime | undefined} */
  get(sessionId) {
    return this._runtimes.get(sessionId);
  }

  /** @param {string} sessionId @returns {*} the worker handle, or undefined. */
  getWorker(sessionId) {
    return this._runtimes.get(sessionId)?.worker;
  }

  /** @param {string} sessionId @returns {boolean} */
  has(sessionId) {
    return this._runtimes.has(sessionId);
  }

  /**
   * Active (non-silent) session count for a user — the number that FR3 caps at 3.
   * @param {string} userId
   * @returns {number}
   */
  countByUser(userId) {
    return this._byUser.get(userId)?.size ?? 0;
  }

  /**
   * The user's running (non-silent) session ids — the server-authoritative
   * source the sidebar renders spinners from (FR4), correct across tabs/refresh.
   * @param {string} userId
   * @returns {string[]}
   */
  listByUser(userId) {
    const set = this._byUser.get(userId);
    return set ? [...set] : [];
  }

  /**
   * The userId that owns a session's run, or undefined if no worker is running for
   * it. ws-server gates abort / approval_response on this (cross-user isolation):
   * knowing another user's sessionId (it's in the /agents/c/$id URL) must not let
   * you act on their run.
   * @param {string} sessionId
   * @returns {string | undefined}
   */
  ownerOf(sessionId) {
    return this._runtimes.get(sessionId)?.userId;
  }

  /**
   * Subscribe a connection to a session's live output. OWNERSHIP-ENFORCING — the
   * security boundary for cross-user isolation: returns false (no subscription)
   * unless the run exists AND is owned by `userId`. Without this, anyone who knows
   * a sessionId could tap another user's live stream (assistant output, tool IO,
   * approval requests). No-op (false) too if the session has no live worker.
   * @param {string} sessionId
   * @param {*} ws
   * @param {string} userId  The requesting connection's user id (required).
   * @returns {boolean} true iff subscribed.
   */
  subscribe(sessionId, ws, userId) {
    const runtime = this._runtimes.get(sessionId);
    if (!runtime) return false;
    if (runtime.userId !== userId) return false;
    runtime.subscribers.add(ws);
    return true;
  }

  /**
   * Unsubscribe a connection from a session. Idempotent.
   * @param {string} sessionId
   * @param {*} ws
   */
  unsubscribe(sessionId, ws) {
    this._runtimes.get(sessionId)?.subscribers.delete(ws);
  }

  /**
   * Drop a connection from EVERY session it's viewing (on socket close). The
   * workers keep running (background continue) — only the viewer pointer goes.
   * @param {*} ws
   */
  unsubscribeConnection(ws) {
    for (const runtime of this._runtimes.values()) {
      runtime.subscribers.delete(ws);
    }
  }

  /**
   * Current subscribers of a session (the sockets a frame should fan out to).
   * @param {string} sessionId
   * @returns {Set<*>} empty set if none / no runtime.
   */
  subscribers(sessionId) {
    return this._runtimes.get(sessionId)?.subscribers ?? new Set();
  }

  /**
   * Is this connection subscribed to ANY live session? Used by idle-reaping to
   * avoid closing a socket that's actively streaming a run's output.
   * @param {*} ws
   * @returns {boolean}
   */
  hasActiveForConnection(ws) {
    for (const runtime of this._runtimes.values()) {
      if (runtime.subscribers.has(ws)) return true;
    }
    return false;
  }

  /** Total live workers (all users, incl. silent) — for diagnostics/tests. */
  get size() {
    return this._runtimes.size;
  }
}

/**
 * The process-wide singleton. ws-server imports THIS (not the class) so every
 * connection shares one registry.
 */
export const sessionRegistry = new SessionRegistry();
