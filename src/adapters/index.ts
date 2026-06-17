/**
 * Barrel export for the adapters module.
 */

export {
  AdapterOperationNotSupportedError,
  AdapterApiError,
} from './provider-adapter.js';
export type { ProviderAdapter, PRReference } from './provider-adapter.js';
export { getAdapter } from './adapter-factory.js';
