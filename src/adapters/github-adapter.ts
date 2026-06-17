/**
 * GitHub adapter - implements ProviderAdapter for GitHub REST API v3.
 * Uses Node.js built-in fetch for HTTP calls.
 */

import type { ProviderAdapter, PRReference } from './provider-adapter.js';
import { AdapterApiError } from './provider-adapter.js';

/** Default GitHub API base URL */
const GITHUB_API_BASE = 'https://api.github.com';

/** GitHub API version header value */
const GITHUB_API_VERSION = '2022-11-28';

/**
 * GitHub provider adapter using the GitHub REST API v3.
 * Handles labels, reviewers, comments, description updates, and file listing.
 */
export class GitHubAdapter implements ProviderAdapter {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(accessToken: string, baseUrl: string = GITHUB_API_BASE) {
    this.token = accessToken;
    this.baseUrl = baseUrl;
  }

  /**
   * Add labels to a PR (via the Issues API).
   * POST /repos/{owner}/{repo}/issues/{prNumber}/labels
   */
  async addLabels(pr: PRReference, labels: string[]): Promise<void> {
    const url = `${this.baseUrl}/repos/${pr.owner}/${pr.repo}/issues/${pr.prNumber}/labels`;
    await this.request('POST', url, { labels });
  }

  /**
   * Remove labels from a PR (via the Issues API).
   * DELETE /repos/{owner}/{repo}/issues/{prNumber}/labels/{label}
   */
  async removeLabels(pr: PRReference, labels: string[]): Promise<void> {
    for (const label of labels) {
      const encodedLabel = encodeURIComponent(label);
      const url = `${this.baseUrl}/repos/${pr.owner}/${pr.repo}/issues/${pr.prNumber}/labels/${encodedLabel}`;
      await this.request('DELETE', url);
    }
  }

  /**
   * Assign reviewers to a PR.
   * POST /repos/{owner}/{repo}/pulls/{prNumber}/requested_reviewers
   */
  async assignReviewers(pr: PRReference, reviewers: string[]): Promise<void> {
    const url = `${this.baseUrl}/repos/${pr.owner}/${pr.repo}/pulls/${pr.prNumber}/requested_reviewers`;
    await this.request('POST', url, { reviewers });
  }

  /**
   * Unassign reviewers from a PR.
   * DELETE /repos/{owner}/{repo}/pulls/{prNumber}/requested_reviewers
   */
  async unassignReviewers(pr: PRReference, reviewers: string[]): Promise<void> {
    const url = `${this.baseUrl}/repos/${pr.owner}/${pr.repo}/pulls/${pr.prNumber}/requested_reviewers`;
    await this.request('DELETE', url, { reviewers });
  }

  /**
   * Add a comment to a PR (via the Issues API).
   * POST /repos/{owner}/{repo}/issues/{prNumber}/comments
   */
  async addComment(pr: PRReference, body: string): Promise<void> {
    const url = `${this.baseUrl}/repos/${pr.owner}/${pr.repo}/issues/${pr.prNumber}/comments`;
    await this.request('POST', url, { body });
  }

  /**
   * Update the PR description by appending text.
   * PATCH /repos/{owner}/{repo}/pulls/{prNumber}
   * Fetches the current body, appends the text, and updates.
   * Returns true (GitHub supports description editing).
   */
  async updateDescription(pr: PRReference, appendText: string): Promise<boolean> {
    const pullUrl = `${this.baseUrl}/repos/${pr.owner}/${pr.repo}/pulls/${pr.prNumber}`;

    // Fetch current PR body
    const currentPr = await this.request<{ body: string | null }>('GET', pullUrl);
    const currentBody = currentPr.body ?? '';
    const newBody = currentBody ? `${currentBody}\n\n${appendText}` : appendText;

    // Update with appended text
    await this.request('PATCH', pullUrl, { body: newBody });
    return true;
  }

  /**
   * Get the list of changed files in a PR with pagination support.
   * GET /repos/{owner}/{repo}/pulls/{prNumber}/files
   */
  async getChangedFiles(pr: PRReference): Promise<string[]> {
    const files: string[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const url = `${this.baseUrl}/repos/${pr.owner}/${pr.repo}/pulls/${pr.prNumber}/files?per_page=${perPage}&page=${page}`;
      const response = await this.request<Array<{ filename: string }>>(
        'GET',
        url
      );

      for (const file of response) {
        files.push(file.filename);
      }

      if (response.length < perPage) {
        break;
      }
      page++;
    }

    return files;
  }

  /**
   * Make an authenticated request to the GitHub API.
   * Throws AdapterApiError on non-2xx responses.
   */
  private async request<T = unknown>(
    method: string,
    url: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AdapterApiError('github', response.status, errorText);
    }

    // For DELETE requests or 204 No Content, return empty
    if (response.status === 204 || method === 'DELETE') {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}
