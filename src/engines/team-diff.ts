/**
 * Team Diff Engine - computes add/remove actions when file sets change.
 * Compares old required teams vs. new required teams after re-evaluation
 * to determine which teams should be added, removed, or left unchanged.
 */

/** Result of computing the diff between old and new team sets */
export interface TeamDiffResult {
  /** Teams in newTeams but not in oldTeams */
  teamsToAdd: string[];
  /** Teams in oldTeams but not in newTeams */
  teamsToRemove: string[];
  /** Teams present in both oldTeams and newTeams */
  teamsUnchanged: string[];
}

/**
 * Computes the diff between an old set of required teams and a new set.
 *
 * Used when a PR is updated with new commits that change the set of modified files,
 * requiring re-evaluation of annotation rules. The diff determines which team labels
 * and reviewer assignments need to be added or removed.
 *
 * @param oldTeams - Team names from the previous evaluation
 * @param newTeams - Team names from the new evaluation
 * @returns A TeamDiffResult with teams to add, remove, and those unchanged
 */
export function computeTeamDiff(oldTeams: string[], newTeams: string[]): TeamDiffResult {
  const oldSet = new Set(oldTeams);
  const newSet = new Set(newTeams);

  const teamsToAdd: string[] = [];
  const teamsToRemove: string[] = [];
  const teamsUnchanged: string[] = [];

  for (const team of newSet) {
    if (oldSet.has(team)) {
      teamsUnchanged.push(team);
    } else {
      teamsToAdd.push(team);
    }
  }

  for (const team of oldSet) {
    if (!newSet.has(team)) {
      teamsToRemove.push(team);
    }
  }

  return { teamsToAdd, teamsToRemove, teamsUnchanged };
}
