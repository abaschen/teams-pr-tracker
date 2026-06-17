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
   * Process an approval from a team.
   * Finds the chain containing the team, validates ordering, and advances the chain.
   *
   * - If the team is not in any chain: return rejected: false (normal approval)
   * - If the team's index > activeIndex: reject (out of order)
   * - If the team's index < activeIndex: already approved, return rejected: false (idempotent)
   * - If the team's index === activeIndex: approve, advance chain
   */
  processApproval(team: string, prState: PRState): ChainTransitionResult {
    // Find the chain containing this team
    let targetChainIndex = -1;
    let teamIndex = -1;

    for (let i = 0; i < prState.approvalChains.length; i++) {
      const chain = prState.approvalChains[i];
      const idx = chain.orderedTeams.indexOf(team);
      if (idx !== -1) {
        targetChainIndex = i;
        teamIndex = idx;
        break;
      }
    }

    // Team is not in any chain — not a chain team, just a normal approval
    if (targetChainIndex === -1) {
      return {
        updatedState: prState,
        teamsToActivate: [],
        teamsToDeactivate: [],
        rejected: false,
      };
    }

    const chain = prState.approvalChains[targetChainIndex];

    // Out-of-order: team's index is ahead of the active index
    if (teamIndex > chain.activeIndex) {
      return {
        updatedState: prState,
        teamsToActivate: [],
        teamsToDeactivate: [],
        rejected: true,
        rejectionReason: `Team "${team}" cannot approve yet. Waiting for "${chain.orderedTeams[chain.activeIndex]}" to approve first (chain: ${chain.chainId}).`,
      };
    }

    // Already approved (idempotent): team's index is behind the active index
    if (teamIndex < chain.activeIndex) {
      return {
        updatedState: prState,
        teamsToActivate: [],
        teamsToDeactivate: [],
        rejected: false,
      };
    }

    // Valid approval: team's index === activeIndex
    const updatedChain = {
      ...chain,
      completedTeams: [...chain.completedTeams, team],
      activeIndex: chain.activeIndex + 1,
      complete: chain.activeIndex + 1 >= chain.orderedTeams.length,
    };

    const updatedChains = [...prState.approvalChains];
    updatedChains[targetChainIndex] = updatedChain;

    const updatedState: PRState = {
      ...prState,
      approvalChains: updatedChains,
    };

    // Determine teams to activate (next team in chain, if chain is not complete)
    const teamsToActivate: string[] = [];
    if (!updatedChain.complete) {
      teamsToActivate.push(updatedChain.orderedTeams[updatedChain.activeIndex]);
    }

    return {
      updatedState,
      teamsToActivate,
      teamsToDeactivate: [],
      rejected: false,
    };
  }

  /**
   * Revoke an approval from a team.
   * Finds the chain containing the team and cascades deactivation to all subsequent teams.
   *
   * - If the team is not in any chain: return rejected: false with no changes
   * - If the team IS in a chain:
   *   - All teams at indices > revoking team's index are deactivated
   *   - completedTeams is trimmed to exclude deactivated teams
   *   - activeIndex resets to the revoking team's index (needs re-approval)
   *   - Chain is marked incomplete
   *   - Returns teamsToDeactivate: teams at indices > revoking team that were previously active/completed
   */
  revokeApproval(team: string, prState: PRState): ChainTransitionResult {
    // Find the chain containing this team
    let targetChainIndex = -1;
    let teamIndex = -1;

    for (let i = 0; i < prState.approvalChains.length; i++) {
      const chain = prState.approvalChains[i];
      const idx = chain.orderedTeams.indexOf(team);
      if (idx !== -1) {
        targetChainIndex = i;
        teamIndex = idx;
        break;
      }
    }

    // Team is not in any chain — no action needed
    if (targetChainIndex === -1) {
      return {
        updatedState: prState,
        teamsToActivate: [],
        teamsToDeactivate: [],
        rejected: false,
      };
    }

    const chain = prState.approvalChains[targetChainIndex];

    // Determine which teams to deactivate: all teams at indices > revoking team's index
    // that were previously active (at activeIndex) or completed
    const teamsToDeactivate: string[] = [];
    for (let i = teamIndex + 1; i < chain.orderedTeams.length; i++) {
      const subsequentTeam = chain.orderedTeams[i];
      // Team was completed or was the currently active team
      if (chain.completedTeams.includes(subsequentTeam) || i === chain.activeIndex) {
        teamsToDeactivate.push(subsequentTeam);
      }
    }

    // Trim completedTeams to only include teams at indices <= revoking team's index
    // The revoking team itself also needs to re-approve, so remove it too
    const allowedTeams = new Set(chain.orderedTeams.slice(0, teamIndex));
    const updatedCompletedTeams = chain.completedTeams.filter((t) => allowedTeams.has(t));

    const updatedChain = {
      ...chain,
      activeIndex: teamIndex,
      completedTeams: updatedCompletedTeams,
      complete: false,
    };

    const updatedChains = [...prState.approvalChains];
    updatedChains[targetChainIndex] = updatedChain;

    const updatedState: PRState = {
      ...prState,
      approvalChains: updatedChains,
    };

    return {
      updatedState,
      teamsToActivate: [],
      teamsToDeactivate,
      rejected: false,
    };
  }
}
