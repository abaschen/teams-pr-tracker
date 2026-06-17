/**
 * Mention Manager - manages @mention lifecycle in Teams thread messages.
 * Handles adding/removing team mentions based on approval state changes.
 */

import type { ValidationTeamConfig } from '../models/rules.js';

/** Bot Framework mention entity for the entities array in activity payloads */
export interface MentionEntity {
  type: 'mention';
  text: string;
  mentioned: {
    id: string;
    name: string;
  };
}

/** Retry configuration for mention edit operations */
export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  backoffMultiplier: 2,
};

/**
 * MentionManager handles the computation, formatting, and lifecycle
 * of @mentions in Teams thread messages based on approval state.
 */
export class MentionManager {
  private readonly retryConfig: RetryConfig;

  constructor(retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG) {
    this.retryConfig = retryConfig;
  }

  /**
   * Compute which teams should currently be mentioned.
   * Returns the set difference: requiredTeams - approvedTeams.
   *
   * - On thread creation: all required teams are mentioned (approvedTeams is empty)
   * - On approval: the approved team is removed from mentions
   * - On revocation: the team is re-added to mentions (no longer in approvedTeams)
   * - On all approved: returns empty array
   */
  computeMentions(requiredTeams: string[], approvedTeams: string[]): string[] {
    const approvedSet = new Set(approvedTeams);
    return requiredTeams.filter((team) => !approvedSet.has(team));
  }

  /**
   * Build the Teams message text with @mentions using the `<at>` tag format.
   * Each pending team gets an `<at>teamName</at>` tag.
   */
  buildMentionText(pendingTeams: ValidationTeamConfig[]): string {
    if (pendingTeams.length === 0) {
      return '';
    }

    const mentions = pendingTeams.map((team) => `<at>${team.teamName}</at>`);
    return `Pending approvals: ${mentions.join(', ')}`;
  }

  /**
   * Determine if an update is needed by comparing current and new mention sets.
   * Returns true if the sets differ (regardless of order).
   */
  shouldUpdateMentions(currentMentions: string[], newMentions: string[]): boolean {
    if (currentMentions.length !== newMentions.length) {
      return true;
    }

    const currentSet = new Set(currentMentions);
    return newMentions.some((mention) => !currentSet.has(mention));
  }

  /**
   * Build mention entity objects for the Bot Framework API.
   * Each mentioned team requires an entity in the activity's entities array
   * with type "mention", the display text, and the mentioned object.
   */
  buildMentionEntities(pendingTeams: ValidationTeamConfig[]): MentionEntity[] {
    return pendingTeams.map((team) => ({
      type: 'mention' as const,
      text: `<at>${team.teamName}</at>`,
      mentioned: {
        id: team.teamsTagId,
        name: team.teamName,
      },
    }));
  }

  /**
   * Execute an operation with retry on failure using exponential backoff.
   * Used for Teams message edit operations that may fail transiently.
   */
  async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.retryConfig.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.retryConfig.maxAttempts - 1) {
          const delay =
            this.retryConfig.baseDelayMs * Math.pow(this.retryConfig.backoffMultiplier, attempt);
          await this.sleep(delay);
        }
      }
    }

    throw lastError!;
  }

  /** Sleep for a given number of milliseconds */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
