/**
 * Adapter factory - selects the appropriate provider adapter by provider type.
 */

import type { Provider } from '../models/events.js';
import type { ProviderAdapter } from './provider-adapter.js';

/**
 * Returns a ProviderAdapter instance for the given source control provider.
 *
 * @throws {Error} if the provider is not supported or the adapter is not yet implemented.
 */
export function getAdapter(provider: Provider): ProviderAdapter {
  switch (provider) {
    case 'github':
      throw new Error(
        `Adapter for provider "${provider}" is not yet implemented`
      );
    case 'bitbucket':
      throw new Error(
        `Adapter for provider "${provider}" is not yet implemented`
      );
    case 'gitlab':
      throw new Error(
        `Adapter for provider "${provider}" is not yet implemented`
      );
    default:
      throw new Error(`Unsupported provider: "${provider as string}"`);
  }
}
