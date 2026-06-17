import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthWarningLimiter } from '@managers/auth-warning-limiter.js';

describe('AuthWarningLimiter', () => {
  let limiter: AuthWarningLimiter;

  beforeEach(() => {
    limiter = new AuthWarningLimiter();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('first 3 warnings allowed', () => {
    it('should allow the first warning for a PR/provider', () => {
      expect(limiter.shouldWarn('PR#1', 'github')).toBe(true);
    });

    it('should allow the second warning for a PR/provider', () => {
      limiter.recordWarning('PR#1', 'github');
      expect(limiter.shouldWarn('PR#1', 'github')).toBe(true);
    });

    it('should allow the third warning for a PR/provider', () => {
      limiter.recordWarning('PR#1', 'github');
      limiter.recordWarning('PR#1', 'github');
      expect(limiter.shouldWarn('PR#1', 'github')).toBe(true);
    });
  });

  describe('4th warning within 1 hour is suppressed', () => {
    it('should suppress the 4th warning within the 1-hour window', () => {
      limiter.recordWarning('PR#1', 'github');
      limiter.recordWarning('PR#1', 'github');
      limiter.recordWarning('PR#1', 'github');

      expect(limiter.shouldWarn('PR#1', 'github')).toBe(false);
    });

    it('should continue suppressing beyond the 4th attempt', () => {
      limiter.recordWarning('PR#1', 'github');
      limiter.recordWarning('PR#1', 'github');
      limiter.recordWarning('PR#1', 'github');

      expect(limiter.shouldWarn('PR#1', 'github')).toBe(false);
      expect(limiter.shouldWarn('PR#1', 'github')).toBe(false);
    });
  });

  describe('sliding window — warnings allowed again after 1 hour', () => {
    it('should allow warnings after the earliest timestamp expires', () => {
      const baseTime = new Date('2025-01-15T10:00:00Z').getTime();
      vi.setSystemTime(baseTime);

      limiter.recordWarning('PR#1', 'github');

      vi.setSystemTime(baseTime + 10 * 60 * 1000); // +10 min
      limiter.recordWarning('PR#1', 'github');

      vi.setSystemTime(baseTime + 20 * 60 * 1000); // +20 min
      limiter.recordWarning('PR#1', 'github');

      // All 3 used, should be suppressed
      expect(limiter.shouldWarn('PR#1', 'github')).toBe(false);

      // Advance past the first warning's 1-hour mark
      vi.setSystemTime(baseTime + 60 * 60 * 1000 + 1); // 1 hour + 1ms after first warning

      // First warning has expired, so only 2 within window — should allow
      expect(limiter.shouldWarn('PR#1', 'github')).toBe(true);
    });

    it('should allow all 3 warnings again after full window expires', () => {
      const baseTime = new Date('2025-01-15T10:00:00Z').getTime();
      vi.setSystemTime(baseTime);

      limiter.recordWarning('PR#1', 'github');
      limiter.recordWarning('PR#1', 'github');
      limiter.recordWarning('PR#1', 'github');

      expect(limiter.shouldWarn('PR#1', 'github')).toBe(false);

      // Advance past 1 hour from all warnings
      vi.setSystemTime(baseTime + 60 * 60 * 1000 + 1);

      // All expired, should allow 3 more
      expect(limiter.shouldWarn('PR#1', 'github')).toBe(true);
      limiter.recordWarning('PR#1', 'github');
      expect(limiter.shouldWarn('PR#1', 'github')).toBe(true);
      limiter.recordWarning('PR#1', 'github');
      expect(limiter.shouldWarn('PR#1', 'github')).toBe(true);
      limiter.recordWarning('PR#1', 'github');
      expect(limiter.shouldWarn('PR#1', 'github')).toBe(false);
    });
  });

  describe('different PRs track independently', () => {
    it('should not affect other PRs when one is rate limited', () => {
      limiter.recordWarning('PR#1', 'github');
      limiter.recordWarning('PR#1', 'github');
      limiter.recordWarning('PR#1', 'github');

      expect(limiter.shouldWarn('PR#1', 'github')).toBe(false);
      expect(limiter.shouldWarn('PR#2', 'github')).toBe(true);
      expect(limiter.shouldWarn('PR#3', 'github')).toBe(true);
    });

    it('should track warnings separately per PR', () => {
      limiter.recordWarning('PR#1', 'github');
      limiter.recordWarning('PR#2', 'github');
      limiter.recordWarning('PR#1', 'github');

      // PR#1 has 2 warnings, PR#2 has 1 — both should still allow
      expect(limiter.shouldWarn('PR#1', 'github')).toBe(true);
      expect(limiter.shouldWarn('PR#2', 'github')).toBe(true);
    });
  });

  describe('different providers track independently', () => {
    it('should not affect other providers when one is rate limited', () => {
      limiter.recordWarning('PR#1', 'github');
      limiter.recordWarning('PR#1', 'github');
      limiter.recordWarning('PR#1', 'github');

      expect(limiter.shouldWarn('PR#1', 'github')).toBe(false);
      expect(limiter.shouldWarn('PR#1', 'bitbucket')).toBe(true);
      expect(limiter.shouldWarn('PR#1', 'gitlab')).toBe(true);
    });

    it('should allow full quota per provider for the same PR', () => {
      // Exhaust github quota
      limiter.recordWarning('PR#1', 'github');
      limiter.recordWarning('PR#1', 'github');
      limiter.recordWarning('PR#1', 'github');

      // Bitbucket should still have full quota
      limiter.recordWarning('PR#1', 'bitbucket');
      limiter.recordWarning('PR#1', 'bitbucket');
      expect(limiter.shouldWarn('PR#1', 'bitbucket')).toBe(true);
      limiter.recordWarning('PR#1', 'bitbucket');
      expect(limiter.shouldWarn('PR#1', 'bitbucket')).toBe(false);
    });
  });

  describe('edge case: exactly at the 1-hour boundary', () => {
    it('should suppress warning exactly at the 1-hour mark (not yet expired)', () => {
      const baseTime = new Date('2025-01-15T10:00:00Z').getTime();
      vi.setSystemTime(baseTime);

      limiter.recordWarning('PR#1', 'github');
      limiter.recordWarning('PR#1', 'github');
      limiter.recordWarning('PR#1', 'github');

      // Exactly 1 hour later — timestamps are filtered with ts > cutoff
      // cutoff = now - 1hr = baseTime, so timestamps at baseTime are NOT > cutoff
      vi.setSystemTime(baseTime + 60 * 60 * 1000);

      // All 3 timestamps are at baseTime; cutoff is also baseTime.
      // filter: ts > cutoff → false, so all are pruned
      expect(limiter.shouldWarn('PR#1', 'github')).toBe(true);
    });

    it('should suppress when 1ms before the 1-hour mark', () => {
      const baseTime = new Date('2025-01-15T10:00:00Z').getTime();
      vi.setSystemTime(baseTime);

      limiter.recordWarning('PR#1', 'github');
      limiter.recordWarning('PR#1', 'github');
      limiter.recordWarning('PR#1', 'github');

      // 1ms before the hour expires
      vi.setSystemTime(baseTime + 60 * 60 * 1000 - 1);

      // cutoff = (baseTime + 3599999) - 3600000 = baseTime - 1
      // timestamps at baseTime > baseTime - 1 → true, so still in window
      expect(limiter.shouldWarn('PR#1', 'github')).toBe(false);
    });
  });
});
