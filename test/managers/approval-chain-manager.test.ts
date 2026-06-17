import { describe, it, expect } from 'vitest';
import { ApprovalChainManagerImpl } from '../../src/managers/approval-chain-manager.js';
import type { ApprovalChainConfig } from '../../src/models/rules.js';
import type { PRState } from '../../src/models/state.js';

function createEmptyPRState(overrides: Partial<PRState> = {}): PRState {
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

describe('ApprovalChainManagerImpl', () => {
  const manager = new ApprovalChainManagerImpl();

  describe('initializeChain', () => {
    it('sets correct state for a new chain', () => {
      const chain: ApprovalChainConfig = {
        id: 'chain-1',
        orderedTeams: ['security', 'platform', 'release'],
      };
      const prState = createEmptyPRState();

      const result = manager.initializeChain(chain, prState);

      expect(result.approvalChains).toHaveLength(1);
      const chainState = result.approvalChains[0];
      expect(chainState.chainId).toBe('chain-1');
      expect(chainState.orderedTeams).toEqual(['security', 'platform', 'release']);
      expect(chainState.activeIndex).toBe(0);
      expect(chainState.completedTeams).toEqual([]);
      expect(chainState.complete).toBe(false);
    });

    it('does not mutate the original PRState', () => {
      const chain: ApprovalChainConfig = {
        id: 'chain-1',
        orderedTeams: ['security', 'platform'],
      };
      const prState = createEmptyPRState();

      const result = manager.initializeChain(chain, prState);

      expect(prState.approvalChains).toHaveLength(0);
      expect(result.approvalChains).toHaveLength(1);
    });

    it('appends to existing chains without overwriting', () => {
      const chain1: ApprovalChainConfig = {
        id: 'chain-1',
        orderedTeams: ['security', 'platform'],
      };
      const chain2: ApprovalChainConfig = {
        id: 'chain-2',
        orderedTeams: ['qa', 'ops'],
      };
      const prState = createEmptyPRState();

      const afterFirst = manager.initializeChain(chain1, prState);
      const afterSecond = manager.initializeChain(chain2, afterFirst);

      expect(afterSecond.approvalChains).toHaveLength(2);
      expect(afterSecond.approvalChains[0].chainId).toBe('chain-1');
      expect(afterSecond.approvalChains[1].chainId).toBe('chain-2');
    });

    it('copies orderedTeams by value, not by reference', () => {
      const teams = ['security', 'platform'];
      const chain: ApprovalChainConfig = { id: 'chain-1', orderedTeams: teams };
      const prState = createEmptyPRState();

      const result = manager.initializeChain(chain, prState);
      teams.push('extra');

      expect(result.approvalChains[0].orderedTeams).toEqual(['security', 'platform']);
    });
  });

  describe('getActiveTeams', () => {
    it('returns the first team from each incomplete chain', () => {
      const prState = createEmptyPRState({
        approvalChains: [
          {
            chainId: 'chain-1',
            orderedTeams: ['security', 'platform', 'release'],
            activeIndex: 0,
            completedTeams: [],
            complete: false,
          },
        ],
      });

      const activeTeams = manager.getActiveTeams(prState);

      expect(activeTeams).toEqual(['security']);
    });

    it('returns active teams from multiple independent chains', () => {
      const prState = createEmptyPRState({
        approvalChains: [
          {
            chainId: 'chain-1',
            orderedTeams: ['security', 'platform'],
            activeIndex: 0,
            completedTeams: [],
            complete: false,
          },
          {
            chainId: 'chain-2',
            orderedTeams: ['qa', 'ops'],
            activeIndex: 0,
            completedTeams: [],
            complete: false,
          },
        ],
      });

      const activeTeams = manager.getActiveTeams(prState);

      expect(activeTeams).toEqual(['security', 'qa']);
    });

    it('returns team at current activeIndex when chain has advanced', () => {
      const prState = createEmptyPRState({
        approvalChains: [
          {
            chainId: 'chain-1',
            orderedTeams: ['security', 'platform', 'release'],
            activeIndex: 1,
            completedTeams: ['security'],
            complete: false,
          },
        ],
      });

      const activeTeams = manager.getActiveTeams(prState);

      expect(activeTeams).toEqual(['platform']);
    });

    it('does not include teams from complete chains', () => {
      const prState = createEmptyPRState({
        approvalChains: [
          {
            chainId: 'chain-1',
            orderedTeams: ['security', 'platform'],
            activeIndex: 2,
            completedTeams: ['security', 'platform'],
            complete: true,
          },
          {
            chainId: 'chain-2',
            orderedTeams: ['qa', 'ops'],
            activeIndex: 0,
            completedTeams: [],
            complete: false,
          },
        ],
      });

      const activeTeams = manager.getActiveTeams(prState);

      expect(activeTeams).toEqual(['qa']);
    });

    it('returns empty array when all chains are complete', () => {
      const prState = createEmptyPRState({
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

      const activeTeams = manager.getActiveTeams(prState);

      expect(activeTeams).toEqual([]);
    });

    it('returns empty array when there are no approval chains', () => {
      const prState = createEmptyPRState();

      const activeTeams = manager.getActiveTeams(prState);

      expect(activeTeams).toEqual([]);
    });
  });

  describe('processApproval', () => {
    it('advances chain when the active team approves', () => {
      const prState = createEmptyPRState({
        approvalChains: [
          {
            chainId: 'chain-1',
            orderedTeams: ['security', 'platform', 'release'],
            activeIndex: 0,
            completedTeams: [],
            complete: false,
          },
        ],
      });

      const result = manager.processApproval('security', prState);

      expect(result.rejected).toBe(false);
      expect(result.updatedState.approvalChains[0].activeIndex).toBe(1);
      expect(result.updatedState.approvalChains[0].completedTeams).toEqual(['security']);
      expect(result.updatedState.approvalChains[0].complete).toBe(false);
      expect(result.teamsToActivate).toEqual(['platform']);
      expect(result.teamsToDeactivate).toEqual([]);
    });

    it('rejects out-of-order approval (team index > activeIndex)', () => {
      const prState = createEmptyPRState({
        approvalChains: [
          {
            chainId: 'chain-1',
            orderedTeams: ['security', 'platform', 'release'],
            activeIndex: 0,
            completedTeams: [],
            complete: false,
          },
        ],
      });

      const result = manager.processApproval('platform', prState);

      expect(result.rejected).toBe(true);
      expect(result.rejectionReason).toContain('platform');
      expect(result.rejectionReason).toContain('security');
      expect(result.updatedState).toBe(prState); // no state change
      expect(result.teamsToActivate).toEqual([]);
      expect(result.teamsToDeactivate).toEqual([]);
    });

    it('marks chain complete when last team approves', () => {
      const prState = createEmptyPRState({
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

      const result = manager.processApproval('platform', prState);

      expect(result.rejected).toBe(false);
      expect(result.updatedState.approvalChains[0].complete).toBe(true);
      expect(result.updatedState.approvalChains[0].activeIndex).toBe(2);
      expect(result.updatedState.approvalChains[0].completedTeams).toEqual(['security', 'platform']);
      expect(result.teamsToActivate).toEqual([]); // no next team
      expect(result.teamsToDeactivate).toEqual([]);
    });

    it('returns rejected: false for teams not in any chain', () => {
      const prState = createEmptyPRState({
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

      const result = manager.processApproval('design', prState);

      expect(result.rejected).toBe(false);
      expect(result.updatedState).toBe(prState); // no state change
      expect(result.teamsToActivate).toEqual([]);
      expect(result.teamsToDeactivate).toEqual([]);
    });

    it('does not affect other chains when approving in one chain', () => {
      const prState = createEmptyPRState({
        approvalChains: [
          {
            chainId: 'chain-1',
            orderedTeams: ['security', 'platform'],
            activeIndex: 0,
            completedTeams: [],
            complete: false,
          },
          {
            chainId: 'chain-2',
            orderedTeams: ['qa', 'ops'],
            activeIndex: 0,
            completedTeams: [],
            complete: false,
          },
        ],
      });

      const result = manager.processApproval('security', prState);

      expect(result.rejected).toBe(false);
      // chain-1 advanced
      expect(result.updatedState.approvalChains[0].activeIndex).toBe(1);
      expect(result.updatedState.approvalChains[0].completedTeams).toEqual(['security']);
      // chain-2 unaffected
      expect(result.updatedState.approvalChains[1].activeIndex).toBe(0);
      expect(result.updatedState.approvalChains[1].completedTeams).toEqual([]);
      expect(result.updatedState.approvalChains[1].complete).toBe(false);
    });

    it('handles idempotent approval (team index < activeIndex)', () => {
      const prState = createEmptyPRState({
        approvalChains: [
          {
            chainId: 'chain-1',
            orderedTeams: ['security', 'platform', 'release'],
            activeIndex: 2,
            completedTeams: ['security', 'platform'],
            complete: false,
          },
        ],
      });

      const result = manager.processApproval('security', prState);

      expect(result.rejected).toBe(false);
      expect(result.updatedState).toBe(prState); // no state change
      expect(result.teamsToActivate).toEqual([]);
      expect(result.teamsToDeactivate).toEqual([]);
    });

    it('does not mutate the original PRState', () => {
      const prState = createEmptyPRState({
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

      manager.processApproval('security', prState);

      // Original state should be unchanged
      expect(prState.approvalChains[0].activeIndex).toBe(0);
      expect(prState.approvalChains[0].completedTeams).toEqual([]);
      expect(prState.approvalChains[0].complete).toBe(false);
    });

    it('returns rejected: false with no changes when there are no chains', () => {
      const prState = createEmptyPRState();

      const result = manager.processApproval('security', prState);

      expect(result.rejected).toBe(false);
      expect(result.updatedState).toBe(prState);
      expect(result.teamsToActivate).toEqual([]);
      expect(result.teamsToDeactivate).toEqual([]);
    });
  });

  describe('revokeApproval', () => {
    it('cascades deactivation to all subsequent teams', () => {
      const prState = createEmptyPRState({
        approvalChains: [
          {
            chainId: 'chain-1',
            orderedTeams: ['security', 'platform', 'release'],
            activeIndex: 2,
            completedTeams: ['security', 'platform'],
            complete: false,
          },
        ],
      });

      const result = manager.revokeApproval('security', prState);

      expect(result.rejected).toBe(false);
      // platform was completed, release was active — both deactivated
      expect(result.teamsToDeactivate).toContain('platform');
      expect(result.teamsToDeactivate).toContain('release');
      expect(result.teamsToDeactivate).toHaveLength(2);
    });

    it('resets activeIndex to the revoking team position', () => {
      const prState = createEmptyPRState({
        approvalChains: [
          {
            chainId: 'chain-1',
            orderedTeams: ['security', 'platform', 'release'],
            activeIndex: 2,
            completedTeams: ['security', 'platform'],
            complete: false,
          },
        ],
      });

      const result = manager.revokeApproval('security', prState);

      const chain = result.updatedState.approvalChains[0];
      expect(chain.activeIndex).toBe(0);
    });

    it('marks a completed chain as incomplete after revocation', () => {
      const prState = createEmptyPRState({
        approvalChains: [
          {
            chainId: 'chain-1',
            orderedTeams: ['security', 'platform', 'release'],
            activeIndex: 3,
            completedTeams: ['security', 'platform', 'release'],
            complete: true,
          },
        ],
      });

      const result = manager.revokeApproval('platform', prState);

      const chain = result.updatedState.approvalChains[0];
      expect(chain.complete).toBe(false);
      expect(chain.activeIndex).toBe(1);
    });

    it('does not affect teams not in any chain', () => {
      const prState = createEmptyPRState({
        approvalChains: [
          {
            chainId: 'chain-1',
            orderedTeams: ['security', 'platform', 'release'],
            activeIndex: 1,
            completedTeams: ['security'],
            complete: false,
          },
        ],
      });

      const result = manager.revokeApproval('unrelated-team', prState);

      expect(result.rejected).toBe(false);
      expect(result.teamsToActivate).toEqual([]);
      expect(result.teamsToDeactivate).toEqual([]);
      expect(result.updatedState).toEqual(prState);
    });

    it('trims completedTeams to exclude deactivated teams', () => {
      const prState = createEmptyPRState({
        approvalChains: [
          {
            chainId: 'chain-1',
            orderedTeams: ['security', 'platform', 'release'],
            activeIndex: 3,
            completedTeams: ['security', 'platform', 'release'],
            complete: true,
          },
        ],
      });

      const result = manager.revokeApproval('security', prState);

      const chain = result.updatedState.approvalChains[0];
      // security revokes, so completedTeams should be empty (only teams before security are kept)
      expect(chain.completedTeams).toEqual([]);
      expect(chain.completedTeams).not.toContain('platform');
      expect(chain.completedTeams).not.toContain('release');
      expect(chain.completedTeams).not.toContain('security');
    });

    it('preserves completedTeams for teams before the revoking team', () => {
      const prState = createEmptyPRState({
        approvalChains: [
          {
            chainId: 'chain-1',
            orderedTeams: ['security', 'platform', 'release', 'qa'],
            activeIndex: 4,
            completedTeams: ['security', 'platform', 'release', 'qa'],
            complete: true,
          },
        ],
      });

      const result = manager.revokeApproval('release', prState);

      const chain = result.updatedState.approvalChains[0];
      // Only teams before 'release' (index 2) are kept: security, platform
      expect(chain.completedTeams).toEqual(['security', 'platform']);
      expect(chain.activeIndex).toBe(2);
      expect(chain.complete).toBe(false);
    });

    it('does not mutate the original PRState', () => {
      const prState = createEmptyPRState({
        approvalChains: [
          {
            chainId: 'chain-1',
            orderedTeams: ['security', 'platform', 'release'],
            activeIndex: 2,
            completedTeams: ['security', 'platform'],
            complete: false,
          },
        ],
      });

      manager.revokeApproval('security', prState);

      // Original state should be unchanged
      expect(prState.approvalChains[0].activeIndex).toBe(2);
      expect(prState.approvalChains[0].completedTeams).toEqual(['security', 'platform']);
    });
  });
});
