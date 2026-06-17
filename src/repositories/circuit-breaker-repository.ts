/**
 * Circuit Breaker Repository.
 * Persists circuit breaker state in DynamoDB with TTL-based expiry (24 hours).
 */

import { GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../utils/dynamo-client.js';
import type { CircuitBreakerItem } from '../models/credentials.js';

/** TTL duration: 24 hours in seconds */
const CIRCUIT_BREAKER_TTL_SECONDS = 24 * 60 * 60;

/**
 * Builds the composite key for a circuit breaker item.
 * PK: CIRCUIT#{provider}#{repo}
 * SK: BREAKER
 */
export function buildCircuitBreakerKey(provider: string, repositoryFullName: string) {
  return {
    PK: `CIRCUIT#${provider}#${repositoryFullName}`,
    SK: 'BREAKER',
  };
}

/**
 * Loads a circuit breaker state from DynamoDB.
 * Returns null if no circuit breaker state exists (treated as closed circuit).
 */
export async function loadCircuitBreaker(
  provider: string,
  repositoryFullName: string,
): Promise<CircuitBreakerItem | null> {
  const key = buildCircuitBreakerKey(provider, repositoryFullName);

  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: key,
    }),
  );

  return (result.Item as CircuitBreakerItem) ?? null;
}

/**
 * Saves a circuit breaker state to DynamoDB.
 * Sets TTL to 24 hours from the current time, ensuring automatic cleanup
 * of stale circuit breaker records.
 */
export async function saveCircuitBreaker(
  provider: string,
  repositoryFullName: string,
  item: Omit<CircuitBreakerItem, 'PK' | 'SK' | 'ttl'>,
): Promise<void> {
  const key = buildCircuitBreakerKey(provider, repositoryFullName);
  const ttl = Math.floor(Date.now() / 1000) + CIRCUIT_BREAKER_TTL_SECONDS;

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        ...key,
        ...item,
        ttl,
      },
    }),
  );
}

/**
 * Deletes a circuit breaker state from DynamoDB.
 * Used when the circuit closes successfully after a half-open test.
 */
export async function deleteCircuitBreaker(
  provider: string,
  repositoryFullName: string,
): Promise<void> {
  const key = buildCircuitBreakerKey(provider, repositoryFullName);

  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: key,
    }),
  );
}

/**
 * Records a failure in the circuit breaker.
 * Increments failure count and updates lastFailureAt timestamp.
 * If a circuit breaker record doesn't exist, creates one.
 */
export async function recordCircuitFailure(
  provider: string,
  repositoryFullName: string,
): Promise<CircuitBreakerItem> {
  const existing = await loadCircuitBreaker(provider, repositoryFullName);

  const updatedItem: Omit<CircuitBreakerItem, 'PK' | 'SK' | 'ttl'> = {
    failureCount: (existing?.failureCount ?? 0) + 1,
    lastFailureAt: new Date().toISOString(),
    suspendedUntil: existing?.suspendedUntil,
  };

  await saveCircuitBreaker(provider, repositoryFullName, updatedItem);

  const key = buildCircuitBreakerKey(provider, repositoryFullName);
  const ttl = Math.floor(Date.now() / 1000) + CIRCUIT_BREAKER_TTL_SECONDS;

  return {
    ...key,
    ...updatedItem,
    ttl,
  };
}

/**
 * Resets the circuit breaker on a successful API call.
 * Removes the circuit breaker record from DynamoDB.
 */
export async function recordCircuitSuccess(
  provider: string,
  repositoryFullName: string,
): Promise<void> {
  await deleteCircuitBreaker(provider, repositoryFullName);
}
