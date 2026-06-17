import { describe, it, expect } from 'vitest';
import { DefaultRuleEngine } from '../../src/engines/rule-engine.js';
import type { NormalizedPREvent } from '../../src/models/events.js';
import type { AnnotationRule, ValidationTeamConfig } from '../../src/models/rules.js';

function makeEvent(overrides: Partial<NormalizedPREvent> = {}): NormalizedPREvent {
  return {
    provider: 'github',
    eventType: 'pr_opened',
    prId: '123',
    prTitle: 'Test PR',
    prUrl: 'https://github.com/org/repo/pull/123',
    repositoryName: 'repo',
    repositoryFullName: 'org/repo',
    author: 'developer',
    branch: 'feature/my-feature',
    baseBranch: 'main',
    changedFiles: ['src/utils/helper.ts', 'src/models/user.ts'],
    labels: ['bug', 'priority-high'],
    timestamp: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeTeam(name: string): ValidationTeamConfig {
  return {
    teamName: name,
    teamsTagId: `tag-${name}`,
    reviewers: [`reviewer-${name}`],
  };
}

function makeRule(overrides: Partial<AnnotationRule> = {}): AnnotationRule {
  return {
    id: 'rule-1',
    name: 'Test Rule',
    conditions: [],
    validationTeams: [makeTeam('team-a')],
    ...overrides,
  };
}

describe('DefaultRuleEngine', () => {
  const engine = new DefaultRuleEngine();

  describe('single rule matching all conditions', () => {
    it('matches when all conditions (file_path, repository, branch, label) are satisfied', () => {
      const rule = makeRule({
        conditions: [
          { type: 'file_path', pattern: 'src/**/*.ts' },
          { type: 'repository', pattern: 'org/repo' },
          { type: 'branch', pattern: 'feature/*' },
          { type: 'label', pattern: 'bug' },
        ],
        validationTeams: [makeTeam('security')],
      });

      const event = makeEvent();
      const result = engine.evaluate(event, [rule]);

      expect(result.matchedRules).toHaveLength(1);
      expect(result.matchedRules[0]).toBe(rule);
      expect(result.requiredTeams).toHaveLength(1);
      expect(result.requiredTeams[0].teamName).toBe('security');
    });
  });

  describe('multiple rules matching (union of teams)', () => {
    it('collects teams from all matched rules', () => {
      const rule1 = makeRule({
        id: 'rule-1',
        conditions: [{ type: 'file_path', pattern: 'src/**/*.ts' }],
        validationTeams: [makeTeam('frontend')],
      });
      const rule2 = makeRule({
        id: 'rule-2',
        conditions: [{ type: 'repository', pattern: 'org/repo' }],
        validationTeams: [makeTeam('backend')],
      });

      const event = makeEvent();
      const result = engine.evaluate(event, [rule1, rule2]);

      expect(result.matchedRules).toHaveLength(2);
      expect(result.requiredTeams).toHaveLength(2);
      expect(result.requiredTeams.map((t) => t.teamName)).toEqual(['frontend', 'backend']);
    });
  });

  describe('AND logic - rule not matching when one condition fails', () => {
    it('does not match when repository condition fails', () => {
      const rule = makeRule({
        conditions: [
          { type: 'file_path', pattern: 'src/**/*.ts' },
          { type: 'repository', pattern: 'different-org/different-repo' },
        ],
        validationTeams: [makeTeam('team-a')],
      });

      const event = makeEvent();
      const result = engine.evaluate(event, [rule]);

      expect(result.matchedRules).toHaveLength(0);
      expect(result.requiredTeams).toHaveLength(0);
    });

    it('does not match when file_path condition fails', () => {
      const rule = makeRule({
        conditions: [
          { type: 'file_path', pattern: 'docs/**/*.md' },
          { type: 'repository', pattern: 'org/repo' },
        ],
        validationTeams: [makeTeam('team-a')],
      });

      const event = makeEvent();
      const result = engine.evaluate(event, [rule]);

      expect(result.matchedRules).toHaveLength(0);
      expect(result.requiredTeams).toHaveLength(0);
    });

    it('does not match when branch condition fails', () => {
      const rule = makeRule({
        conditions: [
          { type: 'branch', pattern: 'release/*' },
          { type: 'repository', pattern: 'org/repo' },
        ],
        validationTeams: [makeTeam('team-a')],
      });

      const event = makeEvent({ branch: 'feature/my-feature' });
      const result = engine.evaluate(event, [rule]);

      expect(result.matchedRules).toHaveLength(0);
    });

    it('does not match when label condition fails', () => {
      const rule = makeRule({
        conditions: [
          { type: 'label', pattern: 'needs-review' },
          { type: 'repository', pattern: 'org/repo' },
        ],
        validationTeams: [makeTeam('team-a')],
      });

      const event = makeEvent({ labels: ['bug', 'priority-high'] });
      const result = engine.evaluate(event, [rule]);

      expect(result.matchedRules).toHaveLength(0);
    });
  });

  describe('file path glob matching', () => {
    it('matches nested files with ** pattern', () => {
      const rule = makeRule({
        conditions: [{ type: 'file_path', pattern: 'src/**/*.ts' }],
      });

      const event = makeEvent({ changedFiles: ['src/foo/bar.ts'] });
      const result = engine.evaluate(event, [rule]);

      expect(result.matchedRules).toHaveLength(1);
    });

    it('matches deeply nested files', () => {
      const rule = makeRule({
        conditions: [{ type: 'file_path', pattern: 'src/**/*.ts' }],
      });

      const event = makeEvent({ changedFiles: ['src/a/b/c/d.ts'] });
      const result = engine.evaluate(event, [rule]);

      expect(result.matchedRules).toHaveLength(1);
    });

    it('does not match files outside the pattern', () => {
      const rule = makeRule({
        conditions: [{ type: 'file_path', pattern: 'src/**/*.ts' }],
      });

      const event = makeEvent({ changedFiles: ['test/foo.ts', 'docs/readme.md'] });
      const result = engine.evaluate(event, [rule]);

      expect(result.matchedRules).toHaveLength(0);
    });

    it('matches if at least one file matches', () => {
      const rule = makeRule({
        conditions: [{ type: 'file_path', pattern: 'src/**/*.ts' }],
      });

      const event = makeEvent({ changedFiles: ['docs/readme.md', 'src/index.ts'] });
      const result = engine.evaluate(event, [rule]);

      expect(result.matchedRules).toHaveLength(1);
    });

    it('does not match when changedFiles is empty', () => {
      const rule = makeRule({
        conditions: [{ type: 'file_path', pattern: 'src/**/*.ts' }],
      });

      const event = makeEvent({ changedFiles: [] });
      const result = engine.evaluate(event, [rule]);

      expect(result.matchedRules).toHaveLength(0);
    });

    it('does not match when changedFiles is undefined', () => {
      const rule = makeRule({
        conditions: [{ type: 'file_path', pattern: 'src/**/*.ts' }],
      });

      const event = makeEvent({ changedFiles: undefined });
      const result = engine.evaluate(event, [rule]);

      expect(result.matchedRules).toHaveLength(0);
    });
  });

  describe('branch glob matching', () => {
    it('matches release/* pattern', () => {
      const rule = makeRule({
        conditions: [{ type: 'branch', pattern: 'release/*' }],
      });

      const event = makeEvent({ branch: 'release/v1.0' });
      const result = engine.evaluate(event, [rule]);

      expect(result.matchedRules).toHaveLength(1);
    });

    it('matches feature/** pattern for nested branches', () => {
      const rule = makeRule({
        conditions: [{ type: 'branch', pattern: 'feature/**' }],
      });

      const event = makeEvent({ branch: 'feature/team/task-123' });
      const result = engine.evaluate(event, [rule]);

      expect(result.matchedRules).toHaveLength(1);
    });

    it('does not match non-matching branch', () => {
      const rule = makeRule({
        conditions: [{ type: 'branch', pattern: 'release/*' }],
      });

      const event = makeEvent({ branch: 'feature/something' });
      const result = engine.evaluate(event, [rule]);

      expect(result.matchedRules).toHaveLength(0);
    });

    it('matches exact branch name', () => {
      const rule = makeRule({
        conditions: [{ type: 'branch', pattern: 'main' }],
      });

      const event = makeEvent({ branch: 'main' });
      const result = engine.evaluate(event, [rule]);

      expect(result.matchedRules).toHaveLength(1);
    });
  });

  describe('label matching', () => {
    it('matches when label is present', () => {
      const rule = makeRule({
        conditions: [{ type: 'label', pattern: 'bug' }],
      });

      const event = makeEvent({ labels: ['bug', 'priority-high'] });
      const result = engine.evaluate(event, [rule]);

      expect(result.matchedRules).toHaveLength(1);
    });

    it('does not match when label is absent', () => {
      const rule = makeRule({
        conditions: [{ type: 'label', pattern: 'security' }],
      });

      const event = makeEvent({ labels: ['bug', 'priority-high'] });
      const result = engine.evaluate(event, [rule]);

      expect(result.matchedRules).toHaveLength(0);
    });

    it('does not match when labels is undefined', () => {
      const rule = makeRule({
        conditions: [{ type: 'label', pattern: 'bug' }],
      });

      const event = makeEvent({ labels: undefined });
      const result = engine.evaluate(event, [rule]);

      expect(result.matchedRules).toHaveLength(0);
    });

    it('does not match when labels is empty', () => {
      const rule = makeRule({
        conditions: [{ type: 'label', pattern: 'bug' }],
      });

      const event = makeEvent({ labels: [] });
      const result = engine.evaluate(event, [rule]);

      expect(result.matchedRules).toHaveLength(0);
    });
  });

  describe('no rules matching', () => {
    it('returns empty result when no rules match', () => {
      const rule1 = makeRule({
        id: 'rule-1',
        conditions: [{ type: 'repository', pattern: 'other-org/other-repo' }],
        validationTeams: [makeTeam('team-a')],
      });
      const rule2 = makeRule({
        id: 'rule-2',
        conditions: [{ type: 'branch', pattern: 'hotfix/*' }],
        validationTeams: [makeTeam('team-b')],
      });

      const event = makeEvent();
      const result = engine.evaluate(event, [rule1, rule2]);

      expect(result.matchedRules).toHaveLength(0);
      expect(result.requiredTeams).toHaveLength(0);
      expect(result.approvalChains).toHaveLength(0);
    });

    it('returns empty result when rules list is empty', () => {
      const event = makeEvent();
      const result = engine.evaluate(event, []);

      expect(result.matchedRules).toHaveLength(0);
      expect(result.requiredTeams).toHaveLength(0);
      expect(result.approvalChains).toHaveLength(0);
    });
  });

  describe('deduplication of teams across rules', () => {
    it('deduplicates teams by teamName when multiple rules require the same team', () => {
      const sharedTeam = makeTeam('shared-team');
      const rule1 = makeRule({
        id: 'rule-1',
        conditions: [{ type: 'file_path', pattern: 'src/**/*.ts' }],
        validationTeams: [sharedTeam, makeTeam('team-a')],
      });
      const rule2 = makeRule({
        id: 'rule-2',
        conditions: [{ type: 'repository', pattern: 'org/repo' }],
        validationTeams: [sharedTeam, makeTeam('team-b')],
      });

      const event = makeEvent();
      const result = engine.evaluate(event, [rule1, rule2]);

      expect(result.matchedRules).toHaveLength(2);
      // Should have 3 unique teams: shared-team, team-a, team-b
      expect(result.requiredTeams).toHaveLength(3);
      const teamNames = result.requiredTeams.map((t) => t.teamName);
      expect(teamNames).toEqual(['shared-team', 'team-a', 'team-b']);
    });

    it('keeps first occurrence when teams with same name have different configs', () => {
      const team1: ValidationTeamConfig = {
        teamName: 'duplicate',
        teamsTagId: 'tag-1',
        reviewers: ['alice'],
      };
      const team2: ValidationTeamConfig = {
        teamName: 'duplicate',
        teamsTagId: 'tag-2',
        reviewers: ['bob'],
      };

      const rule1 = makeRule({
        id: 'rule-1',
        conditions: [],
        validationTeams: [team1],
      });
      const rule2 = makeRule({
        id: 'rule-2',
        conditions: [],
        validationTeams: [team2],
      });

      const event = makeEvent();
      const result = engine.evaluate(event, [rule1, rule2]);

      expect(result.requiredTeams).toHaveLength(1);
      expect(result.requiredTeams[0].teamsTagId).toBe('tag-1');
      expect(result.requiredTeams[0].reviewers).toEqual(['alice']);
    });
  });

  describe('approval chains collection', () => {
    it('collects approval chains from matched rules', () => {
      const rule1 = makeRule({
        id: 'rule-1',
        conditions: [],
        validationTeams: [makeTeam('team-a')],
        approvalChain: { id: 'chain-1', orderedTeams: ['team-a', 'team-b'] },
      });
      const rule2 = makeRule({
        id: 'rule-2',
        conditions: [],
        validationTeams: [makeTeam('team-b')],
        approvalChain: { id: 'chain-2', orderedTeams: ['team-c', 'team-d'] },
      });

      const event = makeEvent();
      const result = engine.evaluate(event, [rule1, rule2]);

      expect(result.approvalChains).toHaveLength(2);
      expect(result.approvalChains[0].id).toBe('chain-1');
      expect(result.approvalChains[1].id).toBe('chain-2');
    });

    it('does not include approval chains from unmatched rules', () => {
      const rule1 = makeRule({
        id: 'rule-1',
        conditions: [{ type: 'repository', pattern: 'org/repo' }],
        validationTeams: [makeTeam('team-a')],
        approvalChain: { id: 'chain-1', orderedTeams: ['team-a'] },
      });
      const rule2 = makeRule({
        id: 'rule-2',
        conditions: [{ type: 'repository', pattern: 'other/repo' }],
        validationTeams: [makeTeam('team-b')],
        approvalChain: { id: 'chain-2', orderedTeams: ['team-b'] },
      });

      const event = makeEvent();
      const result = engine.evaluate(event, [rule1, rule2]);

      expect(result.approvalChains).toHaveLength(1);
      expect(result.approvalChains[0].id).toBe('chain-1');
    });

    it('skips rules without approval chains', () => {
      const rule1 = makeRule({
        id: 'rule-1',
        conditions: [],
        validationTeams: [makeTeam('team-a')],
        // no approvalChain
      });
      const rule2 = makeRule({
        id: 'rule-2',
        conditions: [],
        validationTeams: [makeTeam('team-b')],
        approvalChain: { id: 'chain-1', orderedTeams: ['team-b'] },
      });

      const event = makeEvent();
      const result = engine.evaluate(event, [rule1, rule2]);

      expect(result.approvalChains).toHaveLength(1);
      expect(result.approvalChains[0].id).toBe('chain-1');
    });
  });

  describe('rule with no conditions', () => {
    it('always matches when rule has no conditions', () => {
      const rule = makeRule({
        conditions: [],
        validationTeams: [makeTeam('always-required')],
      });

      const event = makeEvent();
      const result = engine.evaluate(event, [rule]);

      expect(result.matchedRules).toHaveLength(1);
      expect(result.requiredTeams[0].teamName).toBe('always-required');
    });
  });
});
