/**
 * Approval Chain Manager - manages sequential approval ordering.
 * Enforces that teams approve in the configured order within an approval chain.
 */

import type { ApprovalChainManager, ChainTransitionResult } from '../models/interfaces.js';
import type { ApprovalChainConfig } from '../models/rules.js';
import type { PRState } from '../models/state.js';

export class ApprovalChainManagerImpl implements ApprovalChainManager {
  /**
   * Initialize a new approval chain on the PR state.
   * Sets activeIndex to 0 (first team is active), completedTeams to empty,
   * and complete to false.
   */
  initializeChain(chain: ApprovalChainConfig, prState: PRState): PRState {
    const chainState = {
      chainId: chain.id,
      orderedTeams: [...chain.orderedTeams],
      activeIndex: 0,
      completedTeams: [] as string[],
      complete: false,
    };

    return {
      ...prState,
      approvalChains: [...prState.approvalChains, chainState],
    };
  }

  /**
   * Get all currently active teams across all incomplete approval chains.
   * For each incomplete chain, returns the team at the current activeIndex.
   */
  getActiveTeams(prState: PRState): string[] {
    const activeTeams: string[] = [];

    for (const chain of prState.approvalChains) {
      if (!chain.complete && chain.activeIndex < chain.orderedTeams.length) {
        activeTeams.push(chain.orderedTeams[chain.activeIndex]);
      }
    }

    return activeTeams;
  }

  /**
   * Process an approval from a team. Stub implementation for task 8.1.
   * Full implementation in task 8.2.
   */
  processApproval(team: string, prState: PRState): ChainTransitionResult {
    return {
      updatedState: prState,
      teamsToActivate: [],
      teamsToDeactivate: [],
      rejected: false,
    };
  }

  /**
   * Revoke an approval from a team. Stub implementation for task 8.1.
   * Full implementation in task 8.3.
   */
  revokeApproval(team: string, prState: PRState): ChainTransitionResult {
    return {
      updatedState: prState,
      teamsToActivate: [],
      teamsToDeactivate: [],
      rejected: false,
    };
  }
}
