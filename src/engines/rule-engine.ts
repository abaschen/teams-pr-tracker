/**
 * Rule Engine - evaluates annotation rules against PR metadata.
 * Determines which validation teams are required for a PR based on
 * file paths, repository names, branch names, and PR labels.
 */

import picomatch from 'picomatch';
import type { NormalizedPREvent } from '../models/events.js';
import type {
  AnnotationRule,
  ApprovalChainConfig,
  RuleCondition,
  RuleEvaluationResult,
  ValidationTeamConfig,
} from '../models/rules.js';
import type { RuleEngine } from '../models/interfaces.js';

/**
 * Checks if a single condition is satisfied by the PR event.
 * All condition types use AND logic within a rule.
 */
function matchCondition(condition: RuleCondition, event: NormalizedPREvent): boolean {
  switch (condition.type) {
    case 'file_path': {
      // At least one changed file must match the glob pattern
      const files = event.changedFiles ?? [];
      if (files.length === 0) return false;
      const isMatch = picomatch(condition.pattern);
      return files.some((file) => isMatch(file));
    }

    case 'repository': {
      // Exact match against repositoryFullName
      return event.repositoryFullName === condition.pattern;
    }

    case 'branch': {
      // Glob match against event branch
      const isMatch = picomatch(condition.pattern);
      return isMatch(event.branch);
    }

    case 'label': {
      // At least one PR label must match the condition pattern
      const labels = event.labels ?? [];
      if (labels.length === 0) return false;
      return labels.some((label) => label === condition.pattern);
    }

    default:
      return false;
  }
}

/**
 * Checks if all conditions in a rule are satisfied by the event (AND logic).
 * A rule with no conditions always matches.
 */
function matchRule(rule: AnnotationRule, event: NormalizedPREvent): boolean {
  return rule.conditions.every((condition) => matchCondition(condition, event));
}

/**
 * Deduplicates validation teams by teamName, keeping the first occurrence.
 */
function deduplicateTeams(teams: ValidationTeamConfig[]): ValidationTeamConfig[] {
  const seen = new Set<string>();
  const result: ValidationTeamConfig[] = [];

  for (const team of teams) {
    if (!seen.has(team.teamName)) {
      seen.add(team.teamName);
      result.push(team);
    }
  }

  return result;
}

/**
 * Default implementation of the RuleEngine interface.
 * Evaluates annotation rules against normalized PR events to determine
 * which validation teams are required.
 */
export class DefaultRuleEngine implements RuleEngine {
  /**
   * Evaluates all rules against the given PR event.
   *
   * - Each rule's conditions are checked with AND logic (all must match)
   * - Matched rules' validation teams are aggregated as a union (deduplicated by teamName)
   * - Approval chains from matched rules are collected
   */
  evaluate(event: NormalizedPREvent, rules: AnnotationRule[]): RuleEvaluationResult {
    const matchedRules: AnnotationRule[] = [];
    const allTeams: ValidationTeamConfig[] = [];
    const approvalChains: ApprovalChainConfig[] = [];

    for (const rule of rules) {
      if (matchRule(rule, event)) {
        matchedRules.push(rule);
        allTeams.push(...rule.validationTeams);

        if (rule.approvalChain) {
          approvalChains.push(rule.approvalChain);
        }
      }
    }

    return {
      matchedRules,
      requiredTeams: deduplicateTeams(allTeams),
      approvalChains,
    };
  }
}
