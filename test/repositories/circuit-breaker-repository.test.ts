/**
 * Unit tests for Circuit Breaker Repository.
 * Tests load, save, delete, and helper functions for circuit breaker state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the dynamo-client module
vi.mock('../../src/utils/dynamo-client.js', () => ({
  TABLE_NAME: 'test-table',
  docClient: {
    send: vi.fn(),
  },
}));

import { docClient } from '../../src/utils/dynamo-client.js';
import {
  buildCircuitBreakerKey,
  loadCircuitBreaker,
  saveCircuitBreaker,
  deleteCircuitBreaker,
  recordCircuitFailure,
  recordCircuitSuccess,
} from '../../src/repositories/circuit-breaker-repository.js';
import type { CircuitBreakerItem } from '../../src/models/credentials.js';

const mockSend = vi.mocked(docClient.send);

describe('buildCircuitBreakerKey', () => {
  it('builds composite key from provider and repo', () => {
    const key = buildCircuitBreakerKey('github', 'org/repo');
    expect(key).toEqual({
      PK: 'CIRCUIT#github#org/repo',
      SK: 'BREAKER',
    });
  });
});

describe('loadCircuitBreaker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns circuit breaker item when it exists', async () => {
    const mockItem: CircuitBreakerItem = {
      PK: 'CIRCUIT#github#org/repo',
      SK: 'BREAKER',
      failureCount: 2,
      lastFailureAt: '2024-01-01T00:00:00.000Z',
      ttl: 1704153600,
    };
    mockSend.mockResolvedValueOnce({ Item: mockItem } as never);

    const result = await loadCircuitBreaker('github', 'org/repo');

    expect(result).toEqual(mockItem);
  });

  it('returns null when no circuit breaker state exists', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined } as never);

    const result = await loadCircuitBreaker('github', 'org/repo');

    expect(result).toBeNull();
  });
});

describe('saveCircuitBreaker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  });

  it('saves item with TTL set to 24 hours from now', async () => {
    mockSend.mockResolvedValueOnce({} as never);

    await saveCircuitBreaker('github', 'org/repo', {
      failureCount: 1,
      lastFailureAt: '2024-01-01T00:00:00.000Z',
    });

    const expectedTtl = Math.floor(new Date('2024-01-01T00:00:00.000Z').getTime() / 1000) + 86400;

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          TableName: 'test-table',
          Item: expect.objectContaining({
            PK: 'CIRCUIT#github#org/repo',
            SK: 'BREAKER',
            failureCount: 1,
            lastFailureAt: '2024-01-01T00:00:00.000Z',
            ttl: expectedTtl,
          }),
        }),
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

describe('deleteCircuitBreaker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends delete command with correct key', async () => {
    mockSend.mockResolvedValueOnce({} as never);

    await deleteCircuitBreaker('github', 'org/repo');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          TableName: 'test-table',
          Key: { PK: 'CIRCUIT#github#org/repo', SK: 'BREAKER' },
        }),
      }),
    );
  });
});

describe('recordCircuitFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('increments failure count from zero when no existing state', async () => {
    // Load returns null (no existing state)
    mockSend.mockResolvedValueOnce({ Item: undefined } as never);
    // Save
    mockSend.mockResolvedValueOnce({} as never);

    const result = await recordCircuitFailure('github', 'org/repo');

    expect(result.failureCount).toBe(1);
    expect(result.lastFailureAt).toBe('2024-01-01T12:00:00.000Z');
    expect(result.PK).toBe('CIRCUIT#github#org/repo');
  });

  it('increments failure count from existing state', async () => {
    const existing: CircuitBreakerItem = {
      PK: 'CIRCUIT#github#org/repo',
      SK: 'BREAKER',
      failureCount: 2,
      lastFailureAt: '2024-01-01T11:00:00.000Z',
      ttl: 1704153600,
    };
    // Load returns existing state
    mockSend.mockResolvedValueOnce({ Item: existing } as never);
    // Save
    mockSend.mockResolvedValueOnce({} as never);

    const result = await recordCircuitFailure('github', 'org/repo');

    expect(result.failureCount).toBe(3);
    expect(result.lastFailureAt).toBe('2024-01-01T12:00:00.000Z');
  });
});

describe('recordCircuitSuccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes the circuit breaker record', async () => {
    mockSend.mockResolvedValueOnce({} as never);

    await recordCircuitSuccess('github', 'org/repo');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          TableName: 'test-table',
          Key: { PK: 'CIRCUIT#github#org/repo', SK: 'BREAKER' },
        }),
      }),
    );
  });
});
