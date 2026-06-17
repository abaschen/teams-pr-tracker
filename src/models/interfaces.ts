/**
 * Component interfaces defining the contracts between system components.
 * Each interface corresponds to a major architectural component in the system.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from './api-gateway.js';
import type { Provider, NormalizedPREvent } from './events.js';
import type { AnnotationRule, ApprovalChainConfig, RuleEvaluationResult, ValidationTeamConfig } from './rules.js';
import type { PRState, ThreadReference, ThreadUpdate, FinalStatus } from './state.js';

/** Reference to a specific PR on a source control provider */
export interface PRReference {
  provider: Provider;
  owner: string;
  repo: string;
  prNumber: string;
}

/** Result of processing an approval or revocation through the approval chain */
export interface ChainTransitionResult {
  updatedState: PRState;
  teamsToActivate: string[];
  teamsToDeactivate: string[];
  rejected: boolean;
  rejectionReason?: string;
}

/**
 * Webhook Processor - Lambda entry point.
 * Receives, authenticates, and routes incoming webhook events.
 */
export interface WebhookProcessor {
  handleRequest(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult>;
}

/**
 * Signature Verifier - validates webhook authenticity.
 * Each provider uses a different signature scheme.
 */
export interface SignatureVerifier {
  verify(provider: Provider, payload: string, signature: string, secret: string): boolean;
}

/**
 * Event Normalizer - transforms provider payloads to unified format.
 * One implementation per supported provider.
 */
export interface EventNormalizer {
  normalize(provider: Provider, rawPayload: unknown): NormalizedPREvent | null;
}

/**
 * Rule Engine - evaluates annotation rules against PR metadata.
 * Determines which validation teams are required for a PR.
 */
export interface RuleEngine {
  evaluate(event: NormalizedPREvent, rules: AnnotationRule[]): RuleEvaluationResult;
}

/**
 * Approval Chain Manager - manages sequential approval ordering.
 * Enforces that teams approve in the configured order.
 */
export interface ApprovalChainManager {
  initializeChain(chain: ApprovalChainConfig, prState: PRState): PRState;
  processApproval(team: string, prState: PRState): ChainTransitionResult;
  revokeApproval(team: string, prState: PRState): ChainTransitionResult;
  getActiveTeams(prState: PRState): string[];
}

/**
 * Thread Manager - manages Microsoft Teams thread lifecycle.
 * Uses Bot Framework proactive messaging.
 */
export interface ThreadManager {
  createThread(pr: NormalizedPREvent, teams: ValidationTeamConfig[]): Promise<ThreadReference>;
  postUpdate(threadRef: ThreadReference, update: ThreadUpdate): Promise<void>;
  updateMentions(threadRef: ThreadReference, pendingTeams: string[], approvedTeams: string[]): Promise<void>;
  updateReadinessReaction(threadRef: ThreadReference, isReady: boolean): Promise<void>;
  closeThread(threadRef: ThreadReference, finalStatus: FinalStatus): Promise<void>;
}

/**
 * Provider Adapter - abstracts provider-specific API operations.
 * One implementation per supported source control provider.
 */
export interface ProviderAdapter {
  addLabels(pr: PRReference, labels: string[]): Promise<void>;
  removeLabels(pr: PRReference, labels: string[]): Promise<void>;
  assignReviewers(pr: PRReference, reviewers: string[]): Promise<void>;
  unassignReviewers(pr: PRReference, reviewers: string[]): Promise<void>;
  addComment(pr: PRReference, body: string): Promise<void>;
  updateDescription(pr: PRReference, appendText: string): Promise<boolean>; // returns false if not supported
  getChangedFiles(pr: PRReference): Promise<string[]>;
}
