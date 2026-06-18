/**
 * Thread Manager implementation.
 * Manages Microsoft Teams thread lifecycle using Bot Framework REST API
 * for proactive messaging. Authenticates via Microsoft login endpoint
 * and uses stored conversation references to create/update threads.
 *
 * Implements retry with exponential backoff (3 attempts, 1s base, 2x multiplier)
 * on all Teams API calls.
 */

import type { NormalizedPREvent } from '../models/events.js';
import type { ThreadReference, ThreadUpdate, FinalStatus } from '../models/state.js';
import type { ValidationTeamConfig } from '../models/rules.js';
import type { ThreadManager } from '../models/interfaces.js';

/** Configuration for the ThreadManager */
export interface ThreadManagerConfig {
  /** Microsoft App ID (Bot ID) */
  botId: string;
  /** Microsoft App Password (Bot secret) */
  botPassword: string;
  /** Teams channel ID to post threads to */
  channelId: string;
  /** Bot Framework service URL */
  serviceUrl?: string;
  /** Override fetch implementation (useful for testing) */
  fetchFn?: typeof globalThis.fetch;
  /** Microsoft login token endpoint override (useful for testing) */
  tokenEndpoint?: string;
}

/** Bot Framework authentication token response */
interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

/** Bot Framework conversation creation response */
interface CreateConversationResponse {
  id: string;
  activityId: string;
}

/** Retry configuration */
interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  backoffMultiplier: number;
}

/** Default retry configuration: 3 attempts, 1s base, 2x multiplier */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  backoffMultiplier: 2,
};

/** Default Bot Framework service URL */
const DEFAULT_SERVICE_URL = 'https://smba.trafficmanager.net/teams';

/** Microsoft login token endpoint for Bot Framework */
const DEFAULT_TOKEN_ENDPOINT =
  'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token';

/** Bot Framework OAuth scope */
const BOT_FRAMEWORK_SCOPE = 'https://api.botframework.com/.default';

/**
 * Implements the ThreadManager interface using Bot Framework REST API.
 * Creates, updates, and closes Microsoft Teams threads for PR tracking.
 */
export class TeamsThreadManager implements ThreadManager {
  private readonly botId: string;
  private readonly botPassword: string;
  private readonly channelId: string;
  private readonly serviceUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly tokenEndpoint: string;
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(config: ThreadManagerConfig) {
    this.botId = config.botId;
    this.botPassword = config.botPassword;
    this.channelId = config.channelId;
    this.serviceUrl = config.serviceUrl ?? DEFAULT_SERVICE_URL;
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
    this.tokenEndpoint = config.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT;
  }

  /**
   * Creates a new Teams thread with PR metadata and team statuses.
   * Posts an initial message containing PR title, author, repository,
   * branch, PR link, and required teams with pending approval status.
   */
  async createThread(
    pr: NormalizedPREvent,
    teams: ValidationTeamConfig[],
  ): Promise<ThreadReference> {
    const token = await this.getToken();
    const message = this.composeCreateMessage(pr, teams);

    const response = await this.withRetry(async () => {
      const url = `${this.serviceUrl}/v3/conversations`;
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bot: { id: this.botId, name: 'PR Tracker Bot' },
          isGroup: true,
          channelData: { channel: { id: this.channelId } },
          activity: {
            type: 'message',
            text: message,
          },
        }),
      });

      if (!res.ok) {
        throw new Error(`Teams API error: ${res.status} ${res.statusText}`);
      }

      return (await res.json()) as CreateConversationResponse;
    });

    return {
      conversationId: response.id,
      activityId: response.activityId,
      channelId: this.channelId,
      serviceUrl: this.serviceUrl,
    };
  }

  /**
   * Posts an event update to an existing Teams thread.
   * Includes event type, actor name, and summary.
   */
  async postUpdate(threadRef: ThreadReference, update: ThreadUpdate): Promise<void> {
    const token = await this.getToken();
    const message = this.composeUpdateMessage(update);

    await this.withRetry(async () => {
      const url = `${threadRef.serviceUrl}/v3/conversations/${threadRef.conversationId}/activities`;
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'message',
          text: message,
          replyToId: threadRef.activityId,
        }),
      });

      if (!res.ok) {
        throw new Error(`Teams API error: ${res.status} ${res.statusText}`);
      }
    });
  }

  /**
   * Updates the original thread message to reflect current approval status.
   * Edits the root message in-place to show which teams have approved.
   */
  async updateThreadStatus(
    threadRef: ThreadReference,
    pr: { prTitle: string; author: string; repositoryFullName: string; branch: string; prUrl: string },
    requiredTeams: string[],
    approvedTeams: string[],
  ): Promise<void> {
    const token = await this.getToken();

    const teamLines = requiredTeams.map((t) =>
      approvedTeams.includes(t) ? `✅ ~~${t}~~` : `⏳ ${t}`
    );

    const approvedCount = approvedTeams.length;
    const totalCount = requiredTeams.length;
    const allApproved = approvedCount === totalCount && totalCount > 0;
    const header = allApproved
      ? `🟢 **Ready to merge** (${approvedCount}/${totalCount})`
      : `**Required approvals (${approvedCount}/${totalCount}):**`;

    const message = [
      `📋 **${pr.prTitle}**`,
      '',
      `Author: ${pr.author}`,
      `Repo: ${pr.repositoryFullName}`,
      `Branch: \`${pr.branch}\``,
      `Link: ${pr.prUrl}`,
      '',
      header,
      '',
      ...teamLines,
    ].join('\n');

    await this.withRetry(async () => {
      const url = `${threadRef.serviceUrl}/v3/conversations/${threadRef.conversationId}/activities/${threadRef.activityId}`;
      const res = await this.fetchFn(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'message',
          text: message,
        }),
      });

      if (!res.ok) {
        throw new Error(`Teams API error updating thread: ${res.status} ${res.statusText}`);
      }
    });
  }

  /**
   * Updates team mentions in the thread (posts pending teams as @mentions).
   */
  async updateMentions(
    _threadRef: ThreadReference,
    _pendingTeams: string[],
    _approvedTeams: string[],
  ): Promise<void> {
    // No-op: mention updates are handled via updateThreadStatus
  }

  /**
   * Updates merge readiness reaction.
   */
  async updateReadinessReaction(
    _threadRef: ThreadReference,
    _isReady: boolean,
  ): Promise<void> {
    // No-op: readiness is shown inline in updateThreadStatus
  }

  /**
   * Posts a final status message to the thread when a PR is merged or closed.
   * Includes outcome, actor, and final approval state.
   */
  async closeThread(threadRef: ThreadReference, finalStatus: FinalStatus): Promise<void> {
    const token = await this.getToken();
    const message = this.composeCloseMessage(finalStatus);

    await this.withRetry(async () => {
      const url = `${threadRef.serviceUrl}/v3/conversations/${threadRef.conversationId}/activities`;
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'message',
          text: message,
          replyToId: threadRef.activityId,
        }),
      });

      if (!res.ok) {
        throw new Error(`Teams API error: ${res.status} ${res.statusText}`);
      }
    });
  }

  /**
   * Composes the initial thread message with PR metadata and team statuses.
   */
  composeCreateMessage(pr: NormalizedPREvent, teams: ValidationTeamConfig[]): string {
    const teamLines = teams.map((t) => `⏳ ${t.teamName}`);

    return [
      `📋 **${pr.prTitle}**`,
      '',
      `Author: ${pr.author}`,
      `Repo: ${pr.repositoryFullName}`,
      `Branch: \`${pr.branch}\` → \`${pr.baseBranch}\``,
      `Link: ${pr.prUrl}`,
      '',
      `**Required approvals (0/${teams.length}):**`,
      '',
      ...teamLines,
    ].join('\n');
  }

  /**
   * Composes an update message showing team, user, and action — no @mentions.
   */
  composeUpdateMessage(update: ThreadUpdate): string {
    const icon = update.summary.includes('approved') ? '✅'
      : update.summary.includes('changes_requested') ? '🔄'
      : '💬';
    return `${icon} **${update.actor}** — ${update.summary}`;
  }

  /**
   * Composes a final status message for PR merge/close.
   */
  composeCloseMessage(finalStatus: FinalStatus): string {
    const icon = finalStatus.outcome === 'merged' ? '✅' : '❌';
    const outcomeLabel = finalStatus.outcome === 'merged' ? 'Merged' : 'Closed';

    const approved =
      finalStatus.approvedTeams.length > 0
        ? finalStatus.approvedTeams.join(', ')
        : 'None';
    const pending =
      finalStatus.pendingTeams.length > 0
        ? finalStatus.pendingTeams.join(', ')
        : 'None';

    return [
      `${icon} **PR ${outcomeLabel}** by ${finalStatus.actor}`,
      '',
      `**Approved:** ${approved}`,
      `**Pending:** ${pending}`,
    ].join('\n');
  }

  /**
   * Acquires a Bot Framework authentication token.
   * Caches the token and refreshes it when expired.
   */
  async getToken(): Promise<string> {
    // Return cached token if still valid (with 5 minute buffer)
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 5 * 60 * 1000) {
      return this.cachedToken.token;
    }

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.botId,
      client_secret: this.botPassword,
      scope: BOT_FRAMEWORK_SCOPE,
    });

    const response = await this.fetchFn(this.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to acquire Bot Framework token: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as TokenResponse;

    this.cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    return this.cachedToken.token;
  }

  /**
   * Executes an operation with retry and exponential backoff.
   * 3 attempts, 1s base delay, 2x multiplier.
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    config: RetryConfig = DEFAULT_RETRY_CONFIG,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        if (attempt < config.maxAttempts - 1) {
          const delay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt);
          await this.sleep(delay);
        }
      }
    }

    throw lastError!;
  }

  /**
   * Sleeps for the specified duration. Extracted for testability.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
