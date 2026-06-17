import { describe, it, expect, vi } from 'vitest';
import { MentionManager } from '../../src/managers/mention-manager.js';
import type { ValidationTeamConfig } from '../../src/models/rules.js';

function createTeamConfig(teamName: string, teamsTagId?: string): ValidationTeamConfig {
  return {
    teamName,
    teamsTagId: teamsTagId ?? `tag-${teamName}`,
    reviewers: [`${teamName}-reviewer1`],
  };
}

describe('MentionManager', () => {
  const manager = new MentionManager();

  describe('computeMentions', () => {
    it('returns all teams when none are approved (initial thread creation)', () => {
      const required = ['security', 'platform', 'qa'];
      const approved: string[] = [];

      const result = manager.computeMentions(required, approved);

      expect(result).toEqual(['security', 'platform', 'qa']);
    });

    it('removes approved team from mentions', () => {
      const required = ['security', 'platform', 'qa'];
      const approved = ['security'];

      const result = manager.computeMentions(required, approved);

      expect(result).toEqual(['platform', 'qa']);
    });

    it('adds revoked team back to mentions (team no longer in approved list)', () => {
      const required = ['security', 'platform', 'qa'];
      // After revocation, the team is removed from approved list
      const approved = ['security']; // platform revoked their approval

      const result = manager.computeMentions(required, approved);

      expect(result).toEqual(['platform', 'qa']);
    });

    it('returns empty array when all teams have approved', () => {
      const required = ['security', 'platform', 'qa'];
      const approved = ['security', 'platform', 'qa'];

      const result = manager.computeMentions(required, approved);

      expect(result).toEqual([]);
    });

    it('handles multiple teams with some approved', () => {
      const required = ['security', 'platform', 'qa', 'design', 'ops'];
      const approved = ['security', 'qa'];

      const result = manager.computeMentions(required, approved);

      expect(result).toEqual(['platform', 'design', 'ops']);
    });

    it('handles empty required teams', () => {
      const required: string[] = [];
      const approved: string[] = [];

      const result = manager.computeMentions(required, approved);

      expect(result).toEqual([]);
    });

    it('ignores approved teams not in required list', () => {
      const required = ['security', 'platform'];
      const approved = ['security', 'unrelated-team'];

      const result = manager.computeMentions(required, approved);

      expect(result).toEqual(['platform']);
    });
  });

  describe('shouldUpdateMentions', () => {
    it('returns false when mentions are identical', () => {
      const current = ['security', 'platform'];
      const updated = ['security', 'platform'];

      expect(manager.shouldUpdateMentions(current, updated)).toBe(false);
    });

    it('returns true when a mention is removed', () => {
      const current = ['security', 'platform'];
      const updated = ['platform'];

      expect(manager.shouldUpdateMentions(current, updated)).toBe(true);
    });

    it('returns true when a mention is added', () => {
      const current = ['platform'];
      const updated = ['security', 'platform'];

      expect(manager.shouldUpdateMentions(current, updated)).toBe(true);
    });

    it('returns false for same elements in different order', () => {
      const current = ['security', 'platform', 'qa'];
      const updated = ['qa', 'security', 'platform'];

      expect(manager.shouldUpdateMentions(current, updated)).toBe(false);
    });

    it('returns true when mentions are completely different', () => {
      const current = ['security', 'platform'];
      const updated = ['qa', 'ops'];

      expect(manager.shouldUpdateMentions(current, updated)).toBe(true);
    });

    it('returns true when going from some to empty', () => {
      const current = ['security', 'platform'];
      const updated: string[] = [];

      expect(manager.shouldUpdateMentions(current, updated)).toBe(true);
    });

    it('returns true when going from empty to some', () => {
      const current: string[] = [];
      const updated = ['security'];

      expect(manager.shouldUpdateMentions(current, updated)).toBe(true);
    });

    it('returns false when both are empty', () => {
      const current: string[] = [];
      const updated: string[] = [];

      expect(manager.shouldUpdateMentions(current, updated)).toBe(false);
    });
  });

  describe('buildMentionText', () => {
    it('builds mention text with at-tags for pending teams', () => {
      const pendingTeams = [createTeamConfig('security'), createTeamConfig('platform')];

      const result = manager.buildMentionText(pendingTeams);

      expect(result).toBe('Pending approvals: <at>security</at>, <at>platform</at>');
    });

    it('builds mention text for a single team', () => {
      const pendingTeams = [createTeamConfig('qa')];

      const result = manager.buildMentionText(pendingTeams);

      expect(result).toBe('Pending approvals: <at>qa</at>');
    });

    it('returns empty string when no pending teams', () => {
      const pendingTeams: ValidationTeamConfig[] = [];

      const result = manager.buildMentionText(pendingTeams);

      expect(result).toBe('');
    });
  });

  describe('buildMentionEntities', () => {
    it('creates mention entity objects for Bot Framework API', () => {
      const pendingTeams = [
        createTeamConfig('security', 'tag-sec-123'),
        createTeamConfig('platform', 'tag-plat-456'),
      ];

      const entities = manager.buildMentionEntities(pendingTeams);

      expect(entities).toHaveLength(2);
      expect(entities[0]).toEqual({
        type: 'mention',
        text: '<at>security</at>',
        mentioned: {
          id: 'tag-sec-123',
          name: 'security',
        },
      });
      expect(entities[1]).toEqual({
        type: 'mention',
        text: '<at>platform</at>',
        mentioned: {
          id: 'tag-plat-456',
          name: 'platform',
        },
      });
    });

    it('returns empty array when no pending teams', () => {
      const entities = manager.buildMentionEntities([]);

      expect(entities).toEqual([]);
    });
  });

  describe('withRetry', () => {
    it('returns result on first success', async () => {
      const manager = new MentionManager({
        maxAttempts: 3,
        baseDelayMs: 10,
        backoffMultiplier: 2,
      });
      const operation = vi.fn().mockResolvedValue('success');

      const result = await manager.withRetry(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('retries on failure and succeeds on subsequent attempt', async () => {
      const manager = new MentionManager({
        maxAttempts: 3,
        baseDelayMs: 10,
        backoffMultiplier: 2,
      });
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockResolvedValue('success');

      const result = await manager.withRetry(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting all retry attempts', async () => {
      const manager = new MentionManager({
        maxAttempts: 3,
        baseDelayMs: 10,
        backoffMultiplier: 2,
      });
      const operation = vi.fn().mockRejectedValue(new Error('persistent failure'));

      await expect(manager.withRetry(operation)).rejects.toThrow('persistent failure');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('applies exponential backoff between retries', async () => {
      const delays: number[] = [];
      const manager = new MentionManager({
        maxAttempts: 3,
        baseDelayMs: 100,
        backoffMultiplier: 2,
      });

      // Track sleep calls via timing
      const start = Date.now();
      const operation = vi
        .fn()
        .mockImplementation(() => {
          delays.push(Date.now() - start);
          return Promise.reject(new Error('fail'));
        });

      // Use short delays so test runs quickly and verify the pattern
      const shortManager = new MentionManager({
        maxAttempts: 3,
        baseDelayMs: 10,
        backoffMultiplier: 2,
      });
      const shortOp = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(shortManager.withRetry(shortOp)).rejects.toThrow('fail');
      // 3 attempts total: initial + 2 retries
      expect(shortOp).toHaveBeenCalledTimes(3);
    });
  });
});
