import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BitbucketAdapter } from '../../src/adapters/bitbucket-adapter.js';
import { AdapterApiError } from '../../src/adapters/provider-adapter.js';
import type { PRReference } from '../../src/adapters/provider-adapter.js';

const TEST_TOKEN = 'test-bitbucket-token';
const BASE_URL = 'https://api.bitbucket.org/2.0';

const pr: PRReference = {
  provider: 'bitbucket',
  owner: 'my-workspace',
  repo: 'my-repo',
  prNumber: '42',
};

function prUrl(): string {
  return `${BASE_URL}/repositories/${pr.owner}/${pr.repo}/pullrequests/${pr.prNumber}`;
}

function mockFetch(response: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(response)),
  });
}

function mockFetchSequence(responses: Array<{ body: unknown; status?: number }>) {
  const mock = vi.fn();
  for (const [i, res] of responses.entries()) {
    const status = res.status ?? 200;
    mock.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify(res.body)),
    });
  }
  return mock;
}

describe('BitbucketAdapter', () => {
  let adapter: BitbucketAdapter;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    adapter = new BitbucketAdapter(TEST_TOKEN);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('addLabels', () => {
    it('posts a comment with label info since Bitbucket lacks native labels', async () => {
      const fetchMock = mockFetch({ id: 1 }, 201);
      globalThis.fetch = fetchMock;

      await adapter.addLabels(pr, ['team-frontend', 'team-backend']);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(`${prUrl()}/comments`);
      expect(opts.method).toBe('POST');
      expect(opts.headers.Authorization).toBe(`Bearer ${TEST_TOKEN}`);
      expect(opts.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(opts.body);
      expect(body.content.raw).toContain('team-frontend');
      expect(body.content.raw).toContain('team-backend');
      expect(body.content.raw).toContain('Labels added');
    });
  });

  describe('removeLabels', () => {
    it('posts a comment noting label removal', async () => {
      const fetchMock = mockFetch({ id: 2 }, 201);
      globalThis.fetch = fetchMock;

      await adapter.removeLabels(pr, ['team-frontend']);

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(`${prUrl()}/comments`);
      const body = JSON.parse(opts.body);
      expect(body.content.raw).toContain('Labels removed');
      expect(body.content.raw).toContain('team-frontend');
    });
  });

  describe('assignReviewers', () => {
    it('adds new reviewers to existing participants via PUT', async () => {
      const fetchMock = mockFetchSequence([
        {
          body: { reviewers: [{ username: 'existing-user', uuid: '{uuid-1}' }] },
        },
        { body: {} },
      ]);
      globalThis.fetch = fetchMock;

      await adapter.assignReviewers(pr, ['new-reviewer']);

      // First call: GET current PR
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [getUrl, getOpts] = fetchMock.mock.calls[0];
      expect(getUrl).toBe(prUrl());
      expect(getOpts.method).toBe('GET');

      // Second call: PUT with merged reviewers
      const [putUrl, putOpts] = fetchMock.mock.calls[1];
      expect(putUrl).toBe(prUrl());
      expect(putOpts.method).toBe('PUT');
      const putBody = JSON.parse(putOpts.body);
      expect(putBody.reviewers).toHaveLength(2);
      expect(putBody.reviewers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ username: 'existing-user' }),
          expect.objectContaining({ username: 'new-reviewer' }),
        ])
      );
    });

    it('does not duplicate existing reviewers', async () => {
      const fetchMock = mockFetchSequence([
        {
          body: { reviewers: [{ username: 'alice', uuid: '{uuid-a}' }] },
        },
        { body: {} },
      ]);
      globalThis.fetch = fetchMock;

      await adapter.assignReviewers(pr, ['alice']);

      const [, putOpts] = fetchMock.mock.calls[1];
      const putBody = JSON.parse(putOpts.body);
      expect(putBody.reviewers).toHaveLength(1);
    });
  });

  describe('unassignReviewers', () => {
    it('removes specified reviewers from the PR', async () => {
      const fetchMock = mockFetchSequence([
        {
          body: {
            reviewers: [
              { username: 'alice', uuid: '{uuid-a}' },
              { username: 'bob', uuid: '{uuid-b}' },
            ],
          },
        },
        { body: {} },
      ]);
      globalThis.fetch = fetchMock;

      await adapter.unassignReviewers(pr, ['bob']);

      const [, putOpts] = fetchMock.mock.calls[1];
      const putBody = JSON.parse(putOpts.body);
      expect(putBody.reviewers).toHaveLength(1);
      expect(putBody.reviewers[0].username).toBe('alice');
    });
  });

  describe('addComment', () => {
    it('posts a comment to the PR', async () => {
      const fetchMock = mockFetch({ id: 5 }, 201);
      globalThis.fetch = fetchMock;

      await adapter.addComment(pr, 'Hello from Teams!');

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(`${prUrl()}/comments`);
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.content.raw).toBe('Hello from Teams!');
    });
  });

  describe('updateDescription', () => {
    it('uses comment fallback and returns false', async () => {
      const fetchMock = mockFetch({ id: 6 }, 201);
      globalThis.fetch = fetchMock;

      const result = await adapter.updateDescription(pr, 'Teams thread: https://...');

      expect(result).toBe(false);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(`${prUrl()}/comments`);
      const body = JSON.parse(opts.body);
      expect(body.content.raw).toBe('Teams thread: https://...');
    });
  });

  describe('getChangedFiles', () => {
    it('returns file paths from diffstat response', async () => {
      const fetchMock = mockFetch({
        values: [
          { new: { path: 'src/index.ts' }, old: { path: 'src/index.ts' } },
          { new: { path: 'src/utils.ts' }, old: null },
        ],
        next: undefined,
      });
      globalThis.fetch = fetchMock;

      const files = await adapter.getChangedFiles(pr);

      expect(files).toEqual(['src/index.ts', 'src/utils.ts']);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe(`${prUrl()}/diffstat`);
    });

    it('handles pagination by following next links', async () => {
      const fetchMock = mockFetchSequence([
        {
          body: {
            values: [{ new: { path: 'file1.ts' } }],
            next: `${prUrl()}/diffstat?page=2`,
          },
        },
        {
          body: {
            values: [{ new: { path: 'file2.ts' } }],
          },
        },
      ]);
      globalThis.fetch = fetchMock;

      const files = await adapter.getChangedFiles(pr);

      expect(files).toEqual(['file1.ts', 'file2.ts']);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('uses old path for deleted files', async () => {
      const fetchMock = mockFetch({
        values: [{ new: null, old: { path: 'deleted-file.ts' } }],
      });
      globalThis.fetch = fetchMock;

      const files = await adapter.getChangedFiles(pr);

      expect(files).toEqual(['deleted-file.ts']);
    });
  });

  describe('error handling', () => {
    it('throws AdapterApiError on non-2xx responses', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      });

      await expect(adapter.addComment(pr, 'test')).rejects.toThrow(AdapterApiError);
      await expect(adapter.addComment(pr, 'test')).rejects.toMatchObject({
        statusCode: 403,
        provider: 'bitbucket',
      });
    });

    it('throws AdapterApiError with 404 when PR not found', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
      });

      await expect(adapter.getChangedFiles(pr)).rejects.toThrow(AdapterApiError);
    });

    it('includes error message from the response body', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Invalid credentials'),
      });

      try {
        await adapter.addComment(pr, 'test');
      } catch (e) {
        expect(e).toBeInstanceOf(AdapterApiError);
        expect((e as AdapterApiError).message).toContain('Invalid credentials');
      }
    });
  });

  describe('request headers', () => {
    it('sends Bearer token and Content-Type on all requests', async () => {
      const fetchMock = mockFetch({ values: [] });
      globalThis.fetch = fetchMock;

      await adapter.getChangedFiles(pr);

      const [, opts] = fetchMock.mock.calls[0];
      expect(opts.headers.Authorization).toBe(`Bearer ${TEST_TOKEN}`);
      expect(opts.headers['Content-Type']).toBe('application/json');
    });
  });
});
