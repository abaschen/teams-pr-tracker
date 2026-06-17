import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { DefaultCredentialManager, buildSecretName } from '@managers/credential-manager.js';

// Mock the circuit breaker repository
vi.mock('@repositories/circuit-breaker-repository.js', () => ({
  loadCircuitBreaker: vi.fn().mockResolvedValue(null),
  recordCircuitFailure: vi.fn().mockResolvedValue({
    PK: 'CIRCUIT#github#org/repo',
    SK: 'BREAKER',
    failureCount: 1,
    lastFailureAt: new Date().toISOString(),
    ttl: 0,
  }),
  recordCircuitSuccess: vi.fn().mockResolvedValue(undefined),
}));

// Mock the SecretsManagerClient
vi.mock('@aws-sdk/client-secrets-manager', async () => {
  const actual = await vi.importActual('@aws-sdk/client-secrets-manager');
  return {
    ...actual,
    SecretsManagerClient: vi.fn().mockImplementation(() => ({
      send: vi.fn(),
    })),
  };
});

describe('CredentialManager', () => {
  let mockSend: ReturnType<typeof vi.fn>;
  let manager: DefaultCredentialManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
    const mockClient = { send: mockSend } as unknown as SecretsManagerClient;
    manager = new DefaultCredentialManager({ secretsManagerClient: mockClient });
  });

  describe('buildSecretName', () => {
    it('should build secret name with provider and repository', () => {
      expect(buildSecretName('github', 'org/my-repo')).toBe('pr-tracker/github/org/my-repo');
    });

    it('should handle bitbucket provider', () => {
      expect(buildSecretName('bitbucket', 'workspace/repo')).toBe(
        'pr-tracker/bitbucket/workspace/repo',
      );
    });

    it('should handle gitlab provider', () => {
      expect(buildSecretName('gitlab', 'group/project')).toBe('pr-tracker/gitlab/group/project');
    });
  });

  describe('getCredentials', () => {
    it('should load and return valid token credentials from Secrets Manager', async () => {
      const secret = {
        type: 'token',
        accessToken: 'ghp_abc123',
      };
      mockSend.mockResolvedValueOnce({ SecretString: JSON.stringify(secret) });

      const credentials = await manager.getCredentials('github', 'org/repo');

      expect(credentials).toEqual({
        type: 'token',
        accessToken: 'ghp_abc123',
        refreshToken: undefined,
        expiresAt: undefined,
      });
      expect(mockSend).toHaveBeenCalledOnce();
    });

    it('should load and return valid oauth credentials with optional fields', async () => {
      const secret = {
        type: 'oauth',
        accessToken: 'gho_token123',
        refreshToken: 'ghr_refresh456',
        expiresAt: '2025-12-31T23:59:59Z',
      };
      mockSend.mockResolvedValueOnce({ SecretString: JSON.stringify(secret) });

      const credentials = await manager.getCredentials('github', 'org/repo');

      expect(credentials).toEqual({
        type: 'oauth',
        accessToken: 'gho_token123',
        refreshToken: 'ghr_refresh456',
        expiresAt: '2025-12-31T23:59:59Z',
      });
    });

    it('should cache credentials and not call Secrets Manager again', async () => {
      const secret = { type: 'token', accessToken: 'cached_token' };
      mockSend.mockResolvedValueOnce({ SecretString: JSON.stringify(secret) });

      const first = await manager.getCredentials('github', 'org/repo');
      const second = await manager.getCredentials('github', 'org/repo');

      expect(first).toEqual(second);
      expect(mockSend).toHaveBeenCalledOnce();
    });

    it('should cache separately per provider/repo combination', async () => {
      const secret1 = { type: 'token', accessToken: 'token1' };
      const secret2 = { type: 'token', accessToken: 'token2' };
      mockSend.mockResolvedValueOnce({ SecretString: JSON.stringify(secret1) });
      mockSend.mockResolvedValueOnce({ SecretString: JSON.stringify(secret2) });

      const cred1 = await manager.getCredentials('github', 'org/repo-a');
      const cred2 = await manager.getCredentials('github', 'org/repo-b');

      expect(cred1.accessToken).toBe('token1');
      expect(cred2.accessToken).toBe('token2');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should throw when SecretString is empty', async () => {
      mockSend.mockResolvedValueOnce({ SecretString: undefined });

      await expect(manager.getCredentials('github', 'org/repo')).rejects.toThrow(
        'No credentials found for provider "github" and repository "org/repo"',
      );
    });

    it('should throw when credential is missing accessToken', async () => {
      const secret = { type: 'token' };
      mockSend.mockResolvedValueOnce({ SecretString: JSON.stringify(secret) });

      await expect(manager.getCredentials('github', 'org/repo')).rejects.toThrow(
        'Invalid credential format',
      );
    });

    it('should throw when credential has invalid type', async () => {
      const secret = { type: 'basic', accessToken: 'abc' };
      mockSend.mockResolvedValueOnce({ SecretString: JSON.stringify(secret) });

      await expect(manager.getCredentials('github', 'org/repo')).rejects.toThrow(
        'Invalid credential type "basic"',
      );
    });

    it('should throw when Secrets Manager call fails', async () => {
      mockSend.mockRejectedValueOnce(new Error('ResourceNotFoundException'));

      await expect(manager.getCredentials('bitbucket', 'workspace/repo')).rejects.toThrow(
        'ResourceNotFoundException',
      );
    });

    it('should use the correct secret name when calling Secrets Manager', async () => {
      const secret = { type: 'token', accessToken: 'tok' };
      mockSend.mockResolvedValueOnce({ SecretString: JSON.stringify(secret) });

      await manager.getCredentials('gitlab', 'group/project');

      const call = mockSend.mock.calls[0][0] as GetSecretValueCommand;
      expect(call.input.SecretId).toBe('pr-tracker/gitlab/group/project');
    });
  });

  describe('isCircuitOpen', () => {
    it('should return false when no failures have been recorded', () => {
      expect(manager.isCircuitOpen('github', 'org/repo')).toBe(false);
    });

    it('should return false after 1 failure (below threshold)', () => {
      manager.recordFailure('github', 'org/repo');

      expect(manager.isCircuitOpen('github', 'org/repo')).toBe(false);
    });

    it('should return false after 2 failures (below threshold)', () => {
      manager.recordFailure('github', 'org/repo');
      manager.recordFailure('github', 'org/repo');

      expect(manager.isCircuitOpen('github', 'org/repo')).toBe(false);
    });

    it('should return true after 3 failures (at threshold)', () => {
      manager.recordFailure('github', 'org/repo');
      manager.recordFailure('github', 'org/repo');
      manager.recordFailure('github', 'org/repo');

      expect(manager.isCircuitOpen('github', 'org/repo')).toBe(true);
    });

    it('should track circuits independently per provider/repo', () => {
      manager.recordFailure('github', 'org/repo-a');
      manager.recordFailure('github', 'org/repo-a');
      manager.recordFailure('github', 'org/repo-a');

      expect(manager.isCircuitOpen('github', 'org/repo-a')).toBe(true);
      expect(manager.isCircuitOpen('github', 'org/repo-b')).toBe(false);
    });
  });

  describe('recordFailure', () => {
    it('should increment failure count on successive calls', () => {
      manager.recordFailure('github', 'org/repo');
      manager.recordFailure('github', 'org/repo');

      // Not yet at threshold
      expect(manager.isCircuitOpen('github', 'org/repo')).toBe(false);
    });

    it('should open circuit after reaching failure threshold', () => {
      manager.recordFailure('github', 'org/repo');
      manager.recordFailure('github', 'org/repo');
      manager.recordFailure('github', 'org/repo');

      expect(manager.isCircuitOpen('github', 'org/repo')).toBe(true);
    });
  });

  describe('recordSuccess', () => {
    it('should reset circuit breaker state', () => {
      manager.recordFailure('github', 'org/repo');
      manager.recordFailure('github', 'org/repo');
      manager.recordFailure('github', 'org/repo');

      expect(manager.isCircuitOpen('github', 'org/repo')).toBe(true);

      manager.recordSuccess('github', 'org/repo');

      expect(manager.isCircuitOpen('github', 'org/repo')).toBe(false);
    });

    it('should allow failures to accumulate again after reset', () => {
      // Open the circuit
      manager.recordFailure('github', 'org/repo');
      manager.recordFailure('github', 'org/repo');
      manager.recordFailure('github', 'org/repo');
      expect(manager.isCircuitOpen('github', 'org/repo')).toBe(true);

      // Reset
      manager.recordSuccess('github', 'org/repo');
      expect(manager.isCircuitOpen('github', 'org/repo')).toBe(false);

      // Single failure doesn't reopen
      manager.recordFailure('github', 'org/repo');
      expect(manager.isCircuitOpen('github', 'org/repo')).toBe(false);
    });
  });

  describe('credential selection by provider and repository', () => {
    it('should select credentials for the exact provider+repo combination', async () => {
      const githubSecret = { type: 'token', accessToken: 'github_token' };
      const bitbucketSecret = { type: 'token', accessToken: 'bitbucket_token' };

      mockSend
        .mockResolvedValueOnce({ SecretString: JSON.stringify(githubSecret) })
        .mockResolvedValueOnce({ SecretString: JSON.stringify(bitbucketSecret) });

      const ghCred = await manager.getCredentials('github', 'org/repo');
      const bbCred = await manager.getCredentials('bitbucket', 'workspace/repo');

      expect(ghCred.accessToken).toBe('github_token');
      expect(bbCred.accessToken).toBe('bitbucket_token');
    });

    it('should support multiple repos for the same provider (up to 50)', async () => {
      // Simulate fetching credentials for multiple repos
      for (let i = 0; i < 5; i++) {
        const secret = { type: 'token', accessToken: `token_${i}` };
        mockSend.mockResolvedValueOnce({ SecretString: JSON.stringify(secret) });
      }

      const results = [];
      for (let i = 0; i < 5; i++) {
        results.push(await manager.getCredentials('github', `org/repo-${i}`));
      }

      for (let i = 0; i < 5; i++) {
        expect(results[i].accessToken).toBe(`token_${i}`);
      }
      expect(mockSend).toHaveBeenCalledTimes(5);
    });
  });
});
