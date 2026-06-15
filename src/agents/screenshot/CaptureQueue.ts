type Thunk<T> = () => Promise<T>;

/**
 * Semaphore-based concurrency limiter.
 * At most `concurrency` tasks run simultaneously; the rest queue and run
 * as slots free up — no polling, no timer, pure Promise chaining.
 */
export class CaptureQueue {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly concurrency: number) {
    if (concurrency < 1) throw new RangeError('CaptureQueue: concurrency must be >= 1');
  }

  /** Run a single task, acquiring a slot first. */
  async run<T>(task: Thunk<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  /**
   * Run all tasks respecting the concurrency limit.
   * Uses Promise.allSettled — individual failures don't abort the batch.
   */
  runAll<T>(tasks: Array<Thunk<T>>): Promise<Array<PromiseSettledResult<T>>> {
    return Promise.allSettled(tasks.map(t => this.run(t)));
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.waiters.length;
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>(resolve => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Pass the slot directly — active count stays the same.
      next();
    } else {
      this.active--;
    }
  }
}
