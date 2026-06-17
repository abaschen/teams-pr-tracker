/**
 * Unit tests for PR State Repository.
 * Tests load, save (with conditional writes), delete, and retry logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

// Mock the dynamo-client module
vi.mock('../../src/utils/dynamo-client.js', () => ({
  TABLE_NAME: 'test-table',
  docClient: {
    send: vi.fn(),
  },
}));

import { docClient } from '../../src/utils/dynamo-client.js';
import {
  buildPRStateKey,
  loadPRState,
  savePRState,
  savePRStateWithRetry,
  deletePRState,
} from '../../src/repositories/pr-state-repository.js';
import type { PRStateItem } from '../../src/models/state.js';

const mockSend = vi.mocked(docClient.send);

function createMockPRState(overrides: Partial<PRStateItem> = {}): PRStateItem {
  return {
    PK: 'PR#github#org/repo#42',
    SK: 'STATE',
    version: 1,
    provider: 'github',
    repositoryFullName: 'org/repo',
    prNumber: '42',
    prTitle: 'Test PR',
    prUrl: 'https://github.com/org/repo/pull/42',
    author: 'testuser',
    branch: 'feature/test',
    status: 'open',
    requiredTeams: ['team-a', 'team-b'],
    approvedTeams: [],
    approvalChains: [],
    threadRef: {
      conversationId: 'conv-1',
      activityId: 'act-1',
      channelId: 'chan-1',
      serviceUrl: 'https://smba.trafficmanager.net/teams',
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ttl: 0,
    ...overrides,
  };
}

describe('buildPRStateKey', () => {
  it('builds composite key from provider, repo, and PR number', () => {
    const key = buildPRStateKey('github', 'org/repo', '42');
    expect(key).toEqual({
      PK: 'PR#github#org/repo#42',
      SK: 'STATE',
    });
  });

  it('handles different providers', () => {
    const key = buildPRStateKey('bitbucket', 'workspace/project', '100');
    expect(key).toEqual({
      PK: 'PR#bitbucket#workspace/project#100',
      SK: 'STATE',
    });
  });
});

describe('loadPRState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the PR state item when it exists', async () => {
    const mockState = createMockPRState();
    mockSend.mockResolvedValueOnce({ Item: mockState } as never);

    const result = await loadPRState('github', 'org/repo', '42');

    expect(result).toEqual(mockState);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          TableName: 'test-table',
          Key: { PK: 'PR#github#org/repo#42', SK: 'STATE' },
          ConsistentRead: true,
        }),
      }),
    );
  });

  it('returns null when item does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined } as never);

    const result = await loadPRState('github', 'org/repo', '999');

    expect(result).toBeNull();
  });
});

describe('savePRState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates new item with attribute_not_exists condition when version is 0', async () => {
    const state = createMockPRState({ version: 0 });
    mockSend.mockResolvedValueOnce({} as never);

    const result = await savePRState(state);

    expect(result).toEqual({ success: true });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          TableName: 'test-table',
          ConditionExpression: 'attribute_not_exists(PK)',
          Item: expect.objectContaining({ version: 1 }),
        }),
      }),
    );
  });

  it('updates existing item with version condition expression', async () => {
    const state = createMockPRState({ version: 3 });
    mockSend.mockResolvedValueOnce({} as never);

    const result = await savePRState(state);

    expect(result).toEqual({ success: true });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          TableName: 'test-table',
          ConditionExpression: '#v = :expectedVersion',
          ExpressionAttributeNames: { '#v': 'version' },
          ExpressionAttributeValues: { ':expectedVersion': 3 },
          Item: expect.objectContaining({ version: 4 }),
        }),
      }),
    );
  });

  it('returns conflict with current state on ConditionalCheckFailedException', async () => {
    const state = createMockPRState({ version: 2 });
    const currentState = createMockPRState({ version: 3 });

    const error = new ConditionalCheckFailedException({
      message: 'Condition not met',
      $metadata: {},
    });
    mockSend.mockRejectedValueOnce(error);
    // Re-read after conflict
    mockSend.mockResolvedValueOnce({ Item: currentState } as never);

    const result = await savePRState(state);

    expect(result).toEqual({
      success: false,
      reason: 'conflict',
      currentState,
    });
  });

  it('re-throws non-conflict errors', async () => {
    const state = createMockPRState({ version: 1 });
    const error = new Error('Service unavailable');
    mockSend.mockRejectedValueOnce(error);

    await expect(savePRState(state)).rejects.toThrow('Service unavailable');
  });
});

describe('savePRStateWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('succeeds on first attempt', async () => {
    const state = createMockPRState({ version: 1 });
    mockSend.mockResolvedValueOnce({} as never);

    const reprocess = vi.fn();
    const result = await savePRStateWithRetry(state, reprocess);

    expect(result).toEqual({ success: true });
    expect(reprocess).not.toHaveBeenCalled();
  });

  it('retries on conflict and succeeds on second attempt', async () => {
    const state = createMockPRState({ version: 1 });
    const currentState = createMockPRState({ version: 2 });
    const reprocessedState = createMockPRState({ version: 2, approvedTeams: ['team-a'] });

    // First attempt: conflict
    const error = new ConditionalCheckFailedException({
      message: 'Condition not met',
      $metadata: {},
    });
    mockSend.mockRejectedValueOnce(error);
    mockSend.mockResolvedValueOnce({ Item: currentState } as never);

    // Second attempt: success
    mockSend.mockResolvedValueOnce({} as never);

    const reprocess = vi.fn().mockReturnValue(reprocessedState);
    const result = await savePRStateWithRetry(state, reprocess);

    expect(result).toEqual({ success: true });
    expect(reprocess).toHaveBeenCalledWith(currentState);
    expect(reprocess).toHaveBeenCalledTimes(1);
  });

  it('exhausts retries after 3 conflicts', async () => {
    const state = createMockPRState({ version: 1 });
    const conflict = new ConditionalCheckFailedException({
      message: 'Condition not met',
      $metadata: {},
    });

    // Three conflict attempts
    for (let i = 0; i < 3; i++) {
      mockSend.mockRejectedValueOnce(conflict);
      mockSend.mockResolvedValueOnce({
        Item: createMockPRState({ version: i + 2 }),
      } as never);
    }

    // Final read after exhaustion
    const finalState = createMockPRState({ version: 5 });
    mockSend.mockResolvedValueOnce({ Item: finalState } as never);

    const reprocess = vi.fn((current: PRStateItem) => current);
    const result = await savePRStateWithRetry(state, reprocess);

    expect(result).toEqual({
      success: false,
      reason: 'conflict',
      currentState: finalState,
    });
    expect(reprocess).toHaveBeenCalledTimes(3);
  });
});

describe('deletePRState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends delete command with correct key', async () => {
    mockSend.mockResolvedValueOnce({} as never);

    await deletePRState('github', 'org/repo', '42');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          TableName: 'test-table',
          Key: { PK: 'PR#github#org/repo#42', SK: 'STATE' },
        }),
      }),
    );
  });
});
