/**
 * Higher-order wrapper functions for resilient external API calls.
 * Centralizes retry wiring so that individual adapters remain clean.
 *
 * All wrappers ensure side-effect failures are non-fatal to the event
 * processing pipeline by catching errors and returning null on exhaustion.
 */

import type { RetryConfig } from '@models/config.js';
import type { ThreadReference } from '@models/state.js';
import { withRetry, DEFAULT_RETRY_CONFIG } from './retry.js';

/** Context metadata for provider API calls */
export interface ProviderCallContext {
  provider: string;
  operation: string;
  threadRef?: ThreadReference;
}

/** Context metadata for Teams API calls */
export interface TeamsCallContext {
  operation: string;
}

/** Logger interface so callers can inject their own logger */
export interface ResilientLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Default console-based logger */
const defaultLogger: ResilientLogger = {
  warn(message: string, meta?: Record<string, unknown>) {
    console.warn(message, meta);
  },
  error(message: string, meta?: Record<string, unknown>) {
    console.error(message, meta);
  },
};

/** Module-level logger, replaceable for testing */
let logger: ResilientLogger = defaultLogger;

/** Replace the module-level logger (useful for testing) */
export function setLogger(newLogger: ResilientLogger): void {
  logger = newLogger;
}

/** Reset to the default console logger */
export function resetLogger(): void {
  logger = defaultLogger;
}

/**
 * Wraps a Provider API call with retry and non-fatal error handling.
 *
 * - Retries with DEFAULT_RETRY_CONFIG (3 attempts, 1s exponential backoff)
 * - On exhausted retries: logs the failure and returns null (non-fatal)
 * - Never throws — side-effect failures do not crash the pipeline
 *
 * @param operation - The async provider API operation to execute
 * @param context - Metadata about the call for logging/warning purposes
 * @param config - Optional retry configuration override
 * @returns The operation result, or null if all retries were exhausted
 */
export async function resilientProviderCall<T>(
  operation: () => Promise<T>,
  context: ProviderCallContext,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): Promise<T | null> {
  try {
    const result = await withRetry(
      operation,
      config,
      async () => {
        logger.error(
          `Provider API call exhausted all retries`,
          {
            provider: context.provider,
            operation: context.operation,
            threadRef: context.threadRef
              ? { conversationId: context.threadRef.conversationId }
              : undefined,
          },
        );
      },
    );
    return result;
  } catch {
    // withRetry re-throws after onExhausted — we catch here to make it non-fatal
    logger.warn(
      `Provider API call failed after retries, returning null (non-fatal)`,
      {
        provider: context.provider,
        operation: context.operation,
      },
    );
    return null;
  }
}

/**
 * Wraps a Teams API call with retry and non-fatal error handling.
 *
 * - Retries with DEFAULT_RETRY_CONFIG (3 attempts, 1s exponential backoff)
 * - On exhausted retries: logs the failure and returns null (non-fatal)
 * - Never throws — side-effect failures do not crash the pipeline
 *
 * @param operation - The async Teams API operation to execute
 * @param context - Metadata about the call for logging/warning purposes
 * @param config - Optional retry configuration override
 * @returns The operation result, or null if all retries were exhausted
 */
export async function resilientTeamsCall<T>(
  operation: () => Promise<T>,
  context: TeamsCallContext,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): Promise<T | null> {
  try {
    const result = await withRetry(
      operation,
      config,
      async () => {
        logger.error(
          `Teams API call exhausted all retries`,
          {
            operation: context.operation,
          },
        );
      },
    );
    return result;
  } catch (error) {
    // withRetry re-throws after onExhausted — we catch here to make it non-fatal
    logger.warn(
      `Teams API call failed after retries, returning null (non-fatal)`,
      {
        operation: context.operation,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    );
    return null;
  }
}

/**
 * Generic wrapper that catches any error and returns null.
 * Used for side effects that should not block the webhook response.
 *
 * No retry — just a catch-all for non-fatal side effects.
 *
 * @param operation - The async operation to execute
 * @param description - Human-readable description for logging
 * @returns The operation result, or null if any error occurred
 */
export async function withNonFatalSideEffect<T>(
  operation: () => Promise<T>,
  description: string,
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    logger.warn(
      `Non-fatal side effect failed: ${description}`,
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return null;
  }
}
