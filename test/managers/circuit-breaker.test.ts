import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker } from '@managers/circuit-breaker.js';

// Mock the circuit breaker repository
vi.mock('@repositories/circuit-breaker-repository.js', () => ({
  loadCircuitBreaker: vi.fn().mockResolvedValue(null),
  saveCircuitBreaker: vi.fn().mockResolvedValue(undefined),
  deleteCircuitBreaker: vi.fn().mockResolvedValue(undefined),
}));

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
    breaker = new CircuitBreaker('github', 'org/repo');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('should start in closed state', () => {
      expect(breaker.getState()).toBe('closed');
    });

    it('should allow requests when closed', () => {
      expect(breaker.shouldAllowRequest()).toBe(true);
    });
  });

  describe('circuit stays closed below threshold', () => {
    it('should remain closed after 1 failure', () => {
      breaker.recordFailure(401);

      expect(breaker.getState()).toBe('closed');
      expect(breaker.shouldAllowRequest()).toBe(true);
    });

    it('should remain closed after 2 failures', () => {
      breaker.recordFailure(401);
      breaker.recordFailure(401);

      expect(breaker.getState()).toBe('closed');
      expect(breaker.shouldAllowRequest()).toBe(true);
    });
  });

  describe('circuit opens after 3 consecutive 401s within 10 min window', () => {
    it('should open after exactly 3 consecutive 401 failures', () => {
      breaker.recordFailure(401);
      breaker.recordFailure(401);
      breaker.recordFailure(401);

      expect(breaker.getState()).toBe('open');
      expect(breaker.shouldAllowRequest()).toBe(false);
    });

    it('should open when 3 failures occur within 10 minutes', () => {
      breaker.recordFailure(401);

      // Advance 4 minutes
      vi.advanceTimersByTime(4 * 60 * 1000);
      breaker.recordFailure(401);

      // Advance another 4 minutes (8 min total, within 10 min window)
      vi.advanceTimersByTime(4 * 60 * 1000);
      breaker.recordFailure(401);

      expect(breaker.getState()).toBe('open');
    });
  });

  describe('non-401 failures do not count toward threshold', () => {
    it('should not count 403 failures', () => {
      breaker.recordFailure(403);
      breaker.recordFailure(403);
      breaker.recordFailure(403);

      expect(breaker.getState()).toBe('closed');
      expect(breaker.shouldAllowRequest()).toBe(true);
    });

    it('should not count 500 failures', () => {
      breaker.recordFailure(500);
      breaker.recordFailure(500);
      breaker.recordFailure(500);

      expect(breaker.getState()).toBe('closed');
    });

    it('should not count 404 failures', () => {
      breaker.recordFailure(404);
      breaker.recordFailure(404);
      breaker.recordFailure(404);

      expect(breaker.getState()).toBe('closed');
    });

    it('should only count 401s in a mixed failure sequence', () => {
      breaker.recordFailure(401);
      breaker.recordFailure(500); // ignored
      breaker.recordFailure(401);
      breaker.recordFailure(403); // ignored
      breaker.recordFailure(401);

      expect(breaker.getState()).toBe('open');
    });
  });

  describe('circuit transitions to half-open after suspension period', () => {
    it('should transition to half-open after 30 minutes', () => {
      // Open the circuit
      breaker.recordFailure(401);
      breaker.recordFailure(401);
      breaker.recordFailure(401);
      expect(breaker.getState()).toBe('open');

      // Advance time by 30 minutes
      vi.advanceTimersByTime(30 * 60 * 1000);

      expect(breaker.getState()).toBe('half-open');
      expect(breaker.shouldAllowRequest()).toBe(true);
    });

    it('should remain open before 30 minutes have elapsed', () => {
      breaker.recordFailure(401);
      breaker.recordFailure(401);
      breaker.recordFailure(401);

      // Advance 29 minutes
      vi.advanceTimersByTime(29 * 60 * 1000);

      expect(breaker.getState()).toBe('open');
      expect(breaker.shouldAllowRequest()).toBe(false);
    });
  });

  describe('successful request in half-open transitions to closed', () => {
    it('should transition to closed on success in half-open state', () => {
      // Open the circuit
      breaker.recordFailure(401);
      breaker.recordFailure(401);
      breaker.recordFailure(401);

      // Wait for suspension to expire
      vi.advanceTimersByTime(30 * 60 * 1000);
      expect(breaker.getState()).toBe('half-open');

      // Record success
      breaker.recordSuccess();

      expect(breaker.getState()).toBe('closed');
      expect(breaker.shouldAllowRequest()).toBe(true);
    });

    it('should reset failure tracking after closing from half-open', () => {
      // Open → half-open → closed
      breaker.recordFailure(401);
      breaker.recordFailure(401);
      breaker.recordFailure(401);
      vi.advanceTimersByTime(30 * 60 * 1000);
      breaker.recordSuccess();

      // Now 2 failures should not open the circuit again
      breaker.recordFailure(401);
      breaker.recordFailure(401);
      expect(breaker.getState()).toBe('closed');
    });
  });

  describe('failed request in half-open returns to open', () => {
    it('should transition back to open on 401 in half-open state', () => {
      // Open the circuit
      breaker.recordFailure(401);
      breaker.recordFailure(401);
      breaker.recordFailure(401);

      // Wait for suspension to expire → half-open
      vi.advanceTimersByTime(30 * 60 * 1000);
      expect(breaker.getState()).toBe('half-open');

      // Record another 401 failure
      breaker.recordFailure(401);

      expect(breaker.getState()).toBe('open');
      expect(breaker.shouldAllowRequest()).toBe(false);
    });

    it('should restart the 30-minute suspension timer after returning to open', () => {
      // Open the circuit
      breaker.recordFailure(401);
      breaker.recordFailure(401);
      breaker.recordFailure(401);

      // Wait 30 min → half-open
      vi.advanceTimersByTime(30 * 60 * 1000);
      expect(breaker.getState()).toBe('half-open');

      // Fail again → back to open
      breaker.recordFailure(401);
      expect(breaker.getState()).toBe('open');

      // Wait another 29 min → still open
      vi.advanceTimersByTime(29 * 60 * 1000);
      expect(breaker.getState()).toBe('open');

      // Wait 1 more minute (30 min total from re-open) → half-open again
      vi.advanceTimersByTime(1 * 60 * 1000);
      expect(breaker.getState()).toBe('half-open');
    });
  });

  describe('failures outside the window reset the count', () => {
    it('should not open if failures are spread beyond 10-minute window', () => {
      breaker.recordFailure(401);
      breaker.recordFailure(401);

      // Advance past the 10-minute window
      vi.advanceTimersByTime(11 * 60 * 1000);

      // This failure should start a new count (old failures pruned)
      breaker.recordFailure(401);

      expect(breaker.getState()).toBe('closed');
    });

    it('should count from the most recent failure within the window', () => {
      breaker.recordFailure(401);

      // Advance 11 minutes (first failure now outside window)
      vi.advanceTimersByTime(11 * 60 * 1000);

      // These 3 are all within a new 10-minute window
      breaker.recordFailure(401);
      breaker.recordFailure(401);
      breaker.recordFailure(401);

      expect(breaker.getState()).toBe('open');
    });

    it('should reset when only some failures fall outside the window', () => {
      breaker.recordFailure(401);

      // Advance 6 minutes
      vi.advanceTimersByTime(6 * 60 * 1000);
      breaker.recordFailure(401);

      // Advance 5 minutes (first failure is now 11 min old → outside window)
      vi.advanceTimersByTime(5 * 60 * 1000);

      // Third failure: only 2nd failure is within window, so count = 2
      breaker.recordFailure(401);

      expect(breaker.getState()).toBe('closed');
    });
  });

  describe('custom configuration', () => {
    it('should respect custom failure threshold', () => {
      const customBreaker = new CircuitBreaker('github', 'org/repo', {
        failureThreshold: 5,
      });

      customBreaker.recordFailure(401);
      customBreaker.recordFailure(401);
      customBreaker.recordFailure(401);
      expect(customBreaker.getState()).toBe('closed');

      customBreaker.recordFailure(401);
      customBreaker.recordFailure(401);
      expect(customBreaker.getState()).toBe('open');
    });

    it('should respect custom suspension duration', () => {
      const customBreaker = new CircuitBreaker('github', 'org/repo', {
        suspensionDurationMs: 5 * 60 * 1000, // 5 minutes
      });

      customBreaker.recordFailure(401);
      customBreaker.recordFailure(401);
      customBreaker.recordFailure(401);
      expect(customBreaker.getState()).toBe('open');

      // After 5 minutes should be half-open
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(customBreaker.getState()).toBe('half-open');
    });

    it('should respect custom failure window', () => {
      const customBreaker = new CircuitBreaker('github', 'org/repo', {
        failureWindowMs: 2 * 60 * 1000, // 2 minutes
      });

      customBreaker.recordFailure(401);
      customBreaker.recordFailure(401);

      // Advance 3 minutes (past the 2-minute window)
      vi.advanceTimersByTime(3 * 60 * 1000);

      customBreaker.recordFailure(401);
      // Only 1 failure in the window, not enough to open
      expect(customBreaker.getState()).toBe('closed');
    });
  });

  describe('persistence', () => {
    it('should load closed state when no repository item exists', async () => {
      const { loadCircuitBreaker } = await import(
        '@repositories/circuit-breaker-repository.js'
      );
      vi.mocked(loadCircuitBreaker).mockResolvedValueOnce(null);

      await breaker.loadFromRepository();

      expect(breaker.getState()).toBe('closed');
      expect(breaker.shouldAllowRequest()).toBe(true);
    });

    it('should load open state from repository when suspension is active', async () => {
      const { loadCircuitBreaker } = await import(
        '@repositories/circuit-breaker-repository.js'
      );
      const suspendedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min from now

      vi.mocked(loadCircuitBreaker).mockResolvedValueOnce({
        PK: 'CIRCUIT#github#org/repo',
        SK: 'BREAKER',
        failureCount: 3,
        lastFailureAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        suspendedUntil,
        ttl: Math.floor(Date.now() / 1000) + 86400,
      });

      await breaker.loadFromRepository();

      expect(breaker.getState()).toBe('open');
      expect(breaker.shouldAllowRequest()).toBe(false);
    });

    it('should load half-open state when suspension has elapsed', async () => {
      const { loadCircuitBreaker } = await import(
        '@repositories/circuit-breaker-repository.js'
      );
      const suspendedUntil = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago

      vi.mocked(loadCircuitBreaker).mockResolvedValueOnce({
        PK: 'CIRCUIT#github#org/repo',
        SK: 'BREAKER',
        failureCount: 3,
        lastFailureAt: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
        suspendedUntil,
        ttl: Math.floor(Date.now() / 1000) + 86400,
      });

      await breaker.loadFromRepository();

      expect(breaker.getState()).toBe('half-open');
      expect(breaker.shouldAllowRequest()).toBe(true);
    });

    it('should persist state via saveCircuitBreaker', async () => {
      const { saveCircuitBreaker } = await import(
        '@repositories/circuit-breaker-repository.js'
      );

      breaker.recordFailure(401);
      breaker.recordFailure(401);
      breaker.recordFailure(401);

      await breaker.persistState();

      expect(saveCircuitBreaker).toHaveBeenCalledWith('github', 'org/repo', expect.objectContaining({
        failureCount: 3,
        lastFailureAt: expect.any(String),
        suspendedUntil: expect.any(String),
      }));
    });

    it('should delete circuit breaker record when state is clean', async () => {
      const { deleteCircuitBreaker } = await import(
        '@repositories/circuit-breaker-repository.js'
      );

      // Circuit is closed with no failures
      await breaker.persistState();

      expect(deleteCircuitBreaker).toHaveBeenCalledWith('github', 'org/repo');
    });
  });
});
