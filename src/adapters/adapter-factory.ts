/**
 * Adapter factory - selects the appropriate provider adapter by provider type.
 */

import type { Provider } from '../models/events.js';
import type { ProviderAdapter } from './provider-adapter.js';
import { BitbucketAdapter } from './bitbucket-adapter.js';
import { GitHubAdapter } from './github-adapter.js';
import { GitLabAdapter } from './gitlab-adapter.js';

/**
 * Returns a ProviderAdapter instance for the given source control provider.
 *
 * @param provider - The source control provider type
 * @param accessToken - Optional access token; defaults to environment variable for the provider
 * @throws {Error} if the provider is not supported or the adapter is not yet implemented.
 */
export function getAdapter(provider: Provider, accessToken?: string): ProviderAdapter {
  switch (provider) {
    case 'github': {
      const token = accessToken ?? process.env.GITHUB_TOKEN;
      if (!token) {
        throw new Error(
          'GitHub access token is required. Provide it as a parameter or set the GITHUB_TOKEN environment variable.'
        );
      }
      return new GitHubAdapter(token);
    }
    case 'bitbucket': {
      const token = accessToken ?? process.env.BITBUCKET_TOKEN;
      if (!token) {
        throw new Error(
          'Bitbucket access token is required. Provide it as a parameter or set the BITBUCKET_TOKEN environment variable.'
        );
      }
      return new BitbucketAdapter(token);
    }
    case 'gitlab': {
      const token = accessToken ?? process.env.GITLAB_TOKEN;
      if (!token) {
        throw new Error(
          'GitLab access token is required. Provide it as a parameter or set the GITLAB_TOKEN environment variable.'
        );
      }
      return new GitLabAdapter({ accessToken: token });
    }
    default:
      throw new Error(`Unsupported provider: "${provider as string}"`);
  }
}
