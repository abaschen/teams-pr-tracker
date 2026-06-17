/**
 * Event normalizers for transforming provider-specific webhook payloads
 * into the provider-agnostic NormalizedPREvent format.
 */

export { normalizeGitHubEvent } from './github-normalizer.js';
export { normalizeBitbucketEvent } from './bitbucket-normalizer.js';
export { normalizeGitLabEvent } from './gitlab-normalizer.js';
export { getNormalizer, type NormalizerFn } from './normalizer-factory.js';
