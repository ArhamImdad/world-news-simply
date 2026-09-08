export type RetryOptions = {
  attempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  operation?: string;
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, Math.min(options.attempts ?? 3, 5));
  const initialDelayMs = Math.max(0, options.initialDelayMs ?? 500);
  const maxDelayMs = Math.max(initialDelayMs, options.maxDelayMs ?? 4_000);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === attempts) throw error;
      const delay = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1));
      console.warn(JSON.stringify({
        event: "external_retry",
        operation: options.operation ?? "external_request",
        attempt,
        nextDelayMs: delay,
        error: error instanceof Error ? error.name : "unknown",
      }));
      await pause(delay);
    }
  }

  throw new Error("Retry loop exhausted unexpectedly.");
}
