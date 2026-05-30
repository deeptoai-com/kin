/**
 * Semaphore — bounds how many "permits" are held at once; extra acquire() calls
 * queue (FIFO) until a release() frees a slot.
 *
 * Used by ws-server (S1) to cap simultaneously-active agent workers on a single
 * host: a burst of concurrent chats can't spawn unbounded worker processes (each
 * ~150–300 MB) and OOM the box — excess requests wait for a free slot instead.
 *
 * Plain JS ESM so ws-server.mjs can import it without a build step.
 */
export class Semaphore {
  /** @param {number} max  Maximum permits held concurrently (>= 1). */
  constructor(max) {
    this.max = Math.max(1, Number.isFinite(max) ? Math.floor(max) : 1);
    this.active = 0;
    /** @type {Array<() => void>} FIFO resolvers for queued acquire() calls. */
    this._waiters = [];
  }

  /** Permits currently held. */
  get activeCount() {
    return this.active;
  }

  /** Callers currently waiting for a permit. */
  get waitingCount() {
    return this._waiters.length;
  }

  /**
   * Acquire a permit. Resolves immediately if one is free, else resolves later
   * (FIFO) when a permit is released.
   * @returns {Promise<void>}
   */
  acquire() {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this._waiters.push(resolve);
    });
  }

  /**
   * Release a permit. If anyone is waiting, hand the permit directly to the next
   * waiter (active count unchanged); otherwise decrement. Never goes negative.
   * Idempotency is the caller's responsibility (don't release more than acquired).
   */
  release() {
    if (this._waiters.length > 0) {
      const next = this._waiters.shift();
      next();
      return;
    }
    if (this.active > 0) {
      this.active--;
    }
  }
}
