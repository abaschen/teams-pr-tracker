/**
 * Provider adapter re-exports and shared adapter utilities.
 * The ProviderAdapter interface defines the contract for provider-specific API operations.
 */

export type { ProviderAdapter, PRReference } from '../models/interfaces.js';

/**
 * Error thrown when a provider adapter method is not supported by the target provider.
 */
export class AdapterOperationNotSupportedError extends Error {
  constructor(provider: string, operation: string) {
    super(`Operation "${operation}" is not supported by the ${provider} adapter`);
    this.name = 'AdapterOperationNotSupportedError';
  }
}

/**
 * Error thrown when an adapter encounters an API failure from the provider.
 */
export class AdapterApiError extends Error {
  public readonly statusCode: number;
  public readonly provider: string;

  constructor(provider: string, statusCode: number, message: string) {
    super(`[${provider}] API error (${statusCode}): ${message}`);
    this.name = 'AdapterApiError';
    this.statusCode = statusCode;
    this.provider = provider;
  }
}
