/**
 * Annotation rule types for configuring validation team requirements.
 * Rules define conditions that match PRs and specify required teams and approval chains.
 */

/** Types of conditions that can be evaluated against PR metadata */
export type RuleConditionType = 'file_path' | 'repository' | 'branch' | 'label';

/** A single condition within an annotation rule */
export interface RuleCondition {
  type: RuleConditionType;
  pattern: string; // glob pattern for file_path and branch; exact match for repository; label name for label
}

/** Configuration for a validation team assigned to a rule */
export interface ValidationTeamConfig {
  teamName: string;
  teamsTagId: string; // Microsoft Teams tag ID for @mentions
  reviewers: string[]; // Provider usernames to assign
}

/** Defines ordering constraints between validation teams */
export interface ApprovalChainConfig {
  id: string;
  orderedTeams: string[]; // max length 10
}

/** A complete annotation rule configuration */
export interface AnnotationRule {
  id: string;
  name: string;
  conditions: RuleCondition[];
  validationTeams: ValidationTeamConfig[];
  approvalChain?: ApprovalChainConfig;
}

/** Result of evaluating annotation rules against a PR */
export interface RuleEvaluationResult {
  matchedRules: AnnotationRule[];
  requiredTeams: ValidationTeamConfig[];
  approvalChains: ApprovalChainConfig[];
}

/**
 * DynamoDB Annotation Rule Item.
 * PK: RULE#{ruleId}
 * SK: CONFIG
 */
export interface AnnotationRuleItem {
  PK: string;
  SK: string;
  name: string;
  conditions: RuleCondition[];
  validationTeams: ValidationTeamConfig[];
  approvalChain?: ApprovalChainConfig;
  createdAt: string;
  updatedAt: string;
}
