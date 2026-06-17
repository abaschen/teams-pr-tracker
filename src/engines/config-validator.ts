/**
 * Configuration Validator - validates annotation rule configurations.
 * Enforces bounds on validation teams and approval chains, rejects invalid
 * glob patterns, and ensures referential integrity.
 */

import picomatch from 'picomatch';
import type { AnnotationRule } from '../models/rules.js';

/** A single validation error with field location and message */
export interface ValidationError {
  field: string;
  message: string;
}

/** Result of validating an annotation rule configuration */
export interface ConfigValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** Maximum number of validation teams per rule */
const MAX_VALIDATION_TEAMS = 20;

/** Maximum number of teams in an approval chain */
const MAX_APPROVAL_CHAIN_LENGTH = 10;

/**
 * Validates an annotation rule configuration.
 * Returns all errors at once (does not short-circuit on first error).
 */
export function validateAnnotationRule(rule: AnnotationRule): ConfigValidationResult {
  const errors: ValidationError[] = [];

  // Validate validation teams count (1–20)
  if (rule.validationTeams.length === 0) {
    errors.push({
      field: 'validationTeams',
      message: 'At least 1 validation team is required',
    });
  } else if (rule.validationTeams.length > MAX_VALIDATION_TEAMS) {
    errors.push({
      field: 'validationTeams',
      message: `Maximum ${MAX_VALIDATION_TEAMS} validation teams allowed, got ${rule.validationTeams.length}`,
    });
  }

  // Validate approval chain if present
  if (rule.approvalChain) {
    const chainTeams = rule.approvalChain.orderedTeams;

    // Chain length must be 1–10
    if (chainTeams.length === 0) {
      errors.push({
        field: 'approvalChain.orderedTeams',
        message: 'Approval chain must have at least 1 team',
      });
    } else if (chainTeams.length > MAX_APPROVAL_CHAIN_LENGTH) {
      errors.push({
        field: 'approvalChain.orderedTeams',
        message: `Maximum ${MAX_APPROVAL_CHAIN_LENGTH} teams in approval chain allowed, got ${chainTeams.length}`,
      });
    }

    // Every team in the chain must reference an existing validation team
    const validTeamNames = new Set(rule.validationTeams.map((t) => t.teamName));
    for (const teamName of chainTeams) {
      if (!validTeamNames.has(teamName)) {
        errors.push({
          field: 'approvalChain.orderedTeams',
          message: `Team "${teamName}" in approval chain does not exist in validationTeams`,
        });
      }
    }
  }

  // Validate conditions
  for (let i = 0; i < rule.conditions.length; i++) {
    const condition = rule.conditions[i];

    // Pattern must not be empty
    if (!condition.pattern || condition.pattern.trim() === '') {
      errors.push({
        field: `conditions[${i}].pattern`,
        message: 'Condition pattern must not be empty',
      });
      continue; // Skip glob validation for empty patterns
    }

    // For file_path and branch conditions, validate glob pattern
    if (condition.type === 'file_path' || condition.type === 'branch') {
      try {
        picomatch(condition.pattern, { strictBrackets: true });
      } catch {
        errors.push({
          field: `conditions[${i}].pattern`,
          message: `Invalid glob pattern: "${condition.pattern}"`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
