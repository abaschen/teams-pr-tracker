import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RetryConfig } from '@models/config.js';

// Mock the sleep module so we can track delay values without real waiting
vi.mock('@utils/sleep.js', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

import { withRetry, DEFAULT_RETRY_CONFIG } from '@utils/retry.js';
import { sleep } from '@utils/sleep.js';

const mockedSleep = vi.mocked(sleep);

describe('withRetry', () => {
  const testConfig: RetryConfig = {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('succeeds on first attempt without retries', async () => {
    const operation = vi.fn().mockResolvedValue('success');

    const result = await withRetry(operation, testConfig);

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(mockedSleep).not.toHaveBeenCalled();
  });

  it('succeeds after retries', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('success');

    const result = await withRetry(operation, testConfig);

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(3);
    expect(mockedSleep).toHaveBeenCalledTimes(2);
  });

  it('throws after all attempts exhausted', async () => {
    const error = new Error('persistent failure');
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withRetry(operation, testConfig)).rejects.toThrow(
      'persistent failure',
    );
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('calls onExhausted callback when all retries fail', async () => {
    const error = new Error('exhausted');
    const operation = vi.fn().mockRejectedValue(error);
    const onExhausted = vi.fn().mockResolvedValue(undefined);

    await expect(
      withRetry(operation, testConfig, onExhausted),
    ).rejects.toThrow('exhausted');

    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  it('does not call onExhausted when operation succeeds', async () => {
    const operation = vi.fn().mockResolvedValue('ok');
    const onExhausted = vi.fn().mockResolvedValue(undefined);

    await withRetry(operation, testConfig, onExhausted);

    expect(onExhausted).not.toHaveBeenCalled();
  });

  it('applies exponential backoff timing', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('success');

    await withRetry(operation, testConfig);

    // attempt 0 fails → delay = min(100 * 2^0, 5000) = 100
    expect(mockedSleep).toHaveBeenNthCalledWith(1, 100);
    // attempt 1 fails → delay = min(100 * 2^1, 5000) = 200
    expect(mockedSleep).toHaveBeenNthCalledWith(2, 200);
  });

  it('caps delay at maxDelayMs', async () => {
    const cappedConfig: RetryConfig = {
      maxAttempts: 5,
      baseDelayMs: 1000,
      maxDelayMs: 3000,
      backoffMultiplier: 3,
    };

    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockRejectedValueOnce(new Error('fail 3'))
      .mockRejectedValueOnce(new Error('fail 4'))
      .mockResolvedValue('success');

    await withRetry(operation, cappedConfig);

    // attempt 0: min(1000 * 3^0, 3000) = 1000
    expect(mockedSleep).toHaveBeenNthCalledWith(1, 1000);
    // attempt 1: min(1000 * 3^1, 3000) = 3000
    expect(mockedSleep).toHaveBeenNthCalledWith(2, 3000);
    // attempt 2: min(1000 * 3^2, 3000) = min(9000, 3000) = 3000
    expect(mockedSleep).toHaveBeenNthCalledWith(3, 3000);
    // attempt 3: min(1000 * 3^3, 3000) = min(27000, 3000) = 3000
    expect(mockedSleep).toHaveBeenNthCalledWith(4, 3000);
  });

  it('works with maxAttempts of 1 (no retries)', async () => {
    const singleConfig: RetryConfig = {
      maxAttempts: 1,
      baseDelayMs: 100,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
    };
    const error = new Error('single attempt fail');
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withRetry(operation, singleConfig)).rejects.toThrow(
      'single attempt fail',
    );
    expect(operation).toHaveBeenCalledTimes(1);
    expect(mockedSleep).not.toHaveBeenCalled();
  });
});

describe('DEFAULT_RETRY_CONFIG', () => {
  it('has expected default values from design document', () => {
    expect(DEFAULT_RETRY_CONFIG).toEqual({
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
    });
  });
});
