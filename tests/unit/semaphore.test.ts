/**
 * Unit tests for the worker-concurrency Semaphore (S1).
 *
 * Encodes the contract ws-server relies on: a hard cap on concurrent permits,
 * FIFO queueing past the cap, permit hand-off on release, and no negative count.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error - .js module without type declarations
import { Semaphore } from '../../src/server/concurrency/semaphore.js';

/** Resolve "pending" if the promise hasn't settled in a microtask turn. */
function settledOrPending(p: Promise<unknown>): Promise<'settled' | 'pending'> {
  return Promise.race([
    p.then(() => 'settled' as const),
    Promise.resolve().then(() => 'pending' as const),
  ]);
}

describe('Semaphore', () => {
  it('allows up to max acquires immediately', async () => {
    const s = new Semaphore(2);
    await s.acquire();
    await s.acquire();
    expect(s.activeCount).toBe(2);
    expect(s.waitingCount).toBe(0);
  });

  it('queues acquires past max', async () => {
    const s = new Semaphore(2);
    await s.acquire();
    await s.acquire();
    const third = s.acquire();
    expect(await settledOrPending(third)).toBe('pending');
    expect(s.waitingCount).toBe(1);
    expect(s.activeCount).toBe(2);
  });

  it('hands a released permit to the next waiter (FIFO), active count stays at max', async () => {
    const s = new Semaphore(1);
    await s.acquire(); // active=1
    const order: number[] = [];
    const w2 = s.acquire().then(() => order.push(2));
    const w3 = s.acquire().then(() => order.push(3));
    expect(s.waitingCount).toBe(2);

    s.release(); // -> w2
    await w2;
    expect(order).toEqual([2]);
    expect(s.activeCount).toBe(1); // permit transferred, not freed
    expect(s.waitingCount).toBe(1);

    s.release(); // -> w3
    await w3;
    expect(order).toEqual([2, 3]);
    expect(s.activeCount).toBe(1);
    expect(s.waitingCount).toBe(0);
  });

  it('decrements when nobody is waiting', async () => {
    const s = new Semaphore(2);
    await s.acquire();
    await s.acquire();
    s.release();
    expect(s.activeCount).toBe(1);
    s.release();
    expect(s.activeCount).toBe(0);
  });

  it('never goes negative on extra release', () => {
    const s = new Semaphore(2);
    s.release();
    s.release();
    expect(s.activeCount).toBe(0);
  });

  it('coerces a bad max to >= 1', () => {
    expect(new Semaphore(0).max).toBe(1);
    expect(new Semaphore(-5).max).toBe(1);
    expect(new Semaphore(NaN).max).toBe(1);
    expect(new Semaphore(8).max).toBe(8);
  });

  it('end-to-end: 3 slots, 10 tasks, never exceeds the cap', async () => {
    const s = new Semaphore(3);
    let running = 0;
    let peak = 0;
    const run = async () => {
      await s.acquire();
      running++;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running--;
      s.release();
    };
    await Promise.all(Array.from({ length: 10 }, run));
    expect(peak).toBeLessThanOrEqual(3);
    expect(s.activeCount).toBe(0);
    expect(s.waitingCount).toBe(0);
  });
});
