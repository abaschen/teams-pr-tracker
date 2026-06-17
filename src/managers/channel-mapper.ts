/**
 * Channel Mapper implementation.
 * Resolves which Microsoft Teams channel a PR thread should be posted to
 * by matching repository names against configured glob patterns stored
 * in SSM Parameter Store.
 *
 * Configuration is cached in-memory for the Lambda invocation lifetime
 * to minimize SSM Parameter Store calls.
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import picomatch from 'picomatch';
import type { ChannelMappingConfig } from '../models/config.js';

/** Result of resolving a channel for a repository */
export interface ResolvedChannel {
  channelId: string;
  serviceUrl: string;
}

/** Configuration for the ChannelMapper */
export interface ChannelMapperConfig {
  /** Optional custom SSM client (useful for testing) */
  ssmClient?: SSMClient;
  /** SSM parameter name storing the channel mapping JSON */
  parameterName?: string;
}

/** Default SSM parameter name for channel mappings */
const DEFAULT_PARAMETER_NAME = '/pr-tracker/channel-mappings';

/** Default service URL used when the default channel is selected */
const DEFAULT_SERVICE_URL = 'https://smba.trafficmanager.net/teams';

/**
 * Resolves which Teams channel to post PR threads to based on repository
 * name matching against configured glob patterns from SSM Parameter Store.
 */
export class ChannelMapper {
  private readonly client: SSMClient;
  private readonly parameterName: string;
  private cachedConfig: ChannelMappingConfig | null = null;

  constructor(config: ChannelMapperConfig = {}) {
    this.client =
      config.ssmClient ?? new SSMClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
    this.parameterName =
      config.parameterName ??
      process.env.CHANNEL_MAPPING_PARAM ??
      DEFAULT_PARAMETER_NAME;
  }

  /**
   * Resolves the Teams channel for a given repository.
   *
   * Iterates through configured mappings and returns the first match.
   * If no pattern matches, returns the default channel.
   *
   * @param repositoryFullName - Full repository name (e.g., "org/repo-name")
   * @returns The resolved channel ID and service URL
   * @throws Error if SSM parameter cannot be loaded or parsed
   */
  async resolveChannel(repositoryFullName: string): Promise<ResolvedChannel> {
    const config = await this.loadConfig();

    for (const mapping of config.mappings) {
      const isMatch = picomatch(mapping.repositoryPattern);
      if (isMatch(repositoryFullName)) {
        return {
          channelId: mapping.channelId,
          serviceUrl: mapping.serviceUrl,
        };
      }
    }

    // No pattern matched — return default channel
    return {
      channelId: config.defaultChannelId,
      serviceUrl: DEFAULT_SERVICE_URL,
    };
  }

  /**
   * Loads and caches the channel mapping configuration from SSM Parameter Store.
   * The config is cached for the lifetime of the Lambda invocation.
   */
  private async loadConfig(): Promise<ChannelMappingConfig> {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    const command = new GetParameterCommand({
      Name: this.parameterName,
      WithDecryption: true,
    });

    const response = await this.client.send(command);

    if (!response.Parameter?.Value) {
      throw new Error(
        `Channel mapping parameter "${this.parameterName}" not found or has no value`,
      );
    }

    const parsed = JSON.parse(response.Parameter.Value) as ChannelMappingConfig;

    if (!parsed.mappings || !Array.isArray(parsed.mappings) || !parsed.defaultChannelId) {
      throw new Error(
        `Invalid channel mapping configuration in parameter "${this.parameterName}": missing "mappings" array or "defaultChannelId"`,
      );
    }

    this.cachedConfig = parsed;
    return this.cachedConfig;
  }
}
