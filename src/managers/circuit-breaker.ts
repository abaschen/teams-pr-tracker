/**
 * Circuit Breaker implementation for provider API calls.
 *
 * Implements the circuit breaker state machine pattern:
 * - CLOSED: Normal operation. Track consecutive 401 failures with timestamps.
 * - OPEN: After threshold consecutive 401s within the failure window. All API calls suspended.
 * - HALF_OPEN: After suspension expires. Allow a single trial request.
 *   On success → CLOSED. On failure → OPEN (restart suspension).
 *
 * Persists state to DynamoDB via the circuit-breaker-repository for cross-invocation continuity.
 */

import type { Provider } from '../models/events.js';
import type { CircuitState, CircuitBreakerItem } from '../models/credentials.js';
import {
  loadCircuitBreaker,
  saveCircuitBreaker,
  deleteCircuitBreaker,
} from '../repositories/circuit-breaker-repository.js';

/** Configuration options for the CircuitBreaker */
export interface CircuitBreakerConfig {
  /** Number of consecutive 401 failures required to open the circuit (default: 3) */
  failureThreshold?: number;
  /** Time window in ms within which failures must occur to count (default: 10 minutes) */
  failureWindowMs?: number;
  /** Duration in ms to suspend API calls when circuit is open (default: 30 minutes) */
  suspensionDurationMs?: number;
}

/** Internal state tracking for the circuit breaker */
interface CircuitBreakerInternalState {
  /** Current circuit state */
  state: CircuitState;
  /** Timestamps of consecutive 401 failures (within the failure window) */
  failureTimestamps: number[];
  /** Timestamp when the circuit was opened (used to determine half-open transition) */
  openedAt?: number;
  /** Timestamp when suspension expires */
  suspendedUntil?: number;
}

/** Default failure threshold: 3 consecutive 401s */
const DEFAULT_FAILURE_THRESHOLD = 3;
/** Default failure window: 10 minutes in milliseconds */
const DEFAULT_FAILURE_WINDOW_MS = 10 * 60 * 1000;
/** Default suspension duration: 30 minutes in milliseconds */
const DEFAULT_SUSPENSION_DURATION_MS = 30 * 60 * 1000;

/**
 * CircuitBreaker encapsulates the circuit breaker logic for a single
 * provider + repository combination.
 *
 * Usage:
 *   const breaker = new CircuitBreaker('github', 'org/repo');
 *   await breaker.loadFromRepository();
 *   if (breaker.shouldAllowRequest()) { ... make API call ... }
 *   breaker.recordFailure(401);
 *   await breaker.persistState();
 */
export class CircuitBreaker {
  private readonly provider: Provider;
  private readonly repositoryFullName: string;
  private readonly failureThreshold: number;
  private readonly failureWindowMs: number;
  private readonly suspensionDurationMs: number;

  private internalState: CircuitBreakerInternalState;

  constructor(
    provider: Provider,
    repositoryFullName: string,
    config: CircuitBreakerConfig = {},
  ) {
    this.provider = provider;
    this.repositoryFullName = repositoryFullName;
    this.failureThreshold = config.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.failureWindowMs = config.failureWindowMs ?? DEFAULT_FAILURE_WINDOW_MS;
    this.suspensionDurationMs = config.suspensionDurationMs ?? DEFAULT_SUSPENSION_DURATION_MS;

    this.internalState = {
      state: 'closed',
      failureTimestamps: [],
    };
  }

  /**
   * Returns the current circuit state, accounting for time-based transitions.
   * If the circuit is open and the suspension period has elapsed, transitions to half-open.
   */
  getState(): CircuitState {
    this.evaluateTimeBasedTransitions();
    return this.internalState.state;
  }

  /**
   * Determines whether a request should be allowed through the circuit.
   * - CLOSED: always allows
   * - HALF_OPEN: allows (a single trial request)
   * - OPEN: blocks
   */
  shouldAllowRequest(): boolean {
    const state = this.getState();
    return state === 'closed' || state === 'half-open';
  }

  /**
   * Records a failure response. Only 401 status codes contribute to opening the circuit.
   * Non-401 failures are ignored by the circuit breaker.
   *
   * @param statusCode - The HTTP status code of the failed response
   */
  recordFailure(statusCode: number): void {
    if (statusCode !== 401) {
      return;
    }

    // Evaluate time-based transitions first (open → half-open if suspension expired)
    this.evaluateTimeBasedTransitions();

    const now = Date.now();

    // If currently half-open and a failure occurs, go back to open
    if (this.internalState.state === 'half-open') {
      this.transitionToOpen(now);
      return;
    }

    // In closed state, track the failure
    if (this.internalState.state === 'closed') {
      // Remove failures outside the window
      this.pruneOldFailures(now);

      this.internalState.failureTimestamps.push(now);

      // Check if threshold is reached
      if (this.internalState.failureTimestamps.length >= this.failureThreshold) {
        this.transitionToOpen(now);
      }
    }
  }

  /**
   * Records a successful API call.
   * If the circuit is in half-open state, transitions back to closed.
   */
  recordSuccess(): void {
    // Evaluate time-based transitions first (open → half-open if suspension expired)
    this.evaluateTimeBasedTransitions();

    if (this.internalState.state === 'half-open') {
      this.transitionToClosed();
    } else if (this.internalState.state === 'closed') {
      // Success in closed state resets failure tracking
      this.internalState.failureTimestamps = [];
    }
  }

  /**
   * Loads persisted circuit breaker state from DynamoDB.
   * Reconstructs the internal state from the stored item.
   */
  async loadFromRepository(): Promise<void> {
    const item = await loadCircuitBreaker(this.provider, this.repositoryFullName);

    if (!item) {
      // No persisted state means circuit is closed
      this.internalState = {
        state: 'closed',
        failureTimestamps: [],
      };
      return;
    }

    const now = Date.now();

    if (item.suspendedUntil) {
      const suspendedUntilMs = new Date(item.suspendedUntil).getTime();

      if (suspendedUntilMs > now) {
        // Still within suspension period → open
        this.internalState = {
          state: 'open',
          failureTimestamps: [new Date(item.lastFailureAt).getTime()],
          openedAt: new Date(item.lastFailureAt).getTime(),
          suspendedUntil: suspendedUntilMs,
        };
      } else {
        // Suspension has elapsed → half-open
        this.internalState = {
          state: 'half-open',
          failureTimestamps: [new Date(item.lastFailureAt).getTime()],
          openedAt: new Date(item.lastFailureAt).getTime(),
          suspendedUntil: suspendedUntilMs,
        };
      }
    } else {
      // Has failures but not yet suspended
      const lastFailureMs = new Date(item.lastFailureAt).getTime();

      // Check if failures are within the window
      if (now - lastFailureMs < this.failureWindowMs) {
        // Reconstruct failure timestamps (we only have count + lastFailureAt)
        const timestamps: number[] = [];
        for (let i = 0; i < item.failureCount; i++) {
          timestamps.push(lastFailureMs);
        }
        this.internalState = {
          state: 'closed',
          failureTimestamps: timestamps,
        };
      } else {
        // Failures are outside the window, treat as clean slate
        this.internalState = {
          state: 'closed',
          failureTimestamps: [],
        };
      }
    }
  }

  /**
   * Persists the current circuit breaker state to DynamoDB with 24-hour TTL.
   */
  async persistState(): Promise<void> {
    if (this.internalState.state === 'closed' && this.internalState.failureTimestamps.length === 0) {
      // Clean state - remove any existing record
      await deleteCircuitBreaker(this.provider, this.repositoryFullName);
      return;
    }

    const lastFailureAt =
      this.internalState.failureTimestamps.length > 0
        ? new Date(
            this.internalState.failureTimestamps[this.internalState.failureTimestamps.length - 1],
          ).toISOString()
        : new Date().toISOString();

    const suspendedUntil = this.internalState.suspendedUntil
      ? new Date(this.internalState.suspendedUntil).toISOString()
      : undefined;

    await saveCircuitBreaker(this.provider, this.repositoryFullName, {
      failureCount: this.internalState.failureTimestamps.length,
      lastFailureAt,
      suspendedUntil,
    });
  }

  /**
   * Evaluates time-based state transitions.
   * If the circuit is open and the suspension period has elapsed, transitions to half-open.
   */
  private evaluateTimeBasedTransitions(): void {
    if (this.internalState.state === 'open' && this.internalState.suspendedUntil) {
      const now = Date.now();
      if (now >= this.internalState.suspendedUntil) {
        this.internalState.state = 'half-open';
      }
    }
  }

  /**
   * Transitions the circuit to the OPEN state with a suspension timer.
   */
  private transitionToOpen(now: number): void {
    this.internalState.state = 'open';
    this.internalState.openedAt = now;
    this.internalState.suspendedUntil = now + this.suspensionDurationMs;
  }

  /**
   * Transitions the circuit to the CLOSED state, resetting all failure tracking.
   */
  private transitionToClosed(): void {
    this.internalState = {
      state: 'closed',
      failureTimestamps: [],
    };
  }

  /**
   * Removes failure timestamps that fall outside the failure window.
   */
  private pruneOldFailures(now: number): void {
    const windowStart = now - this.failureWindowMs;
    this.internalState.failureTimestamps = this.internalState.failureTimestamps.filter(
      (ts) => ts >= windowStart,
    );
  }
}
