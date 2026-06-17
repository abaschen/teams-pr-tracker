/**
 * PR State Repository.
 * Implements load, save (with conditional writes for optimistic concurrency), and delete
 * operations for PR state items in DynamoDB.
 */

import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../utils/dynamo-client.js';
import type { PRStateItem } from '../models/state.js';

/** Result types for save operations */
export type SaveResult =
  | { success: true }
  | { success: false; reason: 'conflict'; currentState: PRStateItem | null };

/** Maximum number of retry attempts for conditional write conflicts */
const MAX_CONFLICT_RETRIES = 3;

/**
 * Builds the composite key for a PR state item.
 * PK: PR#{provider}#{repo}#{prNumber}
 * SK: STATE
 */
export function buildPRStateKey(provider: string, repositoryFullName: string, prNumber: string) {
  return {
    PK: `PR#${provider}#${repositoryFullName}#${prNumber}`,
    SK: 'STATE',
  };
}

/**
 * Loads a PR state item from DynamoDB.
 * Returns null if the item does not exist.
 */
export async function loadPRState(
  provider: string,
  repositoryFullName: string,
  prNumber: string,
): Promise<PRStateItem | null> {
  const key = buildPRStateKey(provider, repositoryFullName, prNumber);

  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: key,
      ConsistentRead: true,
    }),
  );

  return (result.Item as PRStateItem) ?? null;
}

/**
 * Saves a PR state item to DynamoDB using conditional writes for optimistic concurrency.
 *
 * For new items (version === 1): uses attribute_not_exists condition to prevent overwrites.
 * For existing items: uses version condition expression to prevent lost updates.
 *
 * On success, the item's version is incremented.
 * On conflict, returns the current state so the caller can retry with fresh data.
 */
export async function savePRState(state: PRStateItem): Promise<SaveResult> {
  const updatedState: PRStateItem = {
    ...state,
    version: state.version + 1,
    updatedAt: new Date().toISOString(),
  };

  try {
    if (state.version === 0) {
      // New item: ensure no existing item with this key
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: updatedState,
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
    } else {
      // Existing item: conditional write on version
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: updatedState,
          ConditionExpression: '#v = :expectedVersion',
          ExpressionAttributeNames: { '#v': 'version' },
          ExpressionAttributeValues: { ':expectedVersion': state.version },
        }),
      );
    }

    return { success: true };
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      // Conflict: re-read current state for the caller
      const currentState = await loadPRState(
        state.provider,
        state.repositoryFullName,
        state.prNumber,
      );
      return { success: false, reason: 'conflict', currentState };
    }
    throw error;
  }
}

/**
 * Attempts to save PR state with automatic conflict retry.
 *
 * On conflict, re-reads state and calls the provided reprocess function
 * to compute a new state, then retries the save. Repeats up to MAX_CONFLICT_RETRIES times.
 *
 * @param state - The initial state to save
 * @param reprocess - Function that takes conflicting current state and returns new state to save
 * @returns SaveResult indicating success or final conflict after all retries exhausted
 */
export async function savePRStateWithRetry(
  state: PRStateItem,
  reprocess: (currentState: PRStateItem) => PRStateItem,
): Promise<SaveResult> {
  let currentAttempt = state;

  for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt++) {
    const result = await savePRState(currentAttempt);

    if (result.success) {
      return result;
    }

    // Conflict - use fresh state from DynamoDB and reprocess
    if (result.currentState === null) {
      // Item was deleted between our read and write; cannot recover
      return result;
    }

    currentAttempt = reprocess(result.currentState);
  }

  // All retries exhausted
  const finalState = await loadPRState(
    currentAttempt.provider,
    currentAttempt.repositoryFullName,
    currentAttempt.prNumber,
  );
  return { success: false, reason: 'conflict', currentState: finalState };
}

/**
 * Deletes a PR state item from DynamoDB.
 */
export async function deletePRState(
  provider: string,
  repositoryFullName: string,
  prNumber: string,
): Promise<void> {
  const key = buildPRStateKey(provider, repositoryFullName, prNumber);

  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: key,
    }),
  );
}
