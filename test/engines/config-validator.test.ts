import { describe, it, expect } from 'vitest';
import { validateAnnotationRule } from '@engines/config-validator.js';
import type { AnnotationRule } from '@models/rules.js';

/** Helper to create a valid base rule for testing */
function createValidRule(overrides: Partial<AnnotationRule> = {}): AnnotationRule {
  return {
    id: 'rule-1',
    name: 'Test Rule',
    conditions: [{ type: 'file_path', pattern: 'src/**/*.ts' }],
    validationTeams: [
      { teamName: 'team-a', teamsTagId: 'tag-a', reviewers: ['user1'] },
      { teamName: 'team-b', teamsTagId: 'tag-b', reviewers: ['user2'] },
    ],
    ...overrides,
  };
}

describe('config-validator', () => {
  describe('validateAnnotationRule', () => {
    it('should pass for a valid rule', () => {
      const rule = createValidRule();
      const result = validateAnnotationRule(rule);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass for a valid rule with approval chain', () => {
      const rule = createValidRule({
        approvalChain: { id: 'chain-1', orderedTeams: ['team-a', 'team-b'] },
      });
      const result = validateAnnotationRule(rule);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject zero validation teams', () => {
      const rule = createValidRule({ validationTeams: [] });
      const result = validateAnnotationRule(rule);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'validationTeams',
          message: expect.stringContaining('At least 1'),
        }),
      );
    });

    it('should reject more than 20 validation teams', () => {
      const teams = Array.from({ length: 21 }, (_, i) => ({
        teamName: `team-${i}`,
        teamsTagId: `tag-${i}`,
        reviewers: [`user-${i}`],
      }));
      const rule = createValidRule({ validationTeams: teams });
      const result = validateAnnotationRule(rule);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'validationTeams',
          message: expect.stringContaining('20'),
        }),
      );
    });

    it('should accept exactly 20 validation teams', () => {
      const teams = Array.from({ length: 20 }, (_, i) => ({
        teamName: `team-${i}`,
        teamsTagId: `tag-${i}`,
        reviewers: [`user-${i}`],
      }));
      const rule = createValidRule({ validationTeams: teams });
      const result = validateAnnotationRule(rule);

      expect(result.valid).toBe(true);
    });

    it('should reject approval chain with more than 10 teams', () => {
      const teams = Array.from({ length: 11 }, (_, i) => ({
        teamName: `team-${i}`,
        teamsTagId: `tag-${i}`,
        reviewers: [`user-${i}`],
      }));
      const rule = createValidRule({
        validationTeams: teams,
        approvalChain: {
          id: 'chain-1',
          orderedTeams: teams.map((t) => t.teamName),
        },
      });
      const result = validateAnnotationRule(rule);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'approvalChain.orderedTeams',
          message: expect.stringContaining('10'),
        }),
      );
    });

    it('should reject approval chain with zero teams', () => {
      const rule = createValidRule({
        approvalChain: { id: 'chain-1', orderedTeams: [] },
      });
      const result = validateAnnotationRule(rule);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'approvalChain.orderedTeams',
          message: expect.stringContaining('at least 1'),
        }),
      );
    });

    it('should reject approval chain referencing nonexistent team', () => {
      const rule = createValidRule({
        approvalChain: { id: 'chain-1', orderedTeams: ['team-a', 'nonexistent-team'] },
      });
      const result = validateAnnotationRule(rule);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'approvalChain.orderedTeams',
          message: expect.stringContaining('nonexistent-team'),
        }),
      );
    });

    it('should reject empty pattern in conditions', () => {
      const rule = createValidRule({
        conditions: [{ type: 'file_path', pattern: '' }],
      });
      const result = validateAnnotationRule(rule);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'conditions[0].pattern',
          message: expect.stringContaining('must not be empty'),
        }),
      );
    });

    it('should reject whitespace-only pattern in conditions', () => {
      const rule = createValidRule({
        conditions: [{ type: 'branch', pattern: '   ' }],
      });
      const result = validateAnnotationRule(rule);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'conditions[0].pattern',
          message: expect.stringContaining('must not be empty'),
        }),
      );
    });

    it('should reject invalid glob pattern in file_path condition', () => {
      const rule = createValidRule({
        conditions: [{ type: 'file_path', pattern: 'src/**/[unclosed' }],
      });
      const result = validateAnnotationRule(rule);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'conditions[0].pattern',
          message: expect.stringContaining('Invalid glob pattern'),
        }),
      );
    });

    it('should reject invalid glob pattern in branch condition', () => {
      const rule = createValidRule({
        conditions: [{ type: 'branch', pattern: 'release/{unclosed' }],
      });
      const result = validateAnnotationRule(rule);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'conditions[0].pattern',
          message: expect.stringContaining('Invalid glob pattern'),
        }),
      );
    });

    it('should not validate glob patterns for repository or label conditions', () => {
      const rule = createValidRule({
        conditions: [
          { type: 'repository', pattern: 'org/repo' },
          { type: 'label', pattern: 'needs-review' },
        ],
      });
      const result = validateAnnotationRule(rule);

      expect(result.valid).toBe(true);
    });

    it('should report multiple errors at once', () => {
      const rule: AnnotationRule = {
        id: 'rule-bad',
        name: 'Bad Rule',
        conditions: [
          { type: 'file_path', pattern: '' },
          { type: 'branch', pattern: '' },
        ],
        validationTeams: [],
        approvalChain: { id: 'chain-1', orderedTeams: ['ghost-team'] },
      };
      const result = validateAnnotationRule(rule);

      expect(result.valid).toBe(false);
      // At minimum: empty teams + chain team not found + 2 empty patterns
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    });
  });
});
