/**
 * GitLab adapter - implements ProviderAdapter using GitLab REST API v4.
 */

import type { ProviderAdapter, PRReference } from './provider-adapter.js';
import { AdapterApiError } from './provider-adapter.js';

export interface GitLabAdapterOptions {
  accessToken: string;
  baseUrl?: string;
}

export class GitLabAdapter implements ProviderAdapter {
  private readonly accessToken: string;
  private readonly baseUrl: string;

  constructor(options: GitLabAdapterOptions) {
    this.accessToken = options.accessToken;
    this.baseUrl = (options.baseUrl ?? 'https://gitlab.com').replace(/\/+$/, '');
  }

  async addLabels(pr: PRReference, labels: string[]): Promise<void> {
    // Fetch current labels first to preserve existing ones
    const mr = await this.getMergeRequest(pr);
    const existingLabels = mr.labels ?? [];
    const mergedLabels = [...new Set([...existingLabels, ...labels])];

    await this.updateMergeRequest(pr, { labels: mergedLabels.join(',') });
  }

  async removeLabels(pr: PRReference, labels: string[]): Promise<void> {
    const mr = await this.getMergeRequest(pr);
    const existingLabels = mr.labels ?? [];
    const labelsToRemove = new Set(labels);
    const updatedLabels = existingLabels.filter((l) => !labelsToRemove.has(l));

    await this.updateMergeRequest(pr, { labels: updatedLabels.join(',') });
  }

  async assignReviewers(pr: PRReference, reviewers: string[]): Promise<void> {
    const reviewerIds = await this.resolveUserIds(reviewers);
    // Fetch current reviewers to merge
    const mr = await this.getMergeRequest(pr);
    const existingIds = (mr.reviewers ?? []).map((r) => r.id);
    const mergedIds = [...new Set([...existingIds, ...reviewerIds])];

    await this.updateMergeRequest(pr, { reviewer_ids: mergedIds });
  }

  async unassignReviewers(pr: PRReference, reviewers: string[]): Promise<void> {
    const idsToRemove = new Set(await this.resolveUserIds(reviewers));
    const mr = await this.getMergeRequest(pr);
    const existingIds = (mr.reviewers ?? []).map((r) => r.id);
    const updatedIds = existingIds.filter((id) => !idsToRemove.has(id));

    await this.updateMergeRequest(pr, { reviewer_ids: updatedIds });
  }

  async addComment(pr: PRReference, body: string): Promise<void> {
    const projectPath = this.encodeProjectPath(pr);
    const url = `${this.baseUrl}/api/v4/projects/${projectPath}/merge_requests/${pr.prNumber}/notes`;

    await this.request(url, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }

  async updateDescription(pr: PRReference, appendText: string): Promise<boolean> {
    const mr = await this.getMergeRequest(pr);
    const currentDescription = mr.description ?? '';
    const newDescription = currentDescription
      ? `${currentDescription}\n\n${appendText}`
      : appendText;

    await this.updateMergeRequest(pr, { description: newDescription });
    return true;
  }

  async getChangedFiles(pr: PRReference): Promise<string[]> {
    const projectPath = this.encodeProjectPath(pr);
    const url = `${this.baseUrl}/api/v4/projects/${projectPath}/merge_requests/${pr.prNumber}/changes`;

    const data = await this.request<GitLabChangesResponse>(url, { method: 'GET' });
    const changes = data.changes ?? [];

    const files = new Set<string>();
    for (const change of changes) {
      if (change.new_path) files.add(change.new_path);
      if (change.old_path && change.old_path !== change.new_path) {
        files.add(change.old_path);
      }
    }
    return [...files];
  }

  // --- Private helpers ---

  private encodeProjectPath(pr: PRReference): string {
    return encodeURIComponent(`${pr.owner}/${pr.repo}`);
  }

  private async getMergeRequest(pr: PRReference): Promise<GitLabMergeRequest> {
    const projectPath = this.encodeProjectPath(pr);
    const url = `${this.baseUrl}/api/v4/projects/${projectPath}/merge_requests/${pr.prNumber}`;
    return this.request<GitLabMergeRequest>(url, { method: 'GET' });
  }

  private async updateMergeRequest(
    pr: PRReference,
    body: Record<string, unknown>
  ): Promise<void> {
    const projectPath = this.encodeProjectPath(pr);
    const url = `${this.baseUrl}/api/v4/projects/${projectPath}/merge_requests/${pr.prNumber}`;
    await this.request(url, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  private async resolveUserIds(usernames: string[]): Promise<number[]> {
    const ids: number[] = [];
    for (const username of usernames) {
      const url = `${this.baseUrl}/api/v4/users?username=${encodeURIComponent(username)}`;
      const users = await this.request<GitLabUser[]>(url, { method: 'GET' });
      if (Array.isArray(users) && users.length > 0) {
        ids.push(users[0].id);
      }
    }
    return ids;
  }

  private async request<T = unknown>(
    url: string,
    options: { method: string; body?: string }
  ): Promise<T> {
    const headers: Record<string, string> = {
      'PRIVATE-TOKEN': this.accessToken,
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new AdapterApiError('gitlab', response.status, text);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }

    return undefined as T;
  }
}

/** Internal type for GitLab MR response */
interface GitLabMergeRequest {
  labels: string[];
  reviewers: GitLabUser[];
  description: string | null;
}

/** Internal type for GitLab user */
interface GitLabUser {
  id: number;
  username: string;
}

/** Internal type for GitLab MR changes response */
interface GitLabChangesResponse {
  changes: Array<{ new_path?: string; old_path?: string }>;
}
