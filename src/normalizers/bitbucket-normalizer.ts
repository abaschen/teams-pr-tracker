/**
 * Bitbucket webhook event normalizer.
 * Transforms Bitbucket-specific webhook payloads into the provider-agnostic NormalizedPREvent format.
 *
 * Bitbucket uses an event key header (X-Event-Key) to identify webhook event types:
 * - pullrequest:created, pullrequest:updated, pullrequest:fulfilled, pullrequest:rejected
 * - pullrequest:approved, pullrequest:unapproved
 * - pullrequest:comment_created
 */

import type { BitbucketRawEvent, NormalizedPREvent, PREventType } from '../models/events.js';

/**
 * Maps Bitbucket event key to a PREventType.
 * Returns null for unrecognized event keys.
 */
function resolveEventType(eventKey: string): PREventType | null {
  switch (eventKey) {
    case 'pullrequest:created':
      return 'pr_opened';
    case 'pullrequest:updated':
      return 'pr_updated';
    case 'pullrequest:fulfilled':
      return 'pr_merged';
    case 'pullrequest:rejected':
      return 'pr_closed';
    case 'pullrequest:approved':
      return 'review_submitted';
    case 'pullrequest:unapproved':
      return 'review_dismissed';
    case 'pullrequest:comment_created':
      return 'comment_added';
    case 'repo:commit_status_created':
    case 'repo:commit_status_updated':
      return 'ci_status_changed';
    default:
      return null;
  }
}

/**
 * Normalizes a Bitbucket webhook payload into a NormalizedPREvent.
 * Returns null if the event type is unrecognized.
 *
 * @param payload - The raw Bitbucket webhook payload
 * @param eventKey - The X-Event-Key header value from the webhook request
 */
export function normalizeBitbucketEvent(
  payload: BitbucketRawEvent,
  eventKey?: string
): NormalizedPREvent | null {
  const key = eventKey || payload.eventKey;
  if (!key) return null;

  const eventType = resolveEventType(key);
  if (eventType === null) return null;

  const pr = payload.pullrequest;
  if (!pr) return null;
  if (!payload.repository) return null;

  const event: NormalizedPREvent = {
    provider: 'bitbucket',
    eventType,
    prId: String(pr.id),
    prTitle: pr.title,
    prUrl: pr.links.html.href,
    repositoryName: payload.repository.name,
    repositoryFullName: payload.repository.full_name,
    author: pr.author.nickname,
    branch: pr.source.branch.name,
    baseBranch: pr.destination.branch.name,
    timestamp: new Date().toISOString(),
  };

  // Include reviewer action for approval events
  if (eventType === 'review_submitted' && payload.approval) {
    event.reviewerAction = {
      reviewer: payload.approval.user.nickname,
      action: 'approved',
    };
  }

  if (eventType === 'review_dismissed' && payload.approval) {
    event.reviewerAction = {
      reviewer: payload.approval.user.nickname,
      action: 'dismissed',
    };
  }

  return event;
}
