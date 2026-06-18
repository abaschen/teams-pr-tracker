/**
 * GitHub App Credential Provider.
 *
 * Resolves credentials for GitHub repositories using the GitHub App's
 * installation token mechanism. This replaces PAT-based authentication
 * with short-lived, auto-rotated tokens scoped to the installation.
 *
 * Configuration is loaded from environment variables:
 * - GITHUB_APP_ID: The numeric App ID
 * - GITHUB_APP_PRIVATE_KEY: PEM-encoded private key (or SSM parameter path)
 *
 * The private key can be stored in SSM Parameter Store (SecureString) and
 * referenced by path (e.g., /pr-tracker-dev/secrets/github-app-private-key).
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { GitHubAppAuth } from './github-app-auth.js';
import type { ProviderCredentials } from '../models/credentials.js';

let cachedAuth: GitHubAppAuth | null = null;
let cachedPrivateKey: string | null = null;

/**
 * Resolves the private key from environment or SSM.
 */
async function resolvePrivateKey(): Promise<string> {
  if (cachedPrivateKey) {
    return cachedPrivateKey;
  }

  const keyValue = process.env.GITHUB_APP_PRIVATE_KEY ?? '';

  if (keyValue.startsWith('/')) {
    // It's an SSM parameter path — resolve it
    const client = new SSMClient({});
    const response = await client.send(
      new GetParameterCommand({ Name: keyValue, WithDecryption: true }),
    );
    const key = response.Parameter?.Value;
    if (!key) {
      throw new Error(`GitHub App private key not found at SSM path: ${keyValue}`);
    }
    cachedPrivateKey = key;
    return key;
  }

  if (keyValue.startsWith('-----BEGIN')) {
    cachedPrivateKey = keyValue;
    return keyValue;
  }

  throw new Error(
    'GITHUB_APP_PRIVATE_KEY must be either a PEM-encoded key or an SSM parameter path',
  );
}

/**
 * Gets or creates the GitHubAppAuth instance.
 */
async function getAppAuth(): Promise<GitHubAppAuth> {
  if (cachedAuth) {
    return cachedAuth;
  }

  const appId = process.env.GITHUB_APP_ID;
  if (!appId) {
    throw new Error('GITHUB_APP_ID environment variable is required');
  }

  const privateKey = await resolvePrivateKey();
  cachedAuth = new GitHubAppAuth({ appId, privateKey });
  return cachedAuth;
}

/**
 * Gets GitHub credentials for a repository using the GitHub App.
 * Returns a ProviderCredentials object with a short-lived installation token.
 *
 * @param repositoryFullName - Full repo name (e.g., "abaschen/pr-tracker-test-repo")
 * @returns ProviderCredentials with the installation token
 */
export async function getGitHubAppCredentials(
  repositoryFullName: string,
): Promise<ProviderCredentials> {
  const auth = await getAppAuth();
  const [owner, ...repoParts] = repositoryFullName.split('/');
  const repo = repoParts.join('/');

  const token = await auth.getTokenForRepo(owner, repo);

  return {
    type: 'token',
    accessToken: token,
    // Installation tokens expire in 1 hour
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
}

/**
 * Checks if GitHub App authentication is configured.
 */
export function isGitHubAppConfigured(): boolean {
  return !!(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY);
}

/**
 * Clears cached auth (for testing).
 */
export function clearGitHubAppCache(): void {
  cachedAuth = null;
  cachedPrivateKey = null;
}
