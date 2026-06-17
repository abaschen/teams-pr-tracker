import { describe, it, expect } from 'vitest';
import { normalizeGitLabEvent } from '../../src/normalizers/gitlab-normalizer.js';
import type { GitLabRawEvent } from '../../src/models/events.js';

function createBaseMRAttributes(
  overrides?: Partial<NonNullable<GitLabRawEvent['object_attributes']>>
) {
  return {
    iid: 7,
    title: 'Refactor database layer',
    url: 'https://gitlab.com/group/project/-/merge_requests/7',
    action: 'open',
    source_branch: 'refactor/db-layer',
    target_branch: 'main',
    labels: [{ title: 'backend' }],
    ...overrides,
  };
}

function createBasePayload(overrides?: Partial<GitLabRawEvent>): GitLabRawEvent {
  return {
    object_kind: 'merge_request',
    object_attributes: createBaseMRAttributes(),
    user: { username: 'dev_user', name: 'Dev User' },
    project: { name: 'project', path_with_namespace: 'group/project' },
    ...overrides,
  };
}

describe('normalizeGitLabEvent', () => {
  describe('PR opened (MR open)', () => {
    it('should normalize a merge_request open event', () => {
      const payload = createBasePayload({
        object_attributes: createBaseMRAttributes({ action: 'open' }),
      });
      const result = normalizeGitLabEvent(payload);

      expect(result).not.toBeNull();
      expect(result!.provider).toBe('gitlab');
      expect(result!.eventType).toBe('pr_opened');
      expect(result!.prId).toBe('7');
      expect(result!.prTitle).toBe('Refactor database layer');
      expect(result!.prUrl).toBe('https://gitlab.com/group/project/-/merge_requests/7');
      expect(result!.repositoryName).toBe('project');
      expect(result!.repositoryFullName).toBe('group/project');
      expect(result!.author).toBe('dev_user');
      expect(result!.branch).toBe('refactor/db-layer');
      expect(result!.baseBranch).toBe('main');
      expect(result!.labels).toEqual(['backend']);
      expect(result!.timestamp).toBeDefined();
    });
  });

  describe('PR updated (MR update)', () => {
    it('should normalize a merge_request update event', () => {
      const payload = createBasePayload({
        object_attributes: createBaseMRAttributes({ action: 'update' }),
      });
      const result = normalizeGitLabEvent(payload);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('pr_updated');
    });
  });

  describe('PR closed (MR close)', () => {
    it('should normalize a merge_request close event', () => {
      const payload = createBasePayload({
        object_attributes: createBaseMRAttributes({ action: 'close' }),
      });
      const result = normalizeGitLabEvent(payload);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('pr_closed');
    });
  });

  describe('PR merged (MR merge)', () => {
    it('should normalize a merge_request merge event', () => {
      const payload = createBasePayload({
        object_attributes: createBaseMRAttributes({ action: 'merge' }),
      });
      const result = normalizeGitLabEvent(payload);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('pr_merged');
    });
  });

  describe('Review submitted (MR approved)', () => {
    it('should normalize a merge_request approved event', () => {
      const payload = createBasePayload({
        object_attributes: createBaseMRAttributes({ action: 'approved' }),
        user: { username: 'approver', name: 'Approver' },
      });
      const result = normalizeGitLabEvent(payload);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('review_submitted');
      expect(result!.reviewerAction).toEqual({
        reviewer: 'approver',
        action: 'approved',
      });
    });
  });

  describe('Review dismissed (MR unapproved)', () => {
    it('should normalize a merge_request unapproved event', () => {
      const payload = createBasePayload({
        object_attributes: createBaseMRAttributes({ action: 'unapproved' }),
        user: { username: 'revoker', name: 'Revoker' },
      });
      const result = normalizeGitLabEvent(payload);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('review_dismissed');
      expect(result!.reviewerAction).toEqual({
        reviewer: 'revoker',
        action: 'dismissed',
      });
    });
  });

  describe('Comment added (note on MR)', () => {
    it('should normalize a note event on a merge request', () => {
      const payload: GitLabRawEvent = {
        object_kind: 'note',
        user: { username: 'commenter', name: 'Commenter' },
        project: { name: 'project', path_with_namespace: 'group/project' },
        merge_request: {
          iid: 7,
          title: 'Refactor database layer',
          url: 'https://gitlab.com/group/project/-/merge_requests/7',
          source_branch: 'refactor/db-layer',
          target_branch: 'main',
        },
      };
      const result = normalizeGitLabEvent(payload);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('comment_added');
      expect(result!.prId).toBe('7');
      expect(result!.author).toBe('commenter');
    });
  });

  describe('CI status changed (pipeline)', () => {
    it('should normalize a pipeline event', () => {
      const payload: GitLabRawEvent = {
        object_kind: 'pipeline',
        user: { username: 'ci_bot', name: 'CI Bot' },
        project: { name: 'project', path_with_namespace: 'group/project' },
        merge_request: {
          iid: 7,
          title: 'Refactor database layer',
          url: 'https://gitlab.com/group/project/-/merge_requests/7',
          source_branch: 'refactor/db-layer',
          target_branch: 'main',
        },
      };
      const result = normalizeGitLabEvent(payload);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('ci_status_changed');
    });
  });

  describe('Edge cases', () => {
    it('should return null for unrecognized object_kind', () => {
      const payload: GitLabRawEvent = {
        object_kind: 'push',
        user: { username: 'dev', name: 'Dev' },
        project: { name: 'project', path_with_namespace: 'group/project' },
      };
      const result = normalizeGitLabEvent(payload);

      expect(result).toBeNull();
    });

    it('should return null for unrecognized merge_request action', () => {
      const payload = createBasePayload({
        object_attributes: createBaseMRAttributes({ action: 'reopen' }),
      });
      const result = normalizeGitLabEvent(payload);

      expect(result).toBeNull();
    });

    it('should return null when project is missing', () => {
      const payload: GitLabRawEvent = {
        object_kind: 'merge_request',
        object_attributes: createBaseMRAttributes({ action: 'open' }),
        user: { username: 'dev', name: 'Dev' },
      };
      const result = normalizeGitLabEvent(payload);

      expect(result).toBeNull();
    });

    it('should return null when user is missing', () => {
      const payload: GitLabRawEvent = {
        object_kind: 'merge_request',
        object_attributes: createBaseMRAttributes({ action: 'open' }),
        project: { name: 'project', path_with_namespace: 'group/project' },
      };
      const result = normalizeGitLabEvent(payload);

      expect(result).toBeNull();
    });

    it('should return null for note event without merge_request', () => {
      const payload: GitLabRawEvent = {
        object_kind: 'note',
        user: { username: 'commenter', name: 'Commenter' },
        project: { name: 'project', path_with_namespace: 'group/project' },
      };
      const result = normalizeGitLabEvent(payload);

      expect(result).toBeNull();
    });

    it('should handle MR without labels', () => {
      const payload = createBasePayload({
        object_attributes: createBaseMRAttributes({ labels: undefined }),
      });
      const result = normalizeGitLabEvent(payload);

      expect(result).not.toBeNull();
      expect(result!.labels).toBeUndefined();
    });
  });
});
