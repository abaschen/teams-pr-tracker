/**
 * DynamoDB client configuration.
 * Provides a configured DynamoDB DocumentClient for use across repositories.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/** Table name sourced from environment variable */
export const TABLE_NAME = process.env.TABLE_NAME ?? 'pr-tracker';

/** Raw DynamoDB client */
const client = new DynamoDBClient({});

/** Document client with marshalling options */
export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});
