/**
 * Normalizer factory.
 * Selects the appropriate event normalizer based on the source control provider.
 */

import type { Provider, NormalizedPREvent } from '../models/events.js';
import { normalizeGitHubEvent } from './github-normalizer.js';
import { normalizeBitbucketEvent } from './bitbucket-normalizer.js';
import { normalizeGitLabEvent } from './gitlab-normalizer.js';

/** A normalizer function signature that accepts a raw payload and optional event header */
export type NormalizerFn = (payload: unknown, eventHeader?: string) => NormalizedPREvent | null;

/**
 * Returns the appropriate normalizer function for the given provider.
 * The returned function accepts a raw payload and an optional event header/key,
 * and returns a NormalizedPREvent or null for unrecognized events.
 */
export function getNormalizer(provider: Provider): NormalizerFn {
  switch (provider) {
    case 'github':
      return (payload, eventHeader) =>
        normalizeGitHubEvent(payload as Parameters<typeof normalizeGitHubEvent>[0], eventHeader);
    case 'bitbucket':
      return (payload, eventHeader) =>
        normalizeBitbucketEvent(
          payload as Parameters<typeof normalizeBitbucketEvent>[0],
          eventHeader
        );
    case 'gitlab':
      return (payload) => normalizeGitLabEvent(payload as Parameters<typeof normalizeGitLabEvent>[0]);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unsupported provider: ${_exhaustive}`);
    }
  }
}
