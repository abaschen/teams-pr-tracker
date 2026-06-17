/**
 * GitLab webhook event normalizer.
 * Transforms GitLab-specific webhook payloads into the provider-agnostic NormalizedPREvent format.
 *
 * GitLab uses object_kind + object_attributes.action to identify webhook event types:
 * - merge_request: open, update, close, merge
 * - note (with merge_request context): comment_added
 * - pipeline: ci_status_changed
 */

import type { GitLabRawEvent, NormalizedPREvent, PREventType } from '../models/events.js';

/**
 * Maps GitLab webhook object_kind + action to a PREventType.
 * Returns null for unrecognized events.
 */
function resolveEventType(payload: GitLabRawEvent): PREventType | null {
  const objectKind = payload.object_kind;

  if (objectKind === 'merge_request') {
    const action = payload.object_attributes?.action;
    switch (action) {
      case 'open':
        return 'pr_opened';
      case 'update':
        return 'pr_updated';
      case 'close':
        return 'pr_closed';
      case 'merge':
        return 'pr_merged';
      case 'approved':
        return 'review_submitted';
      case 'unapproved':
        return 'review_dismissed';
      default:
        return null;
    }
  }

  if (objectKind === 'note') {
    // Note events on merge requests represent comments
    if (payload.merge_request) {
      return 'comment_added';
    }
    return null;
  }

  if (objectKind === 'pipeline') {
    return 'ci_status_changed';
  }

  return null;
}

/**
 * Normalizes a GitLab webhook payload into a NormalizedPREvent.
 * Returns null if the event type is unrecognized.
 */
export function normalizeGitLabEvent(payload: GitLabRawEvent): NormalizedPREvent | null {
  const eventType = resolveEventType(payload);
  if (eventType === null) return null;

  // For note events, the MR info is in merge_request field
  const mr = payload.object_attributes || payload.merge_request;
  if (!mr) return null;

  const project = payload.project;
  if (!project) return null;

  const user = payload.user;
  if (!user) return null;

  const event: NormalizedPREvent = {
    provider: 'gitlab',
    eventType,
    prId: String(mr.iid),
    prTitle: mr.title,
    prUrl: mr.url,
    repositoryName: project.name,
    repositoryFullName: project.path_with_namespace,
    author: user.username,
    branch: mr.source_branch,
    baseBranch: mr.target_branch,
    timestamp: new Date().toISOString(),
  };

  // Include labels if present (only on object_attributes)
  if (payload.object_attributes?.labels && payload.object_attributes.labels.length > 0) {
    event.labels = payload.object_attributes.labels.map((l) => l.title);
  }

  // Include reviewer action for approval events
  if (eventType === 'review_submitted') {
    event.reviewerAction = {
      reviewer: user.username,
      action: 'approved',
    };
  }

  if (eventType === 'review_dismissed') {
    event.reviewerAction = {
      reviewer: user.username,
      action: 'dismissed',
    };
  }

  return event;
}
