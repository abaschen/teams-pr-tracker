import { describe, it, expect } from 'vitest';
import { normalizeGitHubEvent } from '../../src/normalizers/github-normalizer.js';
import type { GitHubRawEvent } from '../../src/models/events.js';

function createBasePR(overrides?: Partial<GitHubRawEvent['pull_request']>) {
  return {
    number: 42,
    title: 'Fix authentication bug',
    html_url: 'https://github.com/org/repo/pull/42',
    merged: false,
    user: { login: 'developer' },
    head: { ref: 'feature/auth-fix' },
    base: { ref: 'main' },
    labels: [{ name: 'bug' }],
    ...overrides,
  };
}

function createBasePayload(overrides?: Partial<GitHubRawEvent>): GitHubRawEvent {
  return {
    action: 'opened',
    pull_request: createBasePR(),
    repository: {
      name: 'repo',
      full_name: 'org/repo',
    },
    ...overrides,
  };
}

describe('normalizeGitHubEvent', () => {
  describe('PR opened', () => {
    it('should normalize a PR opened event', () => {
      const payload = createBasePayload({ action: 'opened' });
      const result = normalizeGitHubEvent(payload);

      expect(result).not.toBeNull();
      expect(result!.provider).toBe('github');
      expect(result!.eventType).toBe('pr_opened');
      expect(result!.prId).toBe('42');
      expect(result!.prTitle).toBe('Fix authentication bug');
      expect(result!.prUrl).toBe('https://github.com/org/repo/pull/42');
      expect(result!.repositoryName).toBe('repo');
      expect(result!.repositoryFullName).toBe('org/repo');
      expect(result!.author).toBe('developer');
      expect(result!.branch).toBe('feature/auth-fix');
      expect(result!.baseBranch).toBe('main');
      expect(result!.labels).toEqual(['bug']);
      expect(result!.timestamp).toBeDefined();
    });
  });

  describe('PR updated (synchronize)', () => {
    it('should normalize a PR synchronize event as pr_updated', () => {
      const payload = createBasePayload({ action: 'synchronize' });
      const result = normalizeGitHubEvent(payload);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('pr_updated');
      expect(result!.prId).toBe('42');
    });
  });

  describe('PR closed', () => {
    it('should normalize a PR closed event (not merged)', () => {
      const payload = createBasePayload({
        action: 'closed',
        pull_request: createBasePR({ merged: false }),
      });
      const result = normalizeGitHubEvent(payload);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('pr_closed');
    });
  });

  describe('PR merged', () => {
    it('should normalize a PR closed+merged event as pr_merged', () => {
      const payload = createBasePayload({
        action: 'closed',
        pull_request: createBasePR({ merged: true }),
      });
      const result = normalizeGitHubEvent(payload);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('pr_merged');
    });
  });

  describe('Review submitted', () => {
    it('should normalize a review approved event', () => {
      const payload = createBasePayload({
        action: 'submitted',
        review: { user: { login: 'reviewer1' }, state: 'approved' },
      });
      const result = normalizeGitHubEvent(payload);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('review_submitted');
      expect(result!.reviewerAction).toEqual({
        reviewer: 'reviewer1',
        action: 'approved',
      });
    });

    it('should normalize a review with changes_requested', () => {
      const payload = createBasePayload({
        action: 'submitted',
        review: { user: { login: 'reviewer2' }, state: 'changes_requested' },
      });
      const result = normalizeGitHubEvent(payload);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('review_submitted');
      expect(result!.reviewerAction).toEqual({
        reviewer: 'reviewer2',
        action: 'changes_requested',
      });
    });
  });

  describe('Review dismissed', () => {
    it('should normalize a review dismissed event', () => {
      const payload = createBasePayload({
        action: 'dismissed',
        review: { user: { login: 'reviewer1' }, state: 'dismissed' },
      });
      const result = normalizeGitHubEvent(payload);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('review_dismissed');
      expect(result!.reviewerAction).toEqual({
        reviewer: 'reviewer1',
        action: 'dismissed',
      });
    });
  });

  describe('Comment added', () => {
    it('should normalize a comment created event', () => {
      const payload = createBasePayload({
        action: 'created',
        comment: { user: { login: 'commenter' }, body: 'Looks good!' },
      });
      const result = normalizeGitHubEvent(payload);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('comment_added');
    });
  });

  describe('Edge cases', () => {
    it('should return null for unrecognized action', () => {
      const payload = createBasePayload({ action: 'labeled' });
      const result = normalizeGitHubEvent(payload);

      expect(result).toBeNull();
    });

    it('should return null when pull_request is missing', () => {
      const payload: GitHubRawEvent = {
        action: 'opened',
        repository: { name: 'repo', full_name: 'org/repo' },
      };
      const result = normalizeGitHubEvent(payload);

      expect(result).toBeNull();
    });

    it('should handle PR without labels', () => {
      const payload = createBasePayload({
        pull_request: createBasePR({ labels: undefined }),
      });
      const result = normalizeGitHubEvent(payload);

      expect(result).not.toBeNull();
      expect(result!.labels).toBeUndefined();
    });

    it('should handle PR with empty labels array', () => {
      const payload = createBasePayload({
        pull_request: createBasePR({ labels: [] }),
      });
      const result = normalizeGitHubEvent(payload);

      expect(result).not.toBeNull();
      expect(result!.labels).toBeUndefined();
    });
  });
});
