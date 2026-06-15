export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

export const DEFAULT_RETRY_OPTIONS: Readonly<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  jitter: true,
};

export class RetryPolicy {
  /**
   * Execute fn, retrying on failure with exponential backoff.
   * Throws the last error after all attempts are exhausted.
   */
  async execute<T>(
    fn: () => Promise<T>,
    options: RetryOptions = DEFAULT_RETRY_OPTIONS,
  ): Promise<T> {
    let lastError!: Error;

    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < options.maxAttempts) {
          await sleep(this.backoffDelay(attempt, options));
        }
      }
    }

    throw lastError;
  }

  /**
   * Wrap fn so it counts attempt numbers externally.
   * Returns [result, attempts] on success; throws with attempts annotated on the error.
   */
  async executeTracked<T>(
    fn: () => Promise<T>,
    options: RetryOptions = DEFAULT_RETRY_OPTIONS,
  ): Promise<{ value: T; attempts: number }> {
    let attempts = 0;
    const value = await this.execute(async () => {
      attempts++;
      return fn();
    }, options);
    return { value, attempts };
  }

  private backoffDelay(
    attempt: number,
    { baseDelayMs, maxDelayMs, jitter }: RetryOptions,
  ): number {
    const exp = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
    return jitter ? exp * (0.5 + Math.random() * 0.5) : exp;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
