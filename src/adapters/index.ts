/**
 * Barrel export for the adapters module.
 */

export {
  AdapterOperationNotSupportedError,
  AdapterApiError,
} from './provider-adapter.js';
export type { ProviderAdapter, PRReference } from './provider-adapter.js';
export { getAdapter } from './adapter-factory.js';
export { GitLabAdapter } from './gitlab-adapter.js';
export type { GitLabAdapterOptions } from './gitlab-adapter.js';
export { BitbucketAdapter } from './bitbucket-adapter.js';
export { GitHubAdapter } from './github-adapter.js';
