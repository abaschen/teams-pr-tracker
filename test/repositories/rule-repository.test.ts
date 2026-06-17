/**
 * Unit tests for Rule Repository.
 * Tests loading annotation rules from DynamoDB.
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
import { loadAllRules, loadRuleById } from '../../src/repositories/rule-repository.js';
import type { AnnotationRuleItem } from '../../src/models/rules.js';

const mockSend = vi.mocked(docClient.send);

function createMockRuleItem(ruleId: string, name: string): AnnotationRuleItem {
  return {
    PK: `RULE#${ruleId}`,
    SK: 'CONFIG',
    name,
    conditions: [{ type: 'file_path', pattern: 'src/**/*.ts' }],
    validationTeams: [
      {
        teamName: 'frontend',
        teamsTagId: 'tag-123',
        reviewers: ['dev1', 'dev2'],
      },
    ],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

describe('loadAllRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all rules from DynamoDB', async () => {
    const ruleItems = [createMockRuleItem('rule-1', 'Frontend Rule'), createMockRuleItem('rule-2', 'Backend Rule')];

    mockSend.mockResolvedValueOnce({
      Items: ruleItems,
      LastEvaluatedKey: undefined,
    } as never);

    const rules = await loadAllRules();

    expect(rules).toHaveLength(2);
    expect(rules[0]).toEqual({
      id: 'rule-1',
      name: 'Frontend Rule',
      conditions: [{ type: 'file_path', pattern: 'src/**/*.ts' }],
      validationTeams: [
        {
          teamName: 'frontend',
          teamsTagId: 'tag-123',
          reviewers: ['dev1', 'dev2'],
        },
      ],
      approvalChain: undefined,
    });
  });

  it('handles pagination across multiple pages', async () => {
    const page1 = [createMockRuleItem('rule-1', 'Rule 1')];
    const page2 = [createMockRuleItem('rule-2', 'Rule 2')];

    mockSend.mockResolvedValueOnce({
      Items: page1,
      LastEvaluatedKey: { PK: 'RULE#rule-1', SK: 'CONFIG' },
    } as never);
    mockSend.mockResolvedValueOnce({
      Items: page2,
      LastEvaluatedKey: undefined,
    } as never);

    const rules = await loadAllRules();

    expect(rules).toHaveLength(2);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('returns empty array when no rules exist', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    } as never);

    const rules = await loadAllRules();

    expect(rules).toHaveLength(0);
  });

  it('filters out non-RULE items returned from GSI', async () => {
    const items = [
      createMockRuleItem('rule-1', 'Valid Rule'),
      { PK: 'CIRCUIT#github#org/repo', SK: 'CONFIG', failureCount: 1 }, // Not a rule
    ];

    mockSend.mockResolvedValueOnce({
      Items: items,
      LastEvaluatedKey: undefined,
    } as never);

    const rules = await loadAllRules();

    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe('rule-1');
  });
});

describe('loadRuleById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the rule when it exists', async () => {
    const ruleItem = createMockRuleItem('rule-1', 'Frontend Rule');
    mockSend.mockResolvedValueOnce({ Item: ruleItem } as never);

    const rule = await loadRuleById('rule-1');

    expect(rule).toEqual({
      id: 'rule-1',
      name: 'Frontend Rule',
      conditions: [{ type: 'file_path', pattern: 'src/**/*.ts' }],
      validationTeams: [
        {
          teamName: 'frontend',
          teamsTagId: 'tag-123',
          reviewers: ['dev1', 'dev2'],
        },
      ],
      approvalChain: undefined,
    });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          TableName: 'test-table',
          Key: { PK: 'RULE#rule-1', SK: 'CONFIG' },
        }),
      }),
    );
  });

  it('returns null when rule does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined } as never);

    const rule = await loadRuleById('nonexistent');

    expect(rule).toBeNull();
  });
});
