/**
 * Readiness Manager - manages merge readiness indicator state.
 * Determines if a PR is ready to merge based on team approvals and chain completion.
 * Provides human-readable status messages for Teams thread updates.
 */

import type { PRState } from '../models/state.js';

/** Represents the computed merge readiness state of a PR */
export interface MergeReadinessState {
  isReady: boolean;
  approvedTeams: string[];
  pendingTeams: string[];
  allChainsComplete: boolean;
}

export class ReadinessManager {
  /**
   * Compute the merge readiness state from the current PR state.
   *
   * A PR is ready to merge if and only if:
   * 1. All requiredTeams are in approvedTeams (set intersection = requiredTeams)
   * 2. AND all approvalChains have `complete: true`
   *
   * If there are no requiredTeams, the PR is vacuously ready (provided all chains are complete).
   */
  computeReadiness(prState: PRState): MergeReadinessState {
    const approvedSet = new Set(prState.approvedTeams);
    const approvedTeams: string[] = [];
    const pendingTeams: string[] = [];

    for (const team of prState.requiredTeams) {
      if (approvedSet.has(team)) {
        approvedTeams.push(team);
      } else {
        pendingTeams.push(team);
      }
    }

    const allChainsComplete =
      prState.approvalChains.length === 0 ||
      prState.approvalChains.every((chain) => chain.complete);

    const allTeamsApproved = pendingTeams.length === 0;
    const isReady = allTeamsApproved && allChainsComplete;

    return {
      isReady,
      approvedTeams,
      pendingTeams,
      allChainsComplete,
    };
  }

  /**
   * Determine if the readiness state has changed between two evaluations.
   */
  hasReadinessChanged(previousReady: boolean, currentReady: boolean): boolean {
    return previousReady !== currentReady;
  }

  /**
   * Build a human-readable status message for the Teams thread.
   *
   * Ready: "✅ PR is ready to merge! All teams approved: [list]"
   * Not ready: "❌ PR is not ready. Approved: [list]. Pending: [list]"
   */
  buildReadinessMessage(state: MergeReadinessState): string {
    if (state.isReady) {
      const teamsList = state.approvedTeams.length > 0 ? state.approvedTeams.join(', ') : 'none';
      return `✅ PR is ready to merge! All teams approved: ${teamsList}`;
    }

    const approvedList = state.approvedTeams.length > 0 ? state.approvedTeams.join(', ') : 'none';
    const pendingList = state.pendingTeams.length > 0 ? state.pendingTeams.join(', ') : 'none';
    return `❌ PR is not ready. Approved: ${approvedList}. Pending: ${pendingList}`;
  }
}
