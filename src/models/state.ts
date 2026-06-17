/**
 * State persistence types for DynamoDB single-table design.
 * Includes PR state tracking, approval chain progress, and thread references.
 */

import type { ApprovalChainConfig } from './rules.js';

/** Thread reference for Microsoft Teams proactive messaging */
export interface ThreadReference {
  conversationId: string;
  activityId: string; // root message ID for reactions and edits
  channelId: string;
  serviceUrl: string;
}

/** State of a single approval chain within a PR */
export interface ApprovalChainState {
  chainId: string;
  orderedTeams: string[];
  activeIndex: number; // Index of the currently active team
  completedTeams: string[]; // Teams that have approved in order
  complete: boolean;
}

/** PR status values */
export type PRStatus = 'open' | 'closed' | 'merged';

/**
 * DynamoDB PR State Item.
 * PK: PR#{provider}#{repo}#{prNumber}
 * SK: STATE
 */
export interface PRStateItem {
  PK: string;
  SK: string;
  version: number; // Optimistic locking version
  provider: string;
  repositoryFullName: string;
  prNumber: string;
  prTitle: string;
  prUrl: string;
  author: string;
  branch: string;
  status: PRStatus;

  // Approval tracking
  requiredTeams: string[];
  approvedTeams: string[];

  // Approval chain state
  approvalChains: ApprovalChainState[];

  // Teams thread reference
  threadRef: ThreadReference;

  // Metadata
  createdAt: string;
  updatedAt: string;
  ttl: number; // Auto-cleanup 90 days after close
}

/**
 * Alias for PRStateItem used in domain logic.
 * Represents the full mutable PR state during processing.
 */
export type PRState = PRStateItem;

/** Final status posted when a PR is merged or closed */
export interface FinalStatus {
  outcome: 'merged' | 'closed';
  actor: string;
  approvedTeams: string[];
  pendingTeams: string[];
  timestamp: string;
}

/** Update message posted to an existing Teams thread */
export interface ThreadUpdate {
  eventType: string;
  actor: string;
  summary: string;
  timestamp: string;
}
