/**
 * Smoke tests for the Lambda handler entry point (src/handlers/index.ts).
 *
 * Verifies:
 * - handler is exported and is a function
 * - processEvent is exported and is a function
 * - handler delegates to webhook-processor correctly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from '../../src/models/api-gateway.js';

// Hoist mocks for modules used by the handler
const { mockVerify, mockGetNormalizer } = vi.hoisted(() => ({
  mockVerify: vi.fn().mockReturnValue(true),
  mockGetNormalizer: vi.fn(),
}));

// Mock signature verifier
vi.mock('../../src/handlers/signature-verifier.js', () => ({
  SignatureVerifierImpl: class {
    verify(...args: unknown[]) {
      return mockVerify(...args);
    }
  },
}));

// Mock normalizer factory
vi.mock('../../src/normalizers/normalizer-factory.js', () => ({
  getNormalizer: mockGetNormalizer,
}));

// Mock repositories (avoid real DynamoDB calls)
vi.mock('../../src/repositories/pr-state-repository.js', () => ({
  loadPRState: vi.fn().mockResolvedValue(null),
  savePRState: vi.fn().mockResolvedValue({ success: true }),
  savePRStateWithRetry: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../src/repositories/rule-repository.js', () => ({
  loadAllRules: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/repositories/circuit-breaker-repository.js', () => ({
  loadCircuitBreaker: vi.fn().mockResolvedValue(null),
  saveCircuitBreaker: vi.fn().mockResolvedValue(undefined),
  deleteCircuitBreaker: vi.fn().mockResolvedValue(undefined),
  recordCircuitFailure: vi.fn().mockResolvedValue(undefined),
  recordCircuitSuccess: vi.fn().mockResolvedValue(undefined),
}));

// Mock credential manager to avoid Secrets Manager calls
vi.mock('../../src/managers/credential-manager.js', () => ({
  DefaultCredentialManager: class {
    async getCredentials() {
      return { type: 'token', accessToken: 'mock-token' };
    }
    isCircuitOpen() {
      return false;
    }
    recordFailure() {}
    recordSuccess() {}
  },
}));

// Mock channel mapper to avoid SSM calls
vi.mock('../../src/managers/channel-mapper.js', () => ({
  ChannelMapper: class {
    async resolveChannel() {
      return { channelId: 'test-channel', serviceUrl: 'https://test.service' };
    }
  },
}));

// Mock thread manager to avoid Teams API calls
vi.mock('../../src/managers/thread-manager.js', () => ({
  TeamsThreadManager: class {
    async createThread() {
      return { conversationId: 'conv-1', activityId: 'act-1', channelId: 'ch-1', serviceUrl: 'https://svc' };
    }
    async postUpdate() {}
    async updateMentions() {}
    async updateReadinessReaction() {}
    async closeThread() {}
  },
}));

// Mock DynamoDB client
vi.mock('../../src/utils/dynamo-client.js', () => ({
  docClient: { send: vi.fn() },
  TABLE_NAME: 'test-table',
}));

// Mock AWS SDK clients
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {},
  GetSecretValueCommand: class {},
}));

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class {},
  GetParameterCommand: class {},
}));

import { handler, processEvent } from '../../src/handlers/index.js';

describe('Lambda handler entry point', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports handler as a function', () => {
    expect(handler).toBeDefined();
    expect(typeof handler).toBe('function');
  });

  it('exports processEvent as a function', () => {
    expect(processEvent).toBeDefined();
    expect(typeof processEvent).toBe('function');
  });

  it('handler returns 400 for unknown provider', async () => {
    const event: APIGatewayProxyEvent = {
      path: '/webhook/unknown',
      httpMethod: 'POST',
      headers: {},
      body: '{}',
      queryStringParameters: null,
      pathParameters: null,
      requestContext: { requestId: 'test-123' } as any,
      isBase64Encoded: false,
    };

    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });

  it('handler returns 401 for invalid signature', async () => {
    mockVerify.mockReturnValueOnce(false);

    const event: APIGatewayProxyEvent = {
      path: '/webhook/github',
      httpMethod: 'POST',
      headers: { 'x-hub-signature-256': 'sha256=invalid' },
      body: JSON.stringify({ action: 'opened', pull_request: {} }),
      queryStringParameters: null,
      pathParameters: null,
      requestContext: { requestId: 'test-456' } as any,
      isBase64Encoded: false,
    };

    process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
    const result = await handler(event);
    expect(result.statusCode).toBe(401);
    delete process.env.GITHUB_WEBHOOK_SECRET;
  });

  it('handler processes a valid GitHub webhook and returns 200', async () => {
    mockVerify.mockReturnValueOnce(true);
    mockGetNormalizer.mockReturnValueOnce(() => ({
      provider: 'github',
      eventType: 'pr_opened',
      prId: '42',
      prTitle: 'Test PR',
      prUrl: 'https://github.com/org/repo/pull/42',
      repositoryName: 'repo',
      repositoryFullName: 'org/repo',
      author: 'dev',
      branch: 'feature/test',
      baseBranch: 'main',
      timestamp: new Date().toISOString(),
    }));

    const event: APIGatewayProxyEvent = {
      path: '/webhook/github',
      httpMethod: 'POST',
      headers: {
        'x-hub-signature-256': 'sha256=valid',
        'x-github-event': 'pull_request',
      },
      body: JSON.stringify({
        action: 'opened',
        pull_request: { number: 42, title: 'Test PR' },
        repository: { name: 'repo', full_name: 'org/repo' },
      }),
      queryStringParameters: null,
      pathParameters: null,
      requestContext: { requestId: 'test-789' } as any,
      isBase64Encoded: false,
    };

    process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    delete process.env.GITHUB_WEBHOOK_SECRET;
  });
});
