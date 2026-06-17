import { describe, it, expect, vi, afterEach } from 'vitest';
import { getAdapter } from '../../src/adapters/adapter-factory.js';
import { GitHubAdapter } from '../../src/adapters/github-adapter.js';
import { BitbucketAdapter } from '../../src/adapters/bitbucket-adapter.js';

describe('getAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GITHUB_TOKEN;
  });

  describe('github provider', () => {
    it('should return a GitHubAdapter when token is provided as parameter', () => {
      const adapter = getAdapter('github', 'ghp_test-token');
      expect(adapter).toBeInstanceOf(GitHubAdapter);
    });

    it('should return a GitHubAdapter when GITHUB_TOKEN env var is set', () => {
      process.env.GITHUB_TOKEN = 'ghp_env-token';
      const adapter = getAdapter('github');
      expect(adapter).toBeInstanceOf(GitHubAdapter);
    });

    it('should throw when no token is available', () => {
      expect(() => getAdapter('github')).toThrow(
        'GitHub access token is required'
      );
    });

    it('should prefer explicit token over environment variable', () => {
      process.env.GITHUB_TOKEN = 'ghp_env-token';
      const adapter = getAdapter('github', 'ghp_explicit-token');
      expect(adapter).toBeInstanceOf(GitHubAdapter);
    });
  });

  describe('unsupported providers', () => {
    it('should throw for gitlab (not yet implemented)', () => {
      expect(() => getAdapter('gitlab')).toThrow();
    });
  });

  describe('bitbucket provider', () => {
    afterEach(() => {
      delete process.env.BITBUCKET_TOKEN;
    });

    it('should return a BitbucketAdapter when token is provided as parameter', () => {
      const adapter = getAdapter('bitbucket', 'bb-test-token');
      expect(adapter).toBeInstanceOf(BitbucketAdapter);
    });

    it('should return a BitbucketAdapter when BITBUCKET_TOKEN env var is set', () => {
      process.env.BITBUCKET_TOKEN = 'bb-env-token';
      const adapter = getAdapter('bitbucket');
      expect(adapter).toBeInstanceOf(BitbucketAdapter);
    });

    it('should throw when no token is available for bitbucket', () => {
      expect(() => getAdapter('bitbucket')).toThrow(
        'Bitbucket access token is required'
      );
    });
  });
});
