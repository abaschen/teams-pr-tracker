/**
 * Unit tests for the webhook processor handler.
 *
 * Covers:
 * - Valid requests for each provider (mock signature verification to pass)
 * - Invalid signature returns 401
 * - Malformed JSON body returns 400
 * - Missing body returns 400
 * - Unrecognized event type returns 200
 * - Unknown provider path returns 400
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { APIGatewayProxyEvent } from '../../src/models/api-gateway.js';

// Create hoisted mocks that are available when vi.mock factories execute
const { mockVerify, mockGetNormalizer } = vi.hoisted(() => ({
  mockVerify: vi.fn().mockReturnValue(true),
  mockGetNormalizer: vi.fn(),
}));

// Mock the signature verifier with a proper class
vi.mock('../../src/handlers/signature-verifier.js', () => ({
  SignatureVerifierImpl: class {
    verify(...args: any[]) {
      return mockVerify(...args);
    }
  },
}));

// Mock normalizer factory
vi.mock('../../src/normalizers/normalizer-factory.js', () => ({
  getNormalizer: mockGetNormalizer,
}));

import { handler, extractProvider } from '../../src/handlers/webhook-processor.js';



function createEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/webhook/github',
    headers: {
      'x-hub-signature-256': 'sha256=abc123',
      'x-github-event': 'pull_request',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      action: 'opened',
      pull_request: {
        number: 1,
        title: 'Test PR',
        html_url: 'https://github.com/org/repo/pull/1',
        user: { login: 'testuser' },
        head: { ref: 'feature-branch' },
        base: { ref: 'main' },
      },
      repository: {
        name: 'repo',
        full_name: 'org/repo',
      },
    }),
    pathParameters: null,
    queryStringParameters: null,
    requestContext: {
      requestId: 'test-request-id',
      stage: 'test',
    },
    ...overrides,
  };
}

describe('extractProvider', () => {
  it('extracts github from /webhook/github', () => {
    expect(extractProvider('/webhook/github')).toBe('github');
  });

  it('extracts bitbucket from /webhook/bitbucket', () => {
    expect(extractProvider('/webhook/bitbucket')).toBe('bitbucket');
  });

  it('extracts gitlab from /webhook/gitlab', () => {
    expect(extractProvider('/webhook/gitlab')).toBe('gitlab');
  });

  it('handles trailing slashes', () => {
    expect(extractProvider('/webhook/github/')).toBe('github');
  });

  it('handles nested paths', () => {
    expect(extractProvider('/api/v1/webhook/github')).toBe('github');
  });

  it('converts to lowercase', () => {
    expect(extractProvider('/webhook/GitHub')).toBe('github');
  });

  it('returns null for empty path', () => {
    expect(extractProvider('/')).toBe(null);
  });
});

describe('webhook-processor handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      GITHUB_WEBHOOK_SECRET: 'github-secret',
      BITBUCKET_WEBHOOK_SECRET: 'bitbucket-secret',
      GITLAB_WEBHOOK_SECRET: 'gitlab-secret',
    };

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('valid requests for each provider', () => {
    it('processes a valid GitHub webhook event', async () => {
      mockGetNormalizer.mockReturnValue(() => ({
        provider: 'github',
        eventType: 'pr_opened',
        prId: '1',
        prTitle: 'Test PR',
        prUrl: 'https://github.com/org/repo/pull/1',
        repositoryName: 'repo',
        repositoryFullName: 'org/repo',
        author: 'testuser',
        branch: 'feature-branch',
        baseBranch: 'main',
        timestamp: new Date().toISOString(),
      }));

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Webhook processed successfully');
      expect(body.provider).toBe('github');
      expect(body.eventType).toBe('pr_opened');
    });

    it('processes a valid Bitbucket webhook event', async () => {
      mockGetNormalizer.mockReturnValue(() => ({
        provider: 'bitbucket',
        eventType: 'pr_opened',
        prId: '42',
        prTitle: 'BB PR',
        prUrl: 'https://bitbucket.org/org/repo/pull-requests/42',
        repositoryName: 'repo',
        repositoryFullName: 'org/repo',
        author: 'bbuser',
        branch: 'feature',
        baseBranch: 'main',
        timestamp: new Date().toISOString(),
      }));

      const event = createEvent({
        path: '/webhook/bitbucket',
        headers: {
          'x-hub-signature': 'abc123hex',
          'x-event-key': 'pullrequest:created',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          pullrequest: {
            id: 42,
            title: 'BB PR',
            links: { html: { href: 'https://bitbucket.org/org/repo/pull-requests/42' } },
            author: { display_name: 'BB User', nickname: 'bbuser' },
            source: { branch: { name: 'feature' } },
            destination: { branch: { name: 'main' } },
          },
          repository: { name: 'repo', full_name: 'org/repo' },
        }),
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Webhook processed successfully');
      expect(body.provider).toBe('bitbucket');
    });

    it('processes a valid GitLab webhook event', async () => {
      mockGetNormalizer.mockReturnValue(() => ({
        provider: 'gitlab',
        eventType: 'pr_opened',
        prId: '7',
        prTitle: 'GL MR',
        prUrl: 'https://gitlab.com/org/repo/-/merge_requests/7',
        repositoryName: 'repo',
        repositoryFullName: 'org/repo',
        author: 'gluser',
        branch: 'feature',
        baseBranch: 'main',
        timestamp: new Date().toISOString(),
      }));

      const event = createEvent({
        path: '/webhook/gitlab',
        headers: {
          'x-gitlab-token': 'gitlab-secret',
          'x-gitlab-event': 'Merge Request Hook',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          object_kind: 'merge_request',
          object_attributes: {
            iid: 7,
            title: 'GL MR',
            url: 'https://gitlab.com/org/repo/-/merge_requests/7',
            action: 'open',
            source_branch: 'feature',
            target_branch: 'main',
          },
          user: { username: 'gluser', name: 'GL User' },
          project: { name: 'repo', path_with_namespace: 'org/repo' },
        }),
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Webhook processed successfully');
      expect(body.provider).toBe('gitlab');
    });
  });

  describe('invalid signature returns 401', () => {
    it('returns 401 when signature verification fails', async () => {
      mockVerify.mockReturnValueOnce(false);

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('Invalid webhook signature');
    });

    it('returns 401 when webhook secret is not configured', async () => {
      delete process.env.GITHUB_WEBHOOK_SECRET;

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('secret');
    });
  });

  describe('malformed JSON body returns 400', () => {
    it('returns 400 for invalid JSON', async () => {
      const event = createEvent({
        body: '{not valid json!!!}}}',
      });

      // Override verifier to pass for this test
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('Malformed JSON');
    });
  });

  describe('missing body returns 400', () => {
    it('returns 400 when body is null', async () => {
      const event = createEvent({ body: null });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('Missing request body');
    });

    it('returns 400 when body is empty string', async () => {
      const event = createEvent({ body: '' });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('Missing request body');
    });

    it('returns 400 when body is whitespace only', async () => {
      const event = createEvent({ body: '   ' });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('Missing request body');
    });
  });

  describe('unrecognized event type returns 200', () => {
    it('returns 200 with no action when normalizer returns null', async () => {
      mockGetNormalizer.mockReturnValue(() => null);

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('no action');
    });
  });

  describe('unknown provider path returns 400', () => {
    it('returns 400 for unsupported provider', async () => {
      const event = createEvent({ path: '/webhook/svn' });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('Unknown provider');
    });

    it('returns 400 for empty path', async () => {
      const event = createEvent({ path: '/' });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('Unknown provider');
    });
  });
});
