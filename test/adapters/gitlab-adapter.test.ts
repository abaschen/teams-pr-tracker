import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitLabAdapter } from '../../src/adapters/gitlab-adapter.js';
import { AdapterApiError } from '../../src/adapters/provider-adapter.js';
import type { PRReference } from '../../src/models/interfaces.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('GitLabAdapter', () => {
  const token = 'glpat-test-token';
  let adapter: GitLabAdapter;

  const pr: PRReference = {
    provider: 'gitlab',
    owner: 'my-group',
    repo: 'my-project',
    prNumber: '42',
  };

  const encodedPath = encodeURIComponent('my-group/my-project');
  const baseApiUrl = `https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests/42`;

  beforeEach(() => {
    adapter = new GitLabAdapter({ accessToken: token });
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function jsonResponse(data: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    } as unknown as Response;
  }

  function errorResponse(status: number, message: string): Response {
    return {
      ok: false,
      status,
      headers: new Headers({ 'content-type': 'text/plain' }),
      json: () => Promise.reject(new Error('not json')),
      text: () => Promise.resolve(message),
    } as unknown as Response;
  }

  describe('constructor', () => {
    it('uses https://gitlab.com as default baseUrl', () => {
      const a = new GitLabAdapter({ accessToken: 'tok' });
      // Verify by making a request and checking the URL
      mockFetch.mockResolvedValueOnce(jsonResponse({ labels: [] }));
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      a.addLabels(pr, ['test']);
      // First call should be GET to gitlab.com
      expect(mockFetch.mock.calls[0][0]).toContain('https://gitlab.com/api/v4');
    });

    it('uses custom baseUrl when provided', () => {
      const a = new GitLabAdapter({
        accessToken: 'tok',
        baseUrl: 'https://gitlab.example.com',
      });
      mockFetch.mockResolvedValueOnce(jsonResponse({ labels: [] }));
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      a.addLabels(pr, ['test']);
      expect(mockFetch.mock.calls[0][0]).toContain(
        'https://gitlab.example.com/api/v4'
      );
    });

    it('strips trailing slashes from baseUrl', () => {
      const a = new GitLabAdapter({
        accessToken: 'tok',
        baseUrl: 'https://gitlab.example.com/',
      });
      mockFetch.mockResolvedValueOnce(jsonResponse({ labels: [] }));
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      a.addLabels(pr, ['test']);
      expect(mockFetch.mock.calls[0][0]).toContain(
        'https://gitlab.example.com/api/v4'
      );
      expect(mockFetch.mock.calls[0][0]).not.toContain('//api');
    });
  });

  describe('headers', () => {
    it('sends PRIVATE-TOKEN and Content-Type headers', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ labels: ['existing'] }));
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      await adapter.addLabels(pr, ['new-label']);

      const firstCall = mockFetch.mock.calls[0];
      expect(firstCall[1].headers).toEqual({
        'PRIVATE-TOKEN': token,
        'Content-Type': 'application/json',
      });
    });
  });

  describe('addLabels', () => {
    it('fetches existing labels and merges with new ones', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ labels: ['bug', 'enhancement'] })
      );
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      await adapter.addLabels(pr, ['team-frontend', 'bug']);

      // First call: GET merge request
      expect(mockFetch.mock.calls[0][0]).toBe(baseApiUrl);
      expect(mockFetch.mock.calls[0][1].method).toBe('GET');

      // Second call: PUT with merged labels
      expect(mockFetch.mock.calls[1][0]).toBe(baseApiUrl);
      expect(mockFetch.mock.calls[1][1].method).toBe('PUT');
      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.labels).toBe('bug,enhancement,team-frontend');
    });

    it('handles empty existing labels', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ labels: [] }));
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      await adapter.addLabels(pr, ['team-backend']);

      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.labels).toBe('team-backend');
    });
  });

  describe('removeLabels', () => {
    it('fetches existing labels and removes specified ones', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ labels: ['bug', 'team-frontend', 'team-backend'] })
      );
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      await adapter.removeLabels(pr, ['team-frontend']);

      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.labels).toBe('bug,team-backend');
    });

    it('handles removing labels that do not exist', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ labels: ['bug'] }));
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      await adapter.removeLabels(pr, ['nonexistent']);

      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.labels).toBe('bug');
    });
  });

  describe('assignReviewers', () => {
    it('resolves usernames to IDs and assigns them', async () => {
      // resolveUserIds: two user lookups
      mockFetch.mockResolvedValueOnce(jsonResponse([{ id: 101 }])); // user lookup: alice
      mockFetch.mockResolvedValueOnce(jsonResponse([{ id: 202 }])); // user lookup: bob
      // getMergeRequest
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ reviewers: [{ id: 50 }] })
      );
      // updateMergeRequest
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      await adapter.assignReviewers(pr, ['alice', 'bob']);

      // User lookups
      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://gitlab.com/api/v4/users?username=alice'
      );
      expect(mockFetch.mock.calls[1][0]).toBe(
        'https://gitlab.com/api/v4/users?username=bob'
      );

      // PUT with merged reviewer_ids (existing 50 + new 101, 202)
      const body = JSON.parse(mockFetch.mock.calls[3][1].body);
      expect(body.reviewer_ids).toEqual([50, 101, 202]);
    });

    it('handles user not found gracefully', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([])); // unknown user
      mockFetch.mockResolvedValueOnce(jsonResponse({ reviewers: [] }));
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      await adapter.assignReviewers(pr, ['unknown-user']);

      const body = JSON.parse(mockFetch.mock.calls[2][1].body);
      expect(body.reviewer_ids).toEqual([]);
    });
  });

  describe('unassignReviewers', () => {
    it('resolves usernames and removes their IDs', async () => {
      // resolveUserIds
      mockFetch.mockResolvedValueOnce(jsonResponse([{ id: 101 }])); // alice
      // getMergeRequest
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ reviewers: [{ id: 101 }, { id: 202 }] })
      );
      // updateMergeRequest
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      await adapter.unassignReviewers(pr, ['alice']);

      const body = JSON.parse(mockFetch.mock.calls[2][1].body);
      expect(body.reviewer_ids).toEqual([202]);
    });
  });

  describe('addComment', () => {
    it('posts a note to the merge request', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 1 }));

      await adapter.addComment(pr, 'Hello from Teams!');

      expect(mockFetch.mock.calls[0][0]).toBe(`${baseApiUrl}/notes`);
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.body).toBe('Hello from Teams!');
    });
  });

  describe('updateDescription', () => {
    it('appends text to existing description and returns true', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ description: 'Original description' })
      );
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      const result = await adapter.updateDescription(pr, '## Teams Thread\nLink here');

      expect(result).toBe(true);
      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.description).toBe(
        'Original description\n\n## Teams Thread\nLink here'
      );
    });

    it('uses appendText as full description when current is empty', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ description: '' }));
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      const result = await adapter.updateDescription(pr, 'New content');

      expect(result).toBe(true);
      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.description).toBe('New content');
    });

    it('handles null description', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ description: null }));
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      const result = await adapter.updateDescription(pr, 'Content');

      expect(result).toBe(true);
      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.description).toBe('Content');
    });
  });

  describe('getChangedFiles', () => {
    it('extracts file paths from changes array', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          changes: [
            { new_path: 'src/app.ts', old_path: 'src/app.ts' },
            { new_path: 'src/utils.ts', old_path: 'src/old-utils.ts' },
            { new_path: 'README.md', old_path: 'README.md' },
          ],
        })
      );

      const files = await adapter.getChangedFiles(pr);

      expect(mockFetch.mock.calls[0][0]).toBe(`${baseApiUrl}/changes`);
      expect(mockFetch.mock.calls[0][1].method).toBe('GET');
      expect(files).toContain('src/app.ts');
      expect(files).toContain('src/utils.ts');
      expect(files).toContain('src/old-utils.ts');
      expect(files).toContain('README.md');
      expect(files).toHaveLength(4);
    });

    it('handles empty changes array', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ changes: [] }));

      const files = await adapter.getChangedFiles(pr);

      expect(files).toEqual([]);
    });

    it('deduplicates when new_path equals old_path', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          changes: [{ new_path: 'src/file.ts', old_path: 'src/file.ts' }],
        })
      );

      const files = await adapter.getChangedFiles(pr);

      expect(files).toEqual(['src/file.ts']);
    });
  });

  describe('error handling', () => {
    it('throws AdapterApiError on non-2xx response', async () => {
      mockFetch.mockResolvedValueOnce(
        errorResponse(403, 'Forbidden: insufficient permissions')
      );

      await expect(adapter.addComment(pr, 'test')).rejects.toThrow(
        AdapterApiError
      );

      mockFetch.mockResolvedValueOnce(
        errorResponse(403, 'Forbidden: insufficient permissions')
      );

      await expect(adapter.addComment(pr, 'test')).rejects.toThrow(
        /\[gitlab\] API error \(403\)/
      );
    });

    it('includes status code in AdapterApiError', async () => {
      mockFetch.mockResolvedValueOnce(
        errorResponse(404, 'Not Found')
      );

      try {
        await adapter.addComment(pr, 'test');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AdapterApiError);
        expect((err as AdapterApiError).statusCode).toBe(404);
        expect((err as AdapterApiError).provider).toBe('gitlab');
      }
    });

    it('throws AdapterApiError on 500 server error', async () => {
      mockFetch.mockResolvedValueOnce(
        errorResponse(500, 'Internal Server Error')
      );

      await expect(adapter.getChangedFiles(pr)).rejects.toThrow(
        AdapterApiError
      );
    });
  });

  describe('URL encoding', () => {
    it('properly encodes project path with special characters', async () => {
      const specialPr: PRReference = {
        provider: 'gitlab',
        owner: 'my-org/sub-group',
        repo: 'my-project',
        prNumber: '7',
      };

      mockFetch.mockResolvedValueOnce(jsonResponse({ changes: [] }));

      await adapter.getChangedFiles(specialPr);

      const expectedPath = encodeURIComponent('my-org/sub-group/my-project');
      expect(mockFetch.mock.calls[0][0]).toBe(
        `https://gitlab.com/api/v4/projects/${expectedPath}/merge_requests/7/changes`
      );
    });
  });
});
