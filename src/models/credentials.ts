/**
 * Credential management types for multi-provider authentication.
 * Includes credential storage and circuit breaker state for handling auth failures.
 */

import type { Provider } from './events.js';

/** Authentication type for provider credentials */
export type AuthType = 'oauth' | 'token';

/** Provider credentials used for API authentication */
export interface ProviderCredentials {
  type: AuthType;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

/**
 * DynamoDB Circuit Breaker Item.
 * PK: CIRCUIT#{provider}#{repo}
 * SK: BREAKER
 *
 * Tracks consecutive auth failures and suspends API calls when threshold is reached.
 */
export interface CircuitBreakerItem {
  PK: string;
  SK: string;
  failureCount: number;
  lastFailureAt: string;
  suspendedUntil?: string; // ISO timestamp when circuit closes
  ttl: number; // Auto-cleanup after 24 hours of inactivity
}

/** Circuit breaker states */
export type CircuitState = 'closed' | 'open' | 'half-open';

/** Credential manager interface for multi-provider auth */
export interface CredentialManager {
  getCredentials(provider: Provider, repositoryFullName: string): Promise<ProviderCredentials>;
  isCircuitOpen(provider: Provider, repositoryFullName: string): boolean;
  recordFailure(provider: Provider, repositoryFullName: string): void;
  recordSuccess(provider: Provider, repositoryFullName: string): void;
}
