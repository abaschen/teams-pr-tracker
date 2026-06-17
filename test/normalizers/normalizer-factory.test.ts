import { describe, it, expect } from 'vitest';
import { getNormalizer } from '../../src/normalizers/normalizer-factory.js';
import type { GitHubRawEvent, BitbucketRawEvent, GitLabRawEvent } from '../../src/models/events.js';

describe('getNormalizer', () => {
  describe('provider selection', () => {
    it('should return a normalizer for github', () => {
      const normalizer = getNormalizer('github');
      expect(normalizer).toBeTypeOf('function');
    });

    it('should return a normalizer for bitbucket', () => {
      const normalizer = getNormalizer('bitbucket');
      expect(normalizer).toBeTypeOf('function');
    });

    it('should return a normalizer for gitlab', () => {
      const normalizer = getNormalizer('gitlab');
      expect(normalizer).toBeTypeOf('function');
    });
  });

  describe('github normalizer', () => {
    it('should normalize a GitHub PR opened event', () => {
      const normalizer = getNormalizer('github');
      const payload: GitHubRawEvent = {
        action: 'opened',
        pull_request: {
          number: 1,
          title: 'Test PR',
          html_url: 'https://github.com/org/repo/pull/1',
          merged: false,
          user: { login: 'dev' },
          head: { ref: 'feature' },
          base: { ref: 'main' },
        },
        repository: { name: 'repo', full_name: 'org/repo' },
      };

      const result = normalizer(payload);
      expect(result).not.toBeNull();
      expect(result!.provider).toBe('github');
      expect(result!.eventType).toBe('pr_opened');
    });

    it('should return null for unrecognized GitHub event', () => {
      const normalizer = getNormalizer('github');
      const payload: GitHubRawEvent = {
        action: 'labeled',
        pull_request: {
          number: 1,
          title: 'Test PR',
          html_url: 'https://github.com/org/repo/pull/1',
          merged: false,
          user: { login: 'dev' },
          head: { ref: 'feature' },
          base: { ref: 'main' },
        },
        repository: { name: 'repo', full_name: 'org/repo' },
      };

      const result = normalizer(payload);
      expect(result).toBeNull();
    });
  });

  describe('bitbucket normalizer', () => {
    it('should normalize a Bitbucket PR created event', () => {
      const normalizer = getNormalizer('bitbucket');
      const payload: BitbucketRawEvent = {
        pullrequest: {
          id: 5,
          title: 'Test PR',
          links: { html: { href: 'https://bitbucket.org/team/repo/pull-requests/5' } },
          author: { display_name: 'Dev', nickname: 'dev' },
          source: { branch: { name: 'feature' } },
          destination: { branch: { name: 'main' } },
        },
        repository: { name: 'repo', full_name: 'team/repo' },
      };

      const result = normalizer(payload, 'pullrequest:created');
      expect(result).not.toBeNull();
      expect(result!.provider).toBe('bitbucket');
      expect(result!.eventType).toBe('pr_opened');
    });

    it('should return null for unrecognized Bitbucket event', () => {
      const normalizer = getNormalizer('bitbucket');
      const payload: BitbucketRawEvent = {
        pullrequest: {
          id: 5,
          title: 'Test PR',
          links: { html: { href: 'https://bitbucket.org/team/repo/pull-requests/5' } },
          author: { display_name: 'Dev', nickname: 'dev' },
          source: { branch: { name: 'feature' } },
          destination: { branch: { name: 'main' } },
        },
        repository: { name: 'repo', full_name: 'team/repo' },
      };

      const result = normalizer(payload, 'repo:push');
      expect(result).toBeNull();
    });
  });

  describe('gitlab normalizer', () => {
    it('should normalize a GitLab MR open event', () => {
      const normalizer = getNormalizer('gitlab');
      const payload: GitLabRawEvent = {
        object_kind: 'merge_request',
        object_attributes: {
          iid: 3,
          title: 'Test MR',
          url: 'https://gitlab.com/group/project/-/merge_requests/3',
          action: 'open',
          source_branch: 'feature',
          target_branch: 'main',
        },
        user: { username: 'dev', name: 'Dev' },
        project: { name: 'project', path_with_namespace: 'group/project' },
      };

      const result = normalizer(payload);
      expect(result).not.toBeNull();
      expect(result!.provider).toBe('gitlab');
      expect(result!.eventType).toBe('pr_opened');
    });

    it('should return null for unrecognized GitLab event', () => {
      const normalizer = getNormalizer('gitlab');
      const payload: GitLabRawEvent = {
        object_kind: 'push',
        user: { username: 'dev', name: 'Dev' },
        project: { name: 'project', path_with_namespace: 'group/project' },
      };

      const result = normalizer(payload);
      expect(result).toBeNull();
    });
  });
});
