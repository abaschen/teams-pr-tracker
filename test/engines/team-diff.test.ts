import { describe, it, expect } from 'vitest';
import { computeTeamDiff } from '../../src/engines/team-diff.js';

describe('computeTeamDiff', () => {
  describe('no changes (identical sets)', () => {
    it('returns all teams as unchanged when sets are identical', () => {
      const result = computeTeamDiff(['team-a', 'team-b', 'team-c'], ['team-a', 'team-b', 'team-c']);

      expect(result.teamsToAdd).toEqual([]);
      expect(result.teamsToRemove).toEqual([]);
      expect(result.teamsUnchanged).toEqual(expect.arrayContaining(['team-a', 'team-b', 'team-c']));
      expect(result.teamsUnchanged).toHaveLength(3);
    });
  });

  describe('only additions (new teams added)', () => {
    it('detects teams present in newTeams but not in oldTeams', () => {
      const result = computeTeamDiff(['team-a'], ['team-a', 'team-b', 'team-c']);

      expect(result.teamsToAdd).toEqual(expect.arrayContaining(['team-b', 'team-c']));
      expect(result.teamsToAdd).toHaveLength(2);
      expect(result.teamsToRemove).toEqual([]);
      expect(result.teamsUnchanged).toEqual(['team-a']);
    });
  });

  describe('only removals (teams removed)', () => {
    it('detects teams present in oldTeams but not in newTeams', () => {
      const result = computeTeamDiff(['team-a', 'team-b', 'team-c'], ['team-a']);

      expect(result.teamsToAdd).toEqual([]);
      expect(result.teamsToRemove).toEqual(expect.arrayContaining(['team-b', 'team-c']));
      expect(result.teamsToRemove).toHaveLength(2);
      expect(result.teamsUnchanged).toEqual(['team-a']);
    });
  });

  describe('mixed changes (some added, some removed, some unchanged)', () => {
    it('correctly categorizes teams into add, remove, and unchanged', () => {
      const oldTeams = ['team-a', 'team-b', 'team-c'];
      const newTeams = ['team-b', 'team-d', 'team-e'];

      const result = computeTeamDiff(oldTeams, newTeams);

      expect(result.teamsToAdd).toEqual(expect.arrayContaining(['team-d', 'team-e']));
      expect(result.teamsToAdd).toHaveLength(2);
      expect(result.teamsToRemove).toEqual(expect.arrayContaining(['team-a', 'team-c']));
      expect(result.teamsToRemove).toHaveLength(2);
      expect(result.teamsUnchanged).toEqual(['team-b']);
    });
  });

  describe('empty old set (all new)', () => {
    it('treats all newTeams as additions when oldTeams is empty', () => {
      const result = computeTeamDiff([], ['team-a', 'team-b']);

      expect(result.teamsToAdd).toEqual(expect.arrayContaining(['team-a', 'team-b']));
      expect(result.teamsToAdd).toHaveLength(2);
      expect(result.teamsToRemove).toEqual([]);
      expect(result.teamsUnchanged).toEqual([]);
    });
  });

  describe('empty new set (all removed)', () => {
    it('treats all oldTeams as removals when newTeams is empty', () => {
      const result = computeTeamDiff(['team-a', 'team-b'], []);

      expect(result.teamsToAdd).toEqual([]);
      expect(result.teamsToRemove).toEqual(expect.arrayContaining(['team-a', 'team-b']));
      expect(result.teamsToRemove).toHaveLength(2);
      expect(result.teamsUnchanged).toEqual([]);
    });
  });

  describe('empty both (no diff)', () => {
    it('returns empty arrays when both sets are empty', () => {
      const result = computeTeamDiff([], []);

      expect(result.teamsToAdd).toEqual([]);
      expect(result.teamsToRemove).toEqual([]);
      expect(result.teamsUnchanged).toEqual([]);
    });
  });

  describe('duplicate handling', () => {
    it('deduplicates teams within the same input array', () => {
      const result = computeTeamDiff(['team-a', 'team-a'], ['team-a', 'team-b', 'team-b']);

      expect(result.teamsToAdd).toEqual(['team-b']);
      expect(result.teamsToRemove).toEqual([]);
      expect(result.teamsUnchanged).toEqual(['team-a']);
    });
  });
});
