import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the sleep module so retries don't actually wait
vi.mock('@utils/sleep.js', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

import {
  resilientProviderCall,
  resilientTeamsCall,
  withNonFatalSideEffect,
  setLogger,
  resetLogger,
  type ResilientLogger,
} from '@utils/resilient-operations.js';

describe('resilient-operations', () => {
  let mockLogger: ResilientLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {
      warn: vi.fn(),
      error: vi.fn(),
    };
    setLogger(mockLogger);
  });

  afterEach(() => {
    resetLogger();
  });

  describe('resilientProviderCall', () => {
    it('returns the result when operation succeeds on first attempt', async () => {
      const operation = vi.fn().mockResolvedValue('data');

      const result = await resilientProviderCall(operation, {
        provider: 'github',
        operation: 'addLabels',
      });

      expect(result).toBe('data');
      expect(operation).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('returns the result when operation succeeds after retries', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValue('recovered');

      const result = await resilientProviderCall(operation, {
        provider: 'bitbucket',
        operation: 'assignReviewers',
      });

      expect(result).toBe('recovered');
      expect(operation).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('returns null after all retries are exhausted (non-fatal)', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('persistent'));

      const result = await resilientProviderCall(operation, {
        provider: 'gitlab',
        operation: 'getChangedFiles',
      });

      expect(result).toBeNull();
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('logs error via onExhausted when retries are exhausted', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('fail'));

      await resilientProviderCall(operation, {
        provider: 'github',
        operation: 'removeLabels',
        threadRef: {
          conversationId: 'conv-123',
          activityId: 'act-1',
          channelId: 'ch-1',
          serviceUrl: 'https://example.com',
        },
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Provider API call exhausted all retries',
        expect.objectContaining({
          provider: 'github',
          operation: 'removeLabels',
          threadRef: { conversationId: 'conv-123' },
        }),
      );
    });

    it('logs warning when returning null after failure', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('boom'));

      await resilientProviderCall(operation, {
        provider: 'bitbucket',
        operation: 'addComment',
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Provider API call failed after retries, returning null (non-fatal)',
        expect.objectContaining({
          provider: 'bitbucket',
          operation: 'addComment',
        }),
      );
    });

    it('never throws regardless of error type', async () => {
      const operation = vi.fn().mockRejectedValue(new TypeError('unexpected'));

      // Should not throw
      const result = await resilientProviderCall(operation, {
        provider: 'github',
        operation: 'updateDescription',
      });

      expect(result).toBeNull();
    });
  });

  describe('resilientTeamsCall', () => {
    it('returns the result when operation succeeds on first attempt', async () => {
      const operation = vi.fn().mockResolvedValue({ id: 'thread-1' });

      const result = await resilientTeamsCall(operation, {
        operation: 'createThread',
      });

      expect(result).toEqual({ id: 'thread-1' });
      expect(operation).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('returns the result when operation succeeds after retries', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Teams 503'))
        .mockRejectedValueOnce(new Error('Teams timeout'))
        .mockResolvedValue('posted');

      const result = await resilientTeamsCall(operation, {
        operation: 'postUpdate',
      });

      expect(result).toBe('posted');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('returns null after all retries are exhausted (non-fatal)', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Teams down'));

      const result = await resilientTeamsCall(operation, {
        operation: 'closeThread',
      });

      expect(result).toBeNull();
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('logs error via onExhausted when retries are exhausted', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('gone'));

      await resilientTeamsCall(operation, {
        operation: 'updateMentions',
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Teams API call exhausted all retries',
        expect.objectContaining({
          operation: 'updateMentions',
        }),
      );
    });

    it('logs warning when returning null after failure', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('err'));

      await resilientTeamsCall(operation, {
        operation: 'updateReadinessReaction',
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Teams API call failed after retries, returning null (non-fatal)',
        expect.objectContaining({
          operation: 'updateReadinessReaction',
        }),
      );
    });

    it('never throws regardless of error type', async () => {
      const operation = vi.fn().mockRejectedValue(new RangeError('oops'));

      const result = await resilientTeamsCall(operation, {
        operation: 'createThread',
      });

      expect(result).toBeNull();
    });
  });

  describe('withNonFatalSideEffect', () => {
    it('returns the result when operation succeeds', async () => {
      const operation = vi.fn().mockResolvedValue(42);

      const result = await withNonFatalSideEffect(operation, 'post warning');

      expect(result).toBe(42);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('returns null when operation throws (non-fatal)', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('side effect boom'));

      const result = await withNonFatalSideEffect(
        operation,
        'post thread warning',
      );

      expect(result).toBeNull();
    });

    it('logs the error description when operation fails', async () => {
      const operation = vi
        .fn()
        .mockRejectedValue(new Error('network timeout'));

      await withNonFatalSideEffect(operation, 'notify teams channel');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Non-fatal side effect failed: notify teams channel',
        expect.objectContaining({
          error: 'network timeout',
        }),
      );
    });

    it('handles non-Error thrown values', async () => {
      const operation = vi.fn().mockRejectedValue('string error');

      const result = await withNonFatalSideEffect(
        operation,
        'send notification',
      );

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Non-fatal side effect failed: send notification',
        expect.objectContaining({
          error: 'string error',
        }),
      );
    });

    it('never throws regardless of error', async () => {
      const operation = vi.fn().mockRejectedValue(null);

      const result = await withNonFatalSideEffect(operation, 'whatever');

      expect(result).toBeNull();
    });
  });
});
