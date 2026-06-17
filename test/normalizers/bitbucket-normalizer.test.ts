import { describe, it, expect } from 'vitest';
import { normalizeBitbucketEvent } from '../../src/normalizers/bitbucket-normalizer.js';
import type { BitbucketRawEvent } from '../../src/models/events.js';

function createBasePR(overrides?: Partial<NonNullable<BitbucketRawEvent['pullrequest']>>) {
  return {
    id: 15,
    title: 'Add new feature',
    state: 'OPEN',
    links: { html: { href: 'https://bitbucket.org/team/repo/pull-requests/15' } },
    author: { display_name: 'Jane Dev', nickname: 'janedev' },
    source: { branch: { name: 'feature/new-thing' } },
    destination: { branch: { name: 'main' } },
    ...overrides,
  };
}

function createBasePayload(overrides?: Partial<BitbucketRawEvent>): BitbucketRawEvent {
  return {
    pullrequest: createBasePR(),
    repository: {
      name: 'repo',
      full_name: 'team/repo',
    },
    ...overrides,
  };
}

describe('normalizeBitbucketEvent', () => {
  describe('PR created', () => {
    it('should normalize a pullrequest:created event', () => {
      const payload = createBasePayload();
      const result = normalizeBitbucketEvent(payload, 'pullrequest:created');

      expect(result).not.toBeNull();
      expect(result!.provider).toBe('bitbucket');
      expect(result!.eventType).toBe('pr_opened');
      expect(result!.prId).toBe('15');
      expect(result!.prTitle).toBe('Add new feature');
      expect(result!.prUrl).toBe('https://bitbucket.org/team/repo/pull-requests/15');
      expect(result!.repositoryName).toBe('repo');
      expect(result!.repositoryFullName).toBe('team/repo');
      expect(result!.author).toBe('janedev');
      expect(result!.branch).toBe('feature/new-thing');
      expect(result!.baseBranch).toBe('main');
      expect(result!.timestamp).toBeDefined();
    });
  });

  describe('PR updated', () => {
    it('should normalize a pullrequest:updated event', () => {
      const payload = createBasePayload();
      const result = normalizeBitbucketEvent(payload, 'pullrequest:updated');

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('pr_updated');
    });
  });

  describe('PR merged (fulfilled)', () => {
    it('should normalize a pullrequest:fulfilled event as pr_merged', () => {
      const payload = createBasePayload();
      const result = normalizeBitbucketEvent(payload, 'pullrequest:fulfilled');

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('pr_merged');
    });
  });

  describe('PR closed (rejected)', () => {
    it('should normalize a pullrequest:rejected event as pr_closed', () => {
      const payload = createBasePayload();
      const result = normalizeBitbucketEvent(payload, 'pullrequest:rejected');

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('pr_closed');
    });
  });

  describe('Review submitted (approved)', () => {
    it('should normalize a pullrequest:approved event', () => {
      const payload = createBasePayload({
        approval: { user: { display_name: 'Reviewer', nickname: 'reviewer1' } },
      });
      const result = normalizeBitbucketEvent(payload, 'pullrequest:approved');

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('review_submitted');
      expect(result!.reviewerAction).toEqual({
        reviewer: 'reviewer1',
        action: 'approved',
      });
    });
  });

  describe('Review dismissed (unapproved)', () => {
    it('should normalize a pullrequest:unapproved event as review_dismissed', () => {
      const payload = createBasePayload({
        approval: { user: { display_name: 'Reviewer', nickname: 'reviewer1' } },
      });
      const result = normalizeBitbucketEvent(payload, 'pullrequest:unapproved');

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('review_dismissed');
      expect(result!.reviewerAction).toEqual({
        reviewer: 'reviewer1',
        action: 'dismissed',
      });
    });
  });

  describe('Comment added', () => {
    it('should normalize a pullrequest:comment_created event', () => {
      const payload = createBasePayload({
        comment: {
          user: { display_name: 'Commenter', nickname: 'commenter1' },
          content: { raw: 'Nice work!' },
        },
      });
      const result = normalizeBitbucketEvent(payload, 'pullrequest:comment_created');

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('comment_added');
    });
  });

  describe('CI status changed', () => {
    it('should normalize a repo:commit_status_created event', () => {
      const payload = createBasePayload();
      const result = normalizeBitbucketEvent(payload, 'repo:commit_status_created');

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('ci_status_changed');
    });

    it('should normalize a repo:commit_status_updated event', () => {
      const payload = createBasePayload();
      const result = normalizeBitbucketEvent(payload, 'repo:commit_status_updated');

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('ci_status_changed');
    });
  });

  describe('Edge cases', () => {
    it('should return null for unrecognized event key', () => {
      const payload = createBasePayload();
      const result = normalizeBitbucketEvent(payload, 'repo:push');

      expect(result).toBeNull();
    });

    it('should return null when event key is missing', () => {
      const payload = createBasePayload();
      const result = normalizeBitbucketEvent(payload);

      expect(result).toBeNull();
    });

    it('should return null when pullrequest is missing', () => {
      const payload: BitbucketRawEvent = {
        repository: { name: 'repo', full_name: 'team/repo' },
      };
      const result = normalizeBitbucketEvent(payload, 'pullrequest:created');

      expect(result).toBeNull();
    });

    it('should use eventKey from payload if header not provided', () => {
      const payload = createBasePayload({ eventKey: 'pullrequest:created' });
      const result = normalizeBitbucketEvent(payload);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('pr_opened');
    });
  });
});
