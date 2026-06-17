/**
 * Credential Manager implementation.
 * Loads provider credentials from AWS Secrets Manager and delegates
 * circuit breaker operations to the circuit breaker repository.
 *
 * Credentials are cached in-memory for the duration of a Lambda invocation
 * to minimize Secrets Manager calls.
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import type { Provider } from '../models/events.js';
import type { CredentialManager, ProviderCredentials } from '../models/credentials.js';
import {
  loadCircuitBreaker,
  recordCircuitFailure,
  recordCircuitSuccess,
} from '../repositories/circuit-breaker-repository.js';

/** Configuration for the credential manager */
export interface CredentialManagerConfig {
  /** AWS region for Secrets Manager client */
  region?: string;
  /** Optional custom SecretsManagerClient (useful for testing) */
  secretsManagerClient?: SecretsManagerClient;
}

/** Threshold: 3 failures within 10 minutes opens the circuit */
const FAILURE_THRESHOLD = 3;
/** Suspension duration: 30 minutes in milliseconds */
const SUSPENSION_DURATION_MS = 30 * 60 * 1000;
/** Failure window: 10 minutes in milliseconds */
const FAILURE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Builds the Secrets Manager secret name for a given provider and repository.
 * Convention: pr-tracker/{provider}/{repositoryFullName}
 */
export function buildSecretName(provider: Provider, repositoryFullName: string): string {
  return `pr-tracker/${provider}/${repositoryFullName}`;
}

/**
 * Default implementation of the CredentialManager interface.
 *
 * - Loads credentials from AWS Secrets Manager
 * - Caches credentials in memory to avoid repeated calls within a Lambda invocation
 * - Delegates circuit breaker state to the DynamoDB-backed circuit breaker repository
 */
export class DefaultCredentialManager implements CredentialManager {
  private readonly client: SecretsManagerClient;
  private readonly cache: Map<string, ProviderCredentials> = new Map();

  constructor(config: CredentialManagerConfig = {}) {
    this.client =
      config.secretsManagerClient ??
      new SecretsManagerClient({ region: config.region ?? process.env.AWS_REGION ?? 'us-east-1' });
  }

  /**
   * Retrieves credentials for a specific provider and repository.
   * Results are cached in-memory for the Lambda invocation lifetime.
   *
   * @throws Error if no credentials are found or the secret cannot be parsed
   */
  async getCredentials(
    provider: Provider,
    repositoryFullName: string,
  ): Promise<ProviderCredentials> {
    const cacheKey = `${provider}:${repositoryFullName}`;

    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const secretName = buildSecretName(provider, repositoryFullName);

    const command = new GetSecretValueCommand({ SecretId: secretName });
    const response = await this.client.send(command);

    if (!response.SecretString) {
      throw new Error(
        `No credentials found for provider "${provider}" and repository "${repositoryFullName}"`,
      );
    }

    const parsed = JSON.parse(response.SecretString) as Record<string, unknown>;
    const credentials = this.validateCredentials(parsed, provider, repositoryFullName);

    this.cache.set(cacheKey, credentials);
    return credentials;
  }

  /**
   * Checks if the circuit breaker is open (suspended) for a given provider/repo combination.
   * Uses in-memory state recorded during the current invocation.
   *
   * Note: This is a synchronous check against a local circuit breaker state cache.
   * For a full DynamoDB-backed check, use isCircuitOpenAsync.
   */
  isCircuitOpen(provider: Provider, repositoryFullName: string): boolean {
    // Synchronous check: we only know if the circuit was opened during this invocation
    // via recordFailure calls. For a persistent check, callers should use isCircuitOpenAsync.
    const key = `${provider}:${repositoryFullName}`;
    const state = this.circuitState.get(key);
    if (!state) {
      return false;
    }
    if (state.suspendedUntil && new Date(state.suspendedUntil).getTime() > Date.now()) {
      return true;
    }
    return false;
  }

  /**
   * Async version that checks DynamoDB for circuit breaker state.
   * Useful when you need to check persistent state across invocations.
   */
  async isCircuitOpenAsync(provider: Provider, repositoryFullName: string): Promise<boolean> {
    const circuitBreaker = await loadCircuitBreaker(provider, repositoryFullName);
    if (!circuitBreaker) {
      return false;
    }
    if (
      circuitBreaker.suspendedUntil &&
      new Date(circuitBreaker.suspendedUntil).getTime() > Date.now()
    ) {
      return true;
    }
    // Check if failures within the window have reached threshold
    if (circuitBreaker.failureCount >= FAILURE_THRESHOLD) {
      const lastFailureTime = new Date(circuitBreaker.lastFailureAt).getTime();
      if (Date.now() - lastFailureTime < FAILURE_WINDOW_MS) {
        return true;
      }
    }
    return false;
  }

  /**
   * Records an authentication failure for a provider/repo combination.
   * Delegates to the circuit breaker repository and updates local state.
   * If the failure threshold is reached within the failure window, the circuit opens.
   */
  recordFailure(provider: Provider, repositoryFullName: string): void {
    const key = `${provider}:${repositoryFullName}`;
    const existing = this.circuitState.get(key);
    const now = new Date();

    let failureCount = 1;
    if (existing) {
      const lastFailureTime = new Date(existing.lastFailureAt).getTime();
      // If within the failure window, increment; otherwise, reset
      if (now.getTime() - lastFailureTime < FAILURE_WINDOW_MS) {
        failureCount = existing.failureCount + 1;
      }
    }

    const suspendedUntil =
      failureCount >= FAILURE_THRESHOLD
        ? new Date(now.getTime() + SUSPENSION_DURATION_MS).toISOString()
        : existing?.suspendedUntil;

    this.circuitState.set(key, {
      failureCount,
      lastFailureAt: now.toISOString(),
      suspendedUntil,
    });

    // Fire-and-forget: persist to DynamoDB via repository
    void recordCircuitFailure(provider, repositoryFullName);
  }

  /**
   * Records a successful API call for a provider/repo combination.
   * Resets the circuit breaker state by delegating to the repository.
   */
  recordSuccess(provider: Provider, repositoryFullName: string): void {
    const key = `${provider}:${repositoryFullName}`;
    this.circuitState.delete(key);

    // Fire-and-forget: persist to DynamoDB via repository
    void recordCircuitSuccess(provider, repositoryFullName);
  }

  /**
   * Validates and transforms a parsed secret into ProviderCredentials.
   */
  private validateCredentials(
    parsed: Record<string, unknown>,
    provider: Provider,
    repositoryFullName: string,
  ): ProviderCredentials {
    const type = parsed.type as string | undefined;
    const accessToken = parsed.accessToken as string | undefined;

    if (!type || !accessToken) {
      throw new Error(
        `Invalid credential format for provider "${provider}" and repository "${repositoryFullName}": missing "type" or "accessToken"`,
      );
    }

    if (type !== 'oauth' && type !== 'token') {
      throw new Error(
        `Invalid credential type "${type}" for provider "${provider}" and repository "${repositoryFullName}": must be "oauth" or "token"`,
      );
    }

    return {
      type,
      accessToken,
      refreshToken: parsed.refreshToken as string | undefined,
      expiresAt: parsed.expiresAt as string | undefined,
    };
  }

  /** In-memory circuit breaker state for the current invocation */
  private readonly circuitState: Map<
    string,
    { failureCount: number; lastFailureAt: string; suspendedUntil?: string }
  > = new Map();
}
