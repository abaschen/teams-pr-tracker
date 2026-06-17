import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubAdapter } from '../../src/adapters/github-adapter.js';
import { AdapterApiError } from '../../src/adapters/provider-adapter.js';
import type { PRReference } from '../../src/adapters/provider-adapter.js';

describe('GitHubAdapter', () => {
  const mockToken = 'ghp_test-token-123';
  let adapter: GitHubAdapter;
  let fetchMock: ReturnType<typeof vi.fn>;

  const pr: PRReference = {
    provider: 'github',
    owner: 'test-org',
    repo: 'test-repo',
    prNumber: '42',
  };

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    adapter = new GitHubAdapter(mockToken);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockResponse(status: number, body?: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (body ? JSON.stringify(body) : ''),
      json: async () => body,
      headers: new Headers(),
    } as unknown as Response;
  }

  describe('headers', () => {
    it('should include correct authorization and accept headers', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, []));

      await adapter.addLabels(pr, ['bug']);

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockToken}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          }),
        })
      );
    });
  });

  describe('addLabels', () => {
    it('should POST labels to the issues endpoint', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, []));

      await adapter.addLabels(pr, ['bug', 'enhancement']);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/test-org/test-repo/issues/42/labels',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ labels: ['bug', 'enhancement'] }),
        })
      );
    });

    it('should throw AdapterApiError on failure', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(404, { message: 'Not Found' })
      );

      await expect(adapter.addLabels(pr, ['bug'])).rejects.toThrow(
        AdapterApiError
      );
    });
  });

  describe('removeLabels', () => {
    it('should DELETE each label individually', async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse(204))
        .mockResolvedValueOnce(mockResponse(204));

      await adapter.removeLabels(pr, ['bug', 'wontfix']);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/test-org/test-repo/issues/42/labels/bug',
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/test-org/test-repo/issues/42/labels/wontfix',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should URL-encode label names with special characters', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(204));

      await adapter.removeLabels(pr, ['team/frontend']);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/test-org/test-repo/issues/42/labels/team%2Ffrontend',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('assignReviewers', () => {
    it('should POST reviewers to the pulls endpoint', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(201, {}));

      await adapter.assignReviewers(pr, ['user1', 'user2']);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/test-org/test-repo/pulls/42/requested_reviewers',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ reviewers: ['user1', 'user2'] }),
        })
      );
    });
  });

  describe('unassignReviewers', () => {
    it('should DELETE reviewers from the pulls endpoint', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, {}));

      await adapter.unassignReviewers(pr, ['user1']);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/test-org/test-repo/pulls/42/requested_reviewers',
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ reviewers: ['user1'] }),
        })
      );
    });
  });

  describe('addComment', () => {
    it('should POST a comment to the issues endpoint', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(201, { id: 1 }));

      await adapter.addComment(pr, 'Hello from the bot!');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/test-org/test-repo/issues/42/comments',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ body: 'Hello from the bot!' }),
        })
      );
    });
  });

  describe('updateDescription', () => {
    it('should GET current PR body and PATCH with appended text', async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockResponse(200, { body: 'Existing description' })
        )
        .mockResolvedValueOnce(mockResponse(200, {}));

      const result = await adapter.updateDescription(pr, '---\nTeams link');

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // First call: GET current PR
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://api.github.com/repos/test-org/test-repo/pulls/42',
        expect.objectContaining({ method: 'GET' })
      );

      // Second call: PATCH with appended body
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://api.github.com/repos/test-org/test-repo/pulls/42',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            body: 'Existing description\n\n---\nTeams link',
          }),
        })
      );
    });

    it('should handle null body on existing PR', async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse(200, { body: null }))
        .mockResolvedValueOnce(mockResponse(200, {}));

      await adapter.updateDescription(pr, 'New text');

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://api.github.com/repos/test-org/test-repo/pulls/42',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ body: 'New text' }),
        })
      );
    });
  });

  describe('getChangedFiles', () => {
    it('should return filenames from the pulls files endpoint', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, [
          { filename: 'src/index.ts' },
          { filename: 'README.md' },
        ])
      );

      const files = await adapter.getChangedFiles(pr);

      expect(files).toEqual(['src/index.ts', 'README.md']);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/test-org/test-repo/pulls/42/files?per_page=100&page=1',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should paginate when response has 100 files', async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => ({
        filename: `file-${i}.ts`,
      }));
      const page2 = [{ filename: 'file-100.ts' }];

      fetchMock
        .mockResolvedValueOnce(mockResponse(200, page1))
        .mockResolvedValueOnce(mockResponse(200, page2));

      const files = await adapter.getChangedFiles(pr);

      expect(files).toHaveLength(101);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('page=1'),
        expect.any(Object)
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('page=2'),
        expect.any(Object)
      );
    });

    it('should return empty array for PR with no changed files', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, []));

      const files = await adapter.getChangedFiles(pr);

      expect(files).toEqual([]);
    });
  });

  describe('error handling', () => {
    it('should throw AdapterApiError with status code and message on non-2xx', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(403, { message: 'Resource not accessible by integration' })
      );

      try {
        await adapter.addLabels(pr, ['bug']);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AdapterApiError);
        const apiError = error as AdapterApiError;
        expect(apiError.statusCode).toBe(403);
        expect(apiError.provider).toBe('github');
        expect(apiError.message).toContain('403');
      }
    });

    it('should throw AdapterApiError on 500 server error', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(500, { message: 'Internal Server Error' })
      );

      await expect(adapter.assignReviewers(pr, ['user1'])).rejects.toThrow(
        AdapterApiError
      );
    });
  });
});
