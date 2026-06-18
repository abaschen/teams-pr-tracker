/**
 * Configuration types for channel mappings and runtime settings.
 * Channel mappings are stored in SSM Parameter Store as JSON.
 */

/** Maps a repository pattern to a Microsoft Teams channel */
export interface ChannelMapping {
  repositoryPattern: string; // glob pattern matching repositoryFullName
  channelId: string;
  serviceUrl: string;
  /** Team tag ID to @mention when PR is ready to merge (optional) */
  maintainersTagId?: string;
  /** Display name for the maintainers tag (e.g., "Maintainers") */
  maintainersTagName?: string;
}

/** Top-level channel mapping configuration */
export interface ChannelMappingConfig {
  mappings: ChannelMapping[];
  defaultChannelId: string;
  /** Default maintainers tag ID used when no mapping-specific one is set */
  defaultMaintainersTagId?: string;
  /** Default maintainers tag display name */
  defaultMaintainersTagName?: string;
}

/** Retry configuration for external API calls */
export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}
