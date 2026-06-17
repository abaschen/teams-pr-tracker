/**
 * Rule Repository.
 * Loads annotation rules from DynamoDB for rule evaluation.
 */

import { QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../utils/dynamo-client.js';
import type { AnnotationRule, AnnotationRuleItem } from '../models/rules.js';

/**
 * Converts a DynamoDB AnnotationRuleItem to the domain AnnotationRule type.
 */
function toDomainRule(item: AnnotationRuleItem): AnnotationRule {
  const ruleId = item.PK.replace('RULE#', '');
  return {
    id: ruleId,
    name: item.name,
    conditions: item.conditions,
    validationTeams: item.validationTeams,
    approvalChain: item.approvalChain,
  };
}

/**
 * Loads all annotation rules from DynamoDB.
 * Uses a scan with filter on PK prefix since rules use PK pattern RULE#{ruleId}.
 */
export async function loadAllRules(): Promise<AnnotationRule[]> {
  const rules: AnnotationRule[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: 'SK = :sk',
        ExpressionAttributeValues: { ':sk': 'CONFIG' },
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    if (result.Items) {
      for (const item of result.Items) {
        const ruleItem = item as unknown as AnnotationRuleItem;
        // Only include items with RULE# prefix
        if (ruleItem.PK.startsWith('RULE#')) {
          rules.push(toDomainRule(ruleItem));
        }
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return rules;
}

/**
 * Loads a single annotation rule by ID.
 * Returns null if the rule does not exist.
 */
export async function loadRuleById(ruleId: string): Promise<AnnotationRule | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `RULE#${ruleId}`,
        SK: 'CONFIG',
      },
    }),
  );

  if (!result.Item) {
    return null;
  }

  return toDomainRule(result.Item as unknown as AnnotationRuleItem);
}
