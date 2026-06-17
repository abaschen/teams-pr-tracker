/**
 * Bitbucket provider adapter - implements ProviderAdapter using Bitbucket REST API 2.0.
 *
 * Limitations:
 * - Bitbucket does not natively support PR labels; label operations use comment fallback.
 * - updateDescription uses comment fallback and returns false.
 */

import type { PRReference, ProviderAdapter } from './provider-adapter.js';
import { AdapterApiError } from './provider-adapter.js';

const BITBUCKET_API_BASE = 'https://api.bitbucket.org/2.0';

export class BitbucketAdapter implements ProviderAdapter {
  private readonly accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async addLabels(pr: PRReference, labels: string[]): Promise<void> {
    // Bitbucket does not support native PR labels - post a comment as fallback
    const body = `🏷️ Labels added: ${labels.map((l) => `\`${l}\``).join(', ')}`;
    await this.addComment(pr, body);
  }

  async removeLabels(pr: PRReference, labels: string[]): Promise<void> {
    // Bitbucket does not support native PR labels - post a comment noting removal
    const body = `🏷️ Labels removed: ${labels.map((l) => `\`${l}\``).join(', ')}`;
    await this.addComment(pr, body);
  }

  async assignReviewers(pr: PRReference, reviewers: string[]): Promise<void> {
    const url = this.buildPrUrl(pr);
    const currentPr = await this.request<BitbucketPR>('GET', url);

    const existingReviewers: BitbucketUser[] = currentPr.reviewers ?? [];
    const existingUsernames = new Set(
      existingReviewers.map((r) => r.username ?? r.uuid)
    );

    const newReviewers = reviewers
      .filter((r) => !existingUsernames.has(r))
      .map((username) => ({ username }));

    const updatedReviewers = [...existingReviewers, ...newReviewers];

    await this.request('PUT', url, { reviewers: updatedReviewers });
  }

  async unassignReviewers(pr: PRReference, reviewers: string[]): Promise<void> {
    const url = this.buildPrUrl(pr);
    const currentPr = await this.request<BitbucketPR>('GET', url);

    const toRemove = new Set(reviewers);
    const updatedReviewers = (currentPr.reviewers ?? []).filter(
      (r) => !toRemove.has(r.username ?? r.uuid)
    );

    await this.request('PUT', url, { reviewers: updatedReviewers });
  }

  async addComment(pr: PRReference, body: string): Promise<void> {
    const url = `${this.buildPrUrl(pr)}/comments`;
    await this.request('POST', url, { content: { raw: body } });
  }

  async updateDescription(pr: PRReference, appendText: string): Promise<boolean> {
    // Bitbucket technically supports description editing, but to avoid losing content
    // we use the comment fallback approach and return false.
    await this.addComment(pr, appendText);
    return false;
  }

  async getChangedFiles(pr: PRReference): Promise<string[]> {
    const files: string[] = [];
    let url: string | null = `${this.buildPrUrl(pr)}/diffstat`;

    while (url) {
      const page: BitbucketDiffstatPage = await this.request<BitbucketDiffstatPage>('GET', url);
      for (const entry of page.values ?? []) {
        if (entry.new?.path) {
          files.push(entry.new.path);
        } else if (entry.old?.path) {
          files.push(entry.old.path);
        }
      }
      url = page.next ?? null;
    }

    return files;
  }

  private buildPrUrl(pr: PRReference): string {
    return `${BITBUCKET_API_BASE}/repositories/${pr.owner}/${pr.repo}/pullrequests/${pr.prNumber}`;
  }

  private async request<T = unknown>(
    method: string,
    url: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AdapterApiError('bitbucket', response.status, errorText);
    }

    // Some responses (204 No Content) may have no body
    const text = await response.text();
    if (!text) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }
}

/** Internal Bitbucket API types */
interface BitbucketUser {
  username?: string;
  uuid: string;
}

interface BitbucketPR {
  reviewers?: BitbucketUser[];
}

interface BitbucketDiffstatEntry {
  new?: { path: string };
  old?: { path: string };
}

interface BitbucketDiffstatPage {
  values?: BitbucketDiffstatEntry[];
  next?: string;
}
