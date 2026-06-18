/**
 * Lambda Handler Entry Point.
 *
 * Re-exports the webhook processor as the default Lambda handler and provides
 * a `processEvent` function that orchestrates the full pipeline:
 *   verify → normalize → load state → evaluate rules → process chain →
 *   side effects (provider, Teams) → persist state
 *
 * Handles missing credentials gracefully by skipping provider operations,
 * logging the issue, and posting a warning to the default channel.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from '../models/api-gateway.js';
import type { NormalizedPREvent } from '../models/events.js';
import type { PRState, PRStateItem } from '../models/state.js';
import type { PRReference } from '../models/interfaces.js';

import { handler } from './webhook-processor.js';

// Engines
import { DefaultRuleEngine } from '../engines/rule-engine.js';
import { computeTeamDiff } from '../engines/team-diff.js';

// Managers
import { ApprovalChainManagerImpl } from '../managers/approval-chain-manager.js';
import { TeamsThreadManager } from '../managers/thread-manager.js';
import { MentionManager } from '../managers/mention-manager.js';
import { ReadinessManager } from '../managers/readiness-manager.js';
import { DefaultCredentialManager } from '../managers/credential-manager.js';
import { CircuitBreaker } from '../managers/circuit-breaker.js';
import { ChannelMapper } from '../managers/channel-mapper.js';

// Repositories
import { loadPRState, savePRState, savePRStateWithRetry } from '../repositories/pr-state-repository.js';
import { loadAllRules } from '../repositories/rule-repository.js';

// Adapters
import { getAdapter } from '../adapters/adapter-factory.js';

// Utils
import { resilientProviderCall, resilientTeamsCall } from '../utils/resilient-operations.js';
import { CredentialNotFoundError } from '../utils/errors.js';

// ──────────────────────────────────────────────────────────────────────────────
// Re-export the webhook handler as the Lambda entry point
// ──────────────────────────────────────────────────────────────────────────────

export { handler };

// ──────────────────────────────────────────────────────────────────────────────
// Dependency instantiation
// ──────────────────────────────────────────────────────────────────────────────

const ruleEngine = new DefaultRuleEngine();
const approvalChainManager = new ApprovalChainManagerImpl();
const mentionManager = new MentionManager();
const readinessManager = new ReadinessManager();
const credentialManager = new DefaultCredentialManager();
const channelMapper = new ChannelMapper();

// ──────────────────────────────────────────────────────────────────────────────
// Pipeline helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Builds a PRReference from a normalized event */
function buildPRReference(event: NormalizedPREvent): PRReference {
  const parts = event.repositoryFullName.split('/');
  return {
    provider: event.provider,
    owner: parts[0] ?? '',
    repo: parts.slice(1).join('/') || (parts[0] ?? ''),
    prNumber: event.prId,
  };
}

/** Creates a fresh PRState for a newly opened PR */
function createInitialState(event: NormalizedPREvent): PRStateItem {
  const now = new Date().toISOString();
  const key = `PR#${event.provider}#${event.repositoryFullName}#${event.prId}`;
  return {
    PK: key,
    SK: 'STATE',
    version: 0,
    provider: event.provider,
    repositoryFullName: event.repositoryFullName,
    prNumber: event.prId,
    prTitle: event.prTitle,
    prUrl: event.prUrl,
    author: event.author,
    branch: event.branch,
    status: 'open',
    urgent: event.urgent,
    requiredTeams: [],
    approvedTeams: [],
    approvalChains: [],
    threadRef: { conversationId: '', activityId: '', channelId: '', serviceUrl: '' },
    createdAt: now,
    updatedAt: now,
    ttl: 0,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Full pipeline orchestration
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Processes a normalized PR event through the full pipeline.
 *
 * Pipeline steps:
 * 1. Load state (create new if not exists)
 * 2. Load rules from rule repository
 * 3. Evaluate rules to get required teams
 * 4. Initialize approval chains (for pr_opened)
 * 5. Create/update Teams thread (non-fatal if fails)
 * 6. Assign reviewers via provider adapter (non-fatal if fails)
 * 7. Add labels via provider adapter (non-fatal if fails)
 * 8. Persist state
 *
 * Missing credentials are handled gracefully: skip provider operations,
 * log the issue, and post a warning to the default channel.
 */
export async function processEvent(event: NormalizedPREvent): Promise<void> {
  const { provider, repositoryFullName, prId, eventType } = event;

  // ── Step 1: Load or create state ──────────────────────────────────────────
  let state = await loadPRState(provider, repositoryFullName, prId);
  const isNew = state === null;
  if (!state) {
    state = createInitialState(event);
  }

  // ── Step 2: Load rules ────────────────────────────────────────────────────
  const rules = await loadAllRules();

  // ── Step 3: Evaluate rules ────────────────────────────────────────────────
  const evaluationResult = ruleEngine.evaluate(event, rules);
  const requiredTeamNames = evaluationResult.requiredTeams.map((t) => t.teamName);

  // ── Step 4: Compute team diff and update state ────────────────────────────
  if (eventType === 'pr_opened' || eventType === 'pr_updated') {
    const oldTeams = state.requiredTeams;
    const diff = computeTeamDiff(oldTeams, requiredTeamNames);
    state = { ...state, requiredTeams: requiredTeamNames };

    // Initialize approval chains for new PRs
    if (isNew) {
      for (const chainConfig of evaluationResult.approvalChains) {
        state = approvalChainManager.initializeChain(chainConfig, state);
      }
    }
  }

  // ── Step 5: Handle review submissions ─────────────────────────────────────
  if (eventType === 'review_submitted' && event.reviewerAction) {
    const { reviewer, action } = event.reviewerAction;

    if (action === 'approved') {
      // Find which team this reviewer belongs to
      const reviewerTeam = evaluationResult.requiredTeams.find(
        (t) => t.reviewers.includes(reviewer),
      );
      if (reviewerTeam) {
        const chainResult = approvalChainManager.processApproval(reviewerTeam.teamName, state);
        state = chainResult.updatedState;

        if (!chainResult.rejected && !state.approvedTeams.includes(reviewerTeam.teamName)) {
          state = { ...state, approvedTeams: [...state.approvedTeams, reviewerTeam.teamName] };
        }
      }
    } else if (action === 'changes_requested') {
      const reviewerTeam = evaluationResult.requiredTeams.find(
        (t) => t.reviewers.includes(reviewer),
      );
      if (reviewerTeam) {
        const chainResult = approvalChainManager.revokeApproval(reviewerTeam.teamName, state);
        state = chainResult.updatedState;
        state = {
          ...state,
          approvedTeams: state.approvedTeams.filter((t) => t !== reviewerTeam.teamName),
        };
      }
    }
  }

  // ── Step 6: Resolve credentials (handle missing gracefully) ───────────────
  let hasCredentials = true;
  let credentialError: CredentialNotFoundError | null = null;

  // Check circuit breaker before attempting credential load
  const circuitBreaker = new CircuitBreaker(provider, repositoryFullName);
  await circuitBreaker.loadFromRepository();

  if (!circuitBreaker.shouldAllowRequest()) {
    console.warn(
      `[processEvent] Circuit open for ${provider}/${repositoryFullName}, skipping provider ops`,
    );
    hasCredentials = false;
  } else {
    try {
      await credentialManager.getCredentials(provider, repositoryFullName);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'CredentialNotFoundError' ||
         error.message.includes('No credentials found') ||
         error.message.includes('Invalid credential') ||
         error.name === 'AccessDeniedException' ||
         error.message.includes('is not authorized'))
      ) {
        credentialError = new CredentialNotFoundError(
          error.message,
          provider,
          repositoryFullName,
        );
        hasCredentials = false;
        console.warn(
          `[processEvent] Missing credentials for ${provider}/${repositoryFullName}: ${error.message}`,
        );
      } else {
        throw error;
      }
    }
  }

  // ── Step 7: Teams thread operations (non-fatal) ───────────────────────────
  const resolvedChannel = await channelMapper.resolveChannel(repositoryFullName);

  // Detect urgent flag from labels
  const isUrgent = (event.labels ?? []).some((label) =>
    resolvedChannel.urgentLabels.some((u) => label.toLowerCase() === u.toLowerCase()),
  );

  if (eventType === 'pr_opened' && isNew) {
    const tenantId = process.env.TEAMS_TENANT_ID ?? '';
    const threadManager = new TeamsThreadManager({
      botId: process.env.TEAMS_BOT_ID ?? '',
      botPassword: process.env.TEAMS_BOT_PASSWORD ?? '',
      channelId: resolvedChannel.channelId,
      serviceUrl: resolvedChannel.serviceUrl,
      tokenEndpoint: tenantId
        ? `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
        : undefined,
      templates: resolvedChannel.templates,
    });

    // Tag the event as urgent for template rendering
    if (isUrgent) {
      event.urgent = true;
    }

    const threadRef = await resilientTeamsCall(
      () => threadManager.createThread(event, evaluationResult.requiredTeams),
      { operation: 'createThread' },
    );

    if (threadRef) {
      state = { ...state, threadRef };
    }

    // Post credential warning to default channel if credentials are missing
    if (credentialError) {
      await resilientTeamsCall(
        () =>
          threadManager.postUpdate(state!.threadRef, {
            eventType: 'warning',
            actor: 'system',
            summary: `⚠️ Missing credentials for ${provider}/${repositoryFullName}. Provider operations (labels, reviewers) will be skipped.`,
            timestamp: new Date().toISOString(),
          }),
        { operation: 'postCredentialWarning' },
      );
    }
  } else if (eventType === 'review_submitted' && state.threadRef.conversationId) {
    const tenantId = process.env.TEAMS_TENANT_ID ?? '';
    const threadManager = new TeamsThreadManager({
      botId: process.env.TEAMS_BOT_ID ?? '',
      botPassword: process.env.TEAMS_BOT_PASSWORD ?? '',
      channelId: state.threadRef.channelId,
      serviceUrl: state.threadRef.serviceUrl,
      tokenEndpoint: tenantId
        ? `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
        : undefined,
      templates: resolvedChannel.templates,
    });

    // Post review update
    await resilientTeamsCall(
      () =>
        threadManager.postUpdate(state!.threadRef, {
          eventType: event.eventType,
          actor: event.reviewerAction?.reviewer ?? event.author,
          summary: `${event.reviewerAction?.action ?? 'unknown'}`,
          timestamp: event.timestamp,
        }),
      { operation: 'postReviewUpdate' },
    );

    // Update the original thread message with current approval status
    await resilientTeamsCall(
      () =>
        threadManager.updateThreadStatus(state!.threadRef, {
          prTitle: state!.prTitle,
          author: state!.author,
          repositoryFullName: state!.repositoryFullName,
          branch: state!.branch,
          prUrl: state!.prUrl,
          urgent: state!.urgent,
        }, state!.requiredTeams, state!.approvedTeams,
        resolvedChannel.maintainersTagId ? { tagId: resolvedChannel.maintainersTagId, tagName: resolvedChannel.maintainersTagName ?? 'Maintainers' } : undefined),
      { operation: 'updateThreadStatus' },
    );

    // Update mentions
    const pendingTeams = mentionManager.computeMentions(state.requiredTeams, state.approvedTeams);
    await resilientTeamsCall(
      () =>
        threadManager.updateMentions(state!.threadRef, pendingTeams, state!.approvedTeams),
      { operation: 'updateMentions' },
    );

    // Update readiness
    const readiness = readinessManager.computeReadiness(state);
    await resilientTeamsCall(
      () =>
        threadManager.updateReadinessReaction(state!.threadRef, readiness.isReady),
      { operation: 'updateReadinessReaction' },
    );
  }

  // ── Step 8: Provider operations (non-fatal, skip if no credentials) ───────
  if (hasCredentials && (eventType === 'pr_opened' || eventType === 'pr_updated')) {
    const credentials = await credentialManager.getCredentials(provider, repositoryFullName);
    const adapter = getAdapter(provider, credentials.accessToken);
    const prRef = buildPRReference(event);

    // Assign reviewers for required teams
    const reviewersToAssign = evaluationResult.requiredTeams.flatMap((t) => t.reviewers);
    if (reviewersToAssign.length > 0) {
      await resilientProviderCall(
        () => adapter.assignReviewers(prRef, reviewersToAssign),
        { provider, operation: 'assignReviewers' },
      );
    }

    // Add labels for required teams
    const labelsToAdd = evaluationResult.requiredTeams.map((t) => t.teamName);
    if (labelsToAdd.length > 0) {
      await resilientProviderCall(
        () => adapter.addLabels(prRef, labelsToAdd),
        { provider, operation: 'addLabels' },
      );
    }
  }

  // ── Step 8b: Handle PR merged/closed — mark thread as done ────────────────
  if ((eventType === 'pr_merged' || eventType === 'pr_closed') && state.threadRef.conversationId) {
    const tenantId = process.env.TEAMS_TENANT_ID ?? '';
    const threadManager = new TeamsThreadManager({
      botId: process.env.TEAMS_BOT_ID ?? '',
      botPassword: process.env.TEAMS_BOT_PASSWORD ?? '',
      channelId: state.threadRef.channelId,
      serviceUrl: state.threadRef.serviceUrl,
      tokenEndpoint: tenantId
        ? `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
        : undefined,
      templates: resolvedChannel.templates,
    });

    const outcome = eventType === 'pr_merged' ? 'merged' : 'closed';
    state = { ...state, status: outcome };

    // Edit the root message to show strikethrough title + final status
    await resilientTeamsCall(
      () =>
        threadManager.markThreadClosed(state!.threadRef, {
          prTitle: state!.prTitle,
          author: state!.author,
          repositoryFullName: state!.repositoryFullName,
          branch: state!.branch,
          prUrl: state!.prUrl,
        }, outcome, state!.approvedTeams, state!.requiredTeams),
      { operation: 'markThreadClosed' },
    );
  }

  // ── Step 9: Persist state ─────────────────────────────────────────────────
  await savePRStateWithRetry(state, (currentState) => {
    // On conflict, merge our changes with the current state
    return {
      ...currentState,
      requiredTeams: state!.requiredTeams,
      approvedTeams: state!.approvedTeams,
      approvalChains: state!.approvalChains,
      threadRef: state!.threadRef.conversationId ? state!.threadRef : currentState.threadRef,
      status: state!.status,
    };
  });
}
