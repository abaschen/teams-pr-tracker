/**
 * Common retry utility with configurable exponential backoff.
 * Used for all external API calls (Teams API, provider APIs, DynamoDB).
 */

import { RetryConfig } from '@models/config.js';
import { sleep } from './sleep.js';

/** Default retry configuration matching the design document */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

/**
 * Executes an async operation with exponential backoff retry.
 *
 * Delay formula: min(baseDelayMs * backoffMultiplier^attempt, maxDelayMs)
 *
 * @param operation - Async function to retry
 * @param config - Retry configuration parameters
 * @param onExhausted - Optional callback invoked when all attempts are exhausted (before re-throwing)
 * @returns The result of the successful operation
 * @throws The last error encountered after all retries are exhausted
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig,
  onExhausted?: () => Promise<void>,
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      if (attempt < config.maxAttempts - 1) {
        const delay = Math.min(
          config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt),
          config.maxDelayMs,
        );
        await sleep(delay);
      }
    }
  }

  if (onExhausted) {
    await onExhausted();
  }

  throw lastError!;
}
