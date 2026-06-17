/**
 * GitHub webhook event normalizer.
 * Transforms GitHub-specific webhook payloads into the provider-agnostic NormalizedPREvent format.
 */

import type { GitHubRawEvent, NormalizedPREvent, PREventType } from '../models/events.js';

/**
 * Maps GitHub webhook action + event context to a PREventType.
 * Returns null for unrecognized actions.
 */
function resolveEventType(payload: GitHubRawEvent, eventHeader?: string): PREventType | null {
  const action = payload.action;

  // Review events
  if (payload.review) {
    if (action === 'submitted') return 'review_submitted';
    if (action === 'dismissed') return 'review_dismissed';
    return null;
  }

  // Comment events (issue_comment or pull_request_review_comment)
  if (payload.comment && !payload.review) {
    if (action === 'created') return 'comment_added';
    return null;
  }

  // PR events
  if (payload.pull_request) {
    switch (action) {
      case 'opened':
        return 'pr_opened';
      case 'synchronize':
        return 'pr_updated';
      case 'closed':
        return payload.pull_request.merged ? 'pr_merged' : 'pr_closed';
      default:
        return null;
    }
  }

  // CI status events (check_run or status)
  if (eventHeader === 'check_run' || eventHeader === 'status') {
    return 'ci_status_changed';
  }

  return null;
}

/**
 * Normalizes a GitHub webhook payload into a NormalizedPREvent.
 * Returns null if the event type is unrecognized.
 */
export function normalizeGitHubEvent(
  payload: GitHubRawEvent,
  eventHeader?: string
): NormalizedPREvent | null {
  const eventType = resolveEventType(payload, eventHeader);
  if (eventType === null) return null;

  const pr = payload.pull_request;
  if (!pr) return null;
  if (!payload.repository) return null;

  const event: NormalizedPREvent = {
    provider: 'github',
    eventType,
    prId: String(pr.number),
    prTitle: pr.title,
    prUrl: pr.html_url,
    repositoryName: payload.repository.name,
    repositoryFullName: payload.repository.full_name,
    author: pr.user.login,
    branch: pr.head.ref,
    baseBranch: pr.base.ref,
    timestamp: new Date().toISOString(),
  };

  // Include labels if present
  if (pr.labels && pr.labels.length > 0) {
    event.labels = pr.labels.map((l) => l.name);
  }

  // Include reviewer action for review events
  if (eventType === 'review_submitted' && payload.review) {
    const reviewState = payload.review.state.toLowerCase();
    let action: 'approved' | 'changes_requested' | 'dismissed';
    if (reviewState === 'approved') {
      action = 'approved';
    } else if (reviewState === 'changes_requested') {
      action = 'changes_requested';
    } else {
      // For 'commented' or other states, still normalize as review_submitted but no reviewer action
      action = reviewState as 'approved' | 'changes_requested' | 'dismissed';
    }
    event.reviewerAction = {
      reviewer: payload.review.user.login,
      action,
    };
  }

  if (eventType === 'review_dismissed' && payload.review) {
    event.reviewerAction = {
      reviewer: payload.review.user.login,
      action: 'dismissed',
    };
  }

  return event;
}
