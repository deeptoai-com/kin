/**
 * Unit tests for the SessionRegistry (concurrent sessions / background-continue,
 * PRD 2026-06-15). Encodes the contracts ws-server relies on:
 *  - workers are tracked independently of the WS connection (so a refresh/new
 *    tab still sees them) — FR3 cap + FR4 running-state;
 *  - silent init runs don't count toward the cap or the running list;
 *  - subscriber bookkeeping survives re-subscription and connection close, so a
 *    worker's output fans out to whoever is currently viewing the session.
 */
import { describe, it, expect, beforeEach } from 'vitest';
// @ts-expect-error - .js module without type declarations
import { SessionRegistry } from '../../src/server/concurrency/session-registry.js';

// Fake worker / fake ws — the registry never touches their internals.
const worker = (pid: number) => ({ pid });
const conn = (id: string) => ({ id });

describe('SessionRegistry', () => {
  let reg: InstanceType<typeof SessionRegistry>;
  beforeEach(() => {
    reg = new SessionRegistry();
  });

  describe('register / get / unregister', () => {
    it('tracks a worker by session id', () => {
      reg.register({ sessionId: 's1', userId: 'u1', worker: worker(1) });
      expect(reg.has('s1')).toBe(true);
      expect(reg.getWorker('s1')).toEqual({ pid: 1 });
      expect(reg.get('s1')?.userId).toBe('u1');
      expect(reg.size).toBe(1);
    });

    it('unregister removes it and is idempotent', () => {
      reg.register({ sessionId: 's1', userId: 'u1', worker: worker(1) });
      expect(reg.unregister('s1')).toBe(true);
      expect(reg.has('s1')).toBe(false);
      expect(reg.unregister('s1')).toBe(false); // already gone
      expect(reg.getWorker('s1')).toBeUndefined();
    });

    it('register requires a sessionId', () => {
      expect(() => reg.register({ sessionId: '', userId: 'u1', worker: worker(1) })).toThrow();
    });
  });

  describe('FR3 — per-user cap counts across connections', () => {
    it('counts a user\'s active sessions regardless of which connection started them', () => {
      // u1 starts 3 sessions (imagine across 2 tabs); the registry is global so
      // the count is the same no matter the connection.
      reg.register({ sessionId: 'a', userId: 'u1', worker: worker(1) });
      reg.register({ sessionId: 'b', userId: 'u1', worker: worker(2) });
      reg.register({ sessionId: 'c', userId: 'u1', worker: worker(3) });
      reg.register({ sessionId: 'd', userId: 'u2', worker: worker(4) });
      expect(reg.countByUser('u1')).toBe(3);
      expect(reg.countByUser('u2')).toBe(1);
      expect(reg.countByUser('nobody')).toBe(0);
    });

    it('count drops when a worker is unregistered (frees a cap slot)', () => {
      reg.register({ sessionId: 'a', userId: 'u1', worker: worker(1) });
      reg.register({ sessionId: 'b', userId: 'u1', worker: worker(2) });
      expect(reg.countByUser('u1')).toBe(2);
      reg.unregister('a');
      expect(reg.countByUser('u1')).toBe(1);
      reg.unregister('b');
      expect(reg.countByUser('u1')).toBe(0);
    });

    it('silent init runs do NOT count toward the cap', () => {
      reg.register({ sessionId: 'a', userId: 'u1', worker: worker(1), silent: true });
      reg.register({ sessionId: 'b', userId: 'u1', worker: worker(2) });
      expect(reg.countByUser('u1')).toBe(1); // only the real run
      expect(reg.has('a')).toBe(true); // but still tracked for routing/abort
    });
  });

  describe('FR4 — running-state list (server-authoritative)', () => {
    it('lists a user\'s running session ids', () => {
      reg.register({ sessionId: 'a', userId: 'u1', worker: worker(1) });
      reg.register({ sessionId: 'b', userId: 'u1', worker: worker(2) });
      reg.register({ sessionId: 'c', userId: 'u2', worker: worker(3) });
      expect(new Set(reg.listByUser('u1'))).toEqual(new Set(['a', 'b']));
      expect(reg.listByUser('u2')).toEqual(['c']);
      expect(reg.listByUser('nobody')).toEqual([]);
    });

    it('excludes silent init runs from the running list', () => {
      reg.register({ sessionId: 'a', userId: 'u1', worker: worker(1), silent: true });
      reg.register({ sessionId: 'b', userId: 'u1', worker: worker(2) });
      expect(reg.listByUser('u1')).toEqual(['b']);
    });

    it('a finished run leaves the list', () => {
      reg.register({ sessionId: 'a', userId: 'u1', worker: worker(1) });
      reg.unregister('a');
      expect(reg.listByUser('u1')).toEqual([]);
    });
  });

  describe('subscribers — fan-out bookkeeping', () => {
    it('subscribe/unsubscribe a connection to a live session (own user)', () => {
      reg.register({ sessionId: 's1', userId: 'u1', worker: worker(1) });
      const wsA = conn('A');
      const wsB = conn('B');
      expect(reg.subscribe('s1', wsA, 'u1')).toBe(true);
      reg.subscribe('s1', wsB, 'u1');
      expect(reg.subscribers('s1')).toEqual(new Set([wsA, wsB]));
      reg.unsubscribe('s1', wsA);
      expect(reg.subscribers('s1')).toEqual(new Set([wsB]));
    });

    it('subscribing to a session with no live worker is a no-op', () => {
      const wsA = conn('A');
      expect(reg.subscribe('ghost', wsA, 'u1')).toBe(false);
      expect(reg.subscribers('ghost').size).toBe(0);
    });

    it('a session can have zero subscribers (background continue) and still run', () => {
      reg.register({ sessionId: 's1', userId: 'u1', worker: worker(1) });
      const wsA = conn('A');
      reg.subscribe('s1', wsA, 'u1');
      reg.unsubscribe('s1', wsA); // user navigated away
      expect(reg.has('s1')).toBe(true); // worker still tracked → keeps running
      expect(reg.subscribers('s1').size).toBe(0);
      expect(reg.countByUser('u1')).toBe(1);
    });

    it('re-register (same-session re-run) carries existing subscribers over', () => {
      reg.register({ sessionId: 's1', userId: 'u1', worker: worker(1) });
      const wsA = conn('A');
      reg.subscribe('s1', wsA, 'u1');
      reg.register({ sessionId: 's1', userId: 'u1', worker: worker(2) }); // new worker
      expect(reg.getWorker('s1')).toEqual({ pid: 2 });
      expect(reg.subscribers('s1')).toEqual(new Set([wsA])); // viewer preserved
    });

    it('unregister drops the subscribers with the runtime', () => {
      reg.register({ sessionId: 's1', userId: 'u1', worker: worker(1) });
      reg.subscribe('s1', conn('A'), 'u1');
      reg.unregister('s1');
      expect(reg.subscribers('s1').size).toBe(0);
    });
  });

  describe('cross-user isolation (BLOCKER B1 — ownership boundary)', () => {
    it('a different user CANNOT subscribe to your running session', () => {
      reg.register({ sessionId: 's1', userId: 'u1', worker: worker(1) });
      const attacker = conn('attacker');
      // u2 knows s1 (it's in the URL) and tries to tap u1's live stream.
      expect(reg.subscribe('s1', attacker, 'u2')).toBe(false);
      expect(reg.subscribers('s1').size).toBe(0);
    });

    it('ownerOf reports the run owner (for abort/approval gating, B2)', () => {
      reg.register({ sessionId: 's1', userId: 'u1', worker: worker(1) });
      expect(reg.ownerOf('s1')).toBe('u1');
      expect(reg.ownerOf('nope')).toBeUndefined();
      reg.unregister('s1');
      expect(reg.ownerOf('s1')).toBeUndefined();
    });
  });

  describe('unsubscribeConnection / hasActiveForConnection (disconnect + idle)', () => {
    it('drops a connection from every session it was viewing, leaving workers alive', () => {
      reg.register({ sessionId: 's1', userId: 'u1', worker: worker(1) });
      reg.register({ sessionId: 's2', userId: 'u1', worker: worker(2) });
      const wsA = conn('A');
      const wsB = conn('B');
      reg.subscribe('s1', wsA, 'u1');
      reg.subscribe('s2', wsA, 'u1');
      reg.subscribe('s2', wsB, 'u1');

      reg.unsubscribeConnection(wsA); // A's socket closed

      expect(reg.subscribers('s1').size).toBe(0);
      expect(reg.subscribers('s2')).toEqual(new Set([wsB]));
      // Both workers keep running (background continue): unregister was NOT called.
      expect(reg.has('s1')).toBe(true);
      expect(reg.has('s2')).toBe(true);
    });

    it('hasActiveForConnection reflects whether the socket is viewing any live run', () => {
      reg.register({ sessionId: 's1', userId: 'u1', worker: worker(1) });
      const wsA = conn('A');
      expect(reg.hasActiveForConnection(wsA)).toBe(false);
      reg.subscribe('s1', wsA, 'u1');
      expect(reg.hasActiveForConnection(wsA)).toBe(true);
      reg.unsubscribe('s1', wsA);
      expect(reg.hasActiveForConnection(wsA)).toBe(false);
    });
  });
});
