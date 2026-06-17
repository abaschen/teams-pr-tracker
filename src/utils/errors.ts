/**
 * Typed error classes for each failure category in the PR tracker system.
 * Each error extends Error with proper name property and relevant metadata.
 */

/** Error during webhook processing pipeline */
export class WebhookProcessingError extends Error {
  override readonly name = 'WebhookProcessingError';
  readonly provider: string;
  readonly eventType?: string;

  constructor(message: string, provider: string, eventType?: string) {
    super(message);
    this.provider = provider;
    this.eventType = eventType;
  }
}

/** Error for DynamoDB conditional write conflicts */
export class StateConflictError extends Error {
  override readonly name = 'StateConflictError';
  readonly key: string;
  readonly expectedVersion: number;

  constructor(message: string, key: string, expectedVersion: number) {
    super(message);
    this.key = key;
    this.expectedVersion = expectedVersion;
  }
}

/** Error for provider API failures (GitHub, Bitbucket, GitLab) */
export class ProviderApiError extends Error {
  override readonly name = 'ProviderApiError';
  readonly provider: string;
  readonly statusCode?: number;
  readonly operation: string;

  constructor(
    message: string,
    provider: string,
    operation: string,
    statusCode?: number,
  ) {
    super(message);
    this.provider = provider;
    this.operation = operation;
    this.statusCode = statusCode;
  }
}

/** Error for Teams Bot Framework API failures */
export class TeamsApiError extends Error {
  override readonly name = 'TeamsApiError';
  readonly statusCode?: number;
  readonly operation: string;

  constructor(message: string, operation: string, statusCode?: number) {
    super(message);
    this.operation = operation;
    this.statusCode = statusCode;
  }
}

/** Error for missing credentials */
export class CredentialNotFoundError extends Error {
  override readonly name = 'CredentialNotFoundError';
  readonly provider: string;
  readonly repositoryFullName: string;

  constructor(message: string, provider: string, repositoryFullName: string) {
    super(message);
    this.provider = provider;
    this.repositoryFullName = repositoryFullName;
  }
}

/** Error for invalid configuration */
export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError';
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.field = field;
  }
}
