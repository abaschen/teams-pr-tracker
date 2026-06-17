/**
 * Authentication Warning Rate Limiter.
 * Limits 401 warning messages to a maximum of 3 per PR per provider within a 1-hour sliding window.
 *
 * State is kept in-memory, which is sufficient for a single Lambda invocation.
 * On warm starts, the limiter prunes expired timestamps to remain accurate.
 *
 * Validates: Requirements 9.4
 */

/** Duration of the sliding window in milliseconds (1 hour) */
const WINDOW_MS = 60 * 60 * 1000;

/** Maximum number of warnings allowed within the sliding window */
const MAX_WARNINGS = 3;

/**
 * Rate limiter for authentication failure warnings posted to Teams threads.
 *
 * Ensures at most 3 warnings per PR per provider within any 1-hour sliding window.
 * Old timestamps are pruned on every check so the limiter behaves correctly
 * even if the Lambda container is reused (warm start).
 */
export class AuthWarningLimiter {
  /**
   * Internal store mapping "prId:provider" → array of warning timestamps (epoch ms).
   */
  private readonly warnings: Map<string, number[]> = new Map();

  /**
   * Determines whether a warning should be posted for the given PR and provider.
   * Prunes expired timestamps before evaluating.
   *
   * @param prId - The PR identifier
   * @param provider - The source control provider name
   * @returns true if a warning is allowed, false if rate limited
   */
  shouldWarn(prId: string, provider: string): boolean {
    const key = this.buildKey(prId, provider);
    this.prune(key);

    const timestamps = this.warnings.get(key);
    if (!timestamps || timestamps.length < MAX_WARNINGS) {
      return true;
    }
    return false;
  }

  /**
   * Records that a warning was posted for the given PR and provider.
   *
   * @param prId - The PR identifier
   * @param provider - The source control provider name
   */
  recordWarning(prId: string, provider: string): void {
    const key = this.buildKey(prId, provider);
    this.prune(key);

    const timestamps = this.warnings.get(key);
    if (timestamps) {
      timestamps.push(Date.now());
    } else {
      this.warnings.set(key, [Date.now()]);
    }
  }

  /**
   * Builds the composite key for a PR/provider combination.
   */
  private buildKey(prId: string, provider: string): string {
    return `${prId}:${provider}`;
  }

  /**
   * Removes timestamps older than 1 hour from the sliding window.
   */
  private prune(key: string): void {
    const timestamps = this.warnings.get(key);
    if (!timestamps) {
      return;
    }

    const cutoff = Date.now() - WINDOW_MS;
    const valid = timestamps.filter((ts) => ts > cutoff);

    if (valid.length === 0) {
      this.warnings.delete(key);
    } else {
      this.warnings.set(key, valid);
    }
  }
}
