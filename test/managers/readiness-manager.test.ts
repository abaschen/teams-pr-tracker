import { describe, it, expect } from 'vitest';
import { ReadinessManager } from '../../src/managers/readiness-manager.js';
import type { MergeReadinessState } from '../../src/managers/readiness-manager.js';
import type { PRState } from '../../src/models/state.js';

function createPRState(overrides: Partial<PRState> = {}): PRState {
  return {
    PK: 'PR#github#org/repo#1',
    SK: 'STATE',
    version: 1,
    provider: 'github',
    repositoryFullName: 'org/repo',
    prNumber: '1',
    prTitle: 'Test PR',
    prUrl: 'https://github.com/org/repo/pull/1',
    author: 'dev',
    branch: 'feature/test',
    status: 'open',
    requiredTeams: [],
    approvedTeams: [],
    approvalChains: [],
    threadRef: {
      conversationId: 'conv-1',
      activityId: 'act-1',
      channelId: 'chan-1',
      serviceUrl: 'https://smba.trafficmanager.net/teams',
    },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ttl: 0,
    ...overrides,
  };
}

describe('ReadinessManager', () => {
  const manager = new ReadinessManager();

  describe('computeReadiness', () => {
    it('returns ready when all teams approved and all chains complete', () => {
      const prState = createPRState({
        requiredTeams: ['security', 'platform', 'qa'],
        approvedTeams: ['security', 'platform', 'qa'],
        approvalChains: [
          {
            chainId: 'chain-1',
            orderedTeams: ['security', 'platform'],
            activeIndex: 2,
            completedTeams: ['security', 'platform'],
            complete: true,
          },
        ],
      });

      const result = manager.computeReadiness(prState);

      expect(result.isReady).toBe(true);
      expect(result.approvedTeams).toEqual(['security', 'platform', 'qa']);
      expect(result.pendingTeams).toEqual([]);
      expect(result.allChainsComplete).toBe(true);
    });

    it('returns not ready when some teams are pending', () => {
      const prState = createPRState({
        requiredTeams: ['security', 'platform', 'qa'],
        approvedTeams: ['security'],
        approvalChains: [],
      });

      const result = manager.computeReadiness(prState);

      expect(result.isReady).toBe(false);
      expect(result.approvedTeams).toEqual(['security']);
      expect(result.pendingTeams).toEqual(['platform', 'qa']);
      expect(result.allChainsComplete).toBe(true);
    });

    it('returns not ready when all teams approved but chain is incomplete', () => {
      const prState = createPRState({
        requiredTeams: ['security', 'platform'],
        approvedTeams: ['security', 'platform'],
        approvalChains: [
          {
            chainId: 'chain-1',
            orderedTeams: ['security', 'platform'],
            activeIndex: 1,
            completedTeams: ['security'],
            complete: false,
          },
        ],
      });

      const result = manager.computeReadiness(prState);

      expect(result.isReady).toBe(false);
      expect(result.approvedTeams).toEqual(['security', 'platform']);
      expect(result.pendingTeams).toEqual([]);
      expect(result.allChainsComplete).toBe(false);
    });

    it('returns ready when no required teams (vacuously true)', () => {
      const prState = createPRState({
        requiredTeams: [],
        approvedTeams: [],
        approvalChains: [],
      });

      const result = manager.computeReadiness(prState);

      expect(result.isReady).toBe(true);
      expect(result.approvedTeams).toEqual([]);
      expect(result.pendingTeams).toEqual([]);
      expect(result.allChainsComplete).toBe(true);
    });

    it('returns ready when no required teams and chains are complete', () => {
      const prState = createPRState({
        requiredTeams: [],
        approvedTeams: [],
        approvalChains: [
          {
            chainId: 'chain-1',
            orderedTeams: ['security', 'platform'],
            activeIndex: 2,
            completedTeams: ['security', 'platform'],
            complete: true,
          },
        ],
      });

      const result = manager.computeReadiness(prState);

      expect(result.isReady).toBe(true);
      expect(result.allChainsComplete).toBe(true);
    });

    it('returns not ready when no required teams but chains are incomplete', () => {
      const prState = createPRState({
        requiredTeams: [],
        approvedTeams: [],
        approvalChains: [
          {
            chainId: 'chain-1',
            orderedTeams: ['security', 'platform'],
            activeIndex: 0,
            completedTeams: [],
            complete: false,
          },
        ],
      });

      const result = manager.computeReadiness(prState);

      expect(result.isReady).toBe(false);
      expect(result.allChainsComplete).toBe(false);
    });

    it('handles multiple chains where all are complete', () => {
      const prState = createPRState({
        requiredTeams: ['security', 'qa'],
        approvedTeams: ['security', 'qa'],
        approvalChains: [
          {
            chainId: 'chain-1',
            orderedTeams: ['security'],
            activeIndex: 1,
            completedTeams: ['security'],
            complete: true,
          },
          {
            chainId: 'chain-2',
            orderedTeams: ['qa'],
            activeIndex: 1,
            completedTeams: ['qa'],
            complete: true,
          },
        ],
      });

      const result = manager.computeReadiness(prState);

      expect(result.isReady).toBe(true);
      expect(result.allChainsComplete).toBe(true);
    });

    it('handles multiple chains where one is incomplete', () => {
      const prState = createPRState({
        requiredTeams: ['security', 'qa'],
        approvedTeams: ['security', 'qa'],
        approvalChains: [
          {
            chainId: 'chain-1',
            orderedTeams: ['security'],
            activeIndex: 1,
            completedTeams: ['security'],
            complete: true,
          },
          {
            chainId: 'chain-2',
            orderedTeams: ['qa', 'ops'],
            activeIndex: 1,
            completedTeams: ['qa'],
            complete: false,
          },
        ],
      });

      const result = manager.computeReadiness(prState);

      expect(result.isReady).toBe(false);
      expect(result.allChainsComplete).toBe(false);
    });
  });

  describe('hasReadinessChanged', () => {
    it('detects transition from not ready to ready', () => {
      expect(manager.hasReadinessChanged(false, true)).toBe(true);
    });

    it('detects transition from ready to not ready', () => {
      expect(manager.hasReadinessChanged(true, false)).toBe(true);
    });

    it('returns false when state remains ready', () => {
      expect(manager.hasReadinessChanged(true, true)).toBe(false);
    });

    it('returns false when state remains not ready', () => {
      expect(manager.hasReadinessChanged(false, false)).toBe(false);
    });
  });

  describe('buildReadinessMessage', () => {
    it('builds ready message with approved team names', () => {
      const state: MergeReadinessState = {
        isReady: true,
        approvedTeams: ['security', 'platform', 'qa'],
        pendingTeams: [],
        allChainsComplete: true,
      };

      const message = manager.buildReadinessMessage(state);

      expect(message).toBe('✅ PR is ready to merge! All teams approved: security, platform, qa');
    });

    it('builds not-ready message with approved and pending teams', () => {
      const state: MergeReadinessState = {
        isReady: false,
        approvedTeams: ['security'],
        pendingTeams: ['platform', 'qa'],
        allChainsComplete: true,
      };

      const message = manager.buildReadinessMessage(state);

      expect(message).toBe('❌ PR is not ready. Approved: security. Pending: platform, qa');
    });

    it('builds not-ready message with no approvals', () => {
      const state: MergeReadinessState = {
        isReady: false,
        approvedTeams: [],
        pendingTeams: ['security', 'platform'],
        allChainsComplete: false,
      };

      const message = manager.buildReadinessMessage(state);

      expect(message).toBe('❌ PR is not ready. Approved: none. Pending: security, platform');
    });

    it('builds ready message with no teams (vacuous case)', () => {
      const state: MergeReadinessState = {
        isReady: true,
        approvedTeams: [],
        pendingTeams: [],
        allChainsComplete: true,
      };

      const message = manager.buildReadinessMessage(state);

      expect(message).toBe('✅ PR is ready to merge! All teams approved: none');
    });

    it('message includes team names', () => {
      const state: MergeReadinessState = {
        isReady: false,
        approvedTeams: ['frontend-team'],
        pendingTeams: ['backend-team'],
        allChainsComplete: false,
      };

      const message = manager.buildReadinessMessage(state);

      expect(message).toContain('frontend-team');
      expect(message).toContain('backend-team');
    });
  });
});
