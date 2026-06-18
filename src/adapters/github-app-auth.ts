/**
 * GitHub App Authentication.
 *
 * Generates JWTs signed with the app's private key, then exchanges them for
 * short-lived installation access tokens. Tokens are cached until near expiry.
 *
 * This eliminates the need for long-lived PATs — tokens are automatically
 * rotated and scoped to the specific installation's permissions.
 */

import { createSign } from 'node:crypto';

/** GitHub App configuration */
export interface GitHubAppConfig {
  /** GitHub App ID (numeric) */
  appId: string;
  /** PEM-encoded RSA private key */
  privateKey: string;
  /** Optional custom fetch implementation */
  fetchFn?: typeof globalThis.fetch;
  /** Optional GitHub API base URL (for GHES) */
  apiBaseUrl?: string;
}

/** Cached installation token */
interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

/** GitHub installation token response */
interface InstallationTokenResponse {
  token: string;
  expires_at: string; // ISO 8601
  permissions: Record<string, string>;
}

/** GitHub App installation info */
interface Installation {
  id: number;
  account: { login: string };
}

const DEFAULT_API_BASE = 'https://api.github.com';
const TOKEN_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

/**
 * GitHub App authenticator.
 * Creates JWTs and exchanges them for installation tokens.
 */
export class GitHubAppAuth {
  private readonly appId: string;
  private readonly privateKey: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly apiBaseUrl: string;
  private readonly tokenCache: Map<number, CachedToken> = new Map();

  constructor(config: GitHubAppConfig) {
    this.appId = config.appId;
    this.privateKey = config.privateKey;
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
    this.apiBaseUrl = config.apiBaseUrl ?? DEFAULT_API_BASE;
  }

  /**
   * Creates a JWT for authenticating as the GitHub App.
   * JWTs are valid for 10 minutes max per GitHub's requirements.
   */
  createAppJWT(): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now - 60, // issued 60s in the past to account for clock drift
      exp: now + 600, // expires in 10 minutes
      iss: this.appId,
    };

    const header = { alg: 'RS256', typ: 'JWT' };
    const encodedHeader = base64url(JSON.stringify(header));
    const encodedPayload = base64url(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const sign = createSign('RSA-SHA256');
    sign.update(signingInput);
    const signature = sign.sign(this.privateKey, 'base64url');

    return `${signingInput}.${signature}`;
  }

  /**
   * Gets an installation access token for the given installation ID.
   * Caches tokens and refreshes them when near expiry.
   */
  async getInstallationToken(installationId: number): Promise<string> {
    const cached = this.tokenCache.get(installationId);
    if (cached && cached.expiresAt > Date.now() + TOKEN_BUFFER_MS) {
      return cached.token;
    }

    const jwt = this.createAppJWT();
    const response = await this.fetchFn(
      `${this.apiBaseUrl}/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to get installation token: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = (await response.json()) as InstallationTokenResponse;
    const expiresAt = new Date(data.expires_at).getTime();

    this.tokenCache.set(installationId, { token: data.token, expiresAt });
    return data.token;
  }

  /**
   * Finds the installation ID for a given repository.
   * Queries the GitHub API to find which installation has access to the repo.
   */
  async getInstallationForRepo(owner: string, repo: string): Promise<number> {
    const jwt = this.createAppJWT();
    const response = await this.fetchFn(
      `${this.apiBaseUrl}/repos/${owner}/${repo}/installation`,
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `No installation found for ${owner}/${repo}: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as Installation;
    return data.id;
  }

  /**
   * Convenience method: gets an installation token for a repository.
   * Combines getInstallationForRepo + getInstallationToken.
   */
  async getTokenForRepo(owner: string, repo: string): Promise<string> {
    const installationId = await this.getInstallationForRepo(owner, repo);
    return this.getInstallationToken(installationId);
  }
}

/** Base64url encoding without padding */
function base64url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
