import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { ChannelMapper } from '@managers/channel-mapper.js';

describe('ChannelMapper', () => {
  let mockSend: ReturnType<typeof vi.fn>;
  let mapper: ChannelMapper;

  const sampleConfig = {
    mappings: [
      {
        repositoryPattern: 'org/frontend-app',
        channelId: 'channel-frontend',
        serviceUrl: 'https://smba.trafficmanager.net/teams/frontend',
      },
      {
        repositoryPattern: 'org/backend-*',
        channelId: 'channel-backend',
        serviceUrl: 'https://smba.trafficmanager.net/teams/backend',
      },
      {
        repositoryPattern: 'data-team/**',
        channelId: 'channel-data',
        serviceUrl: 'https://smba.trafficmanager.net/teams/data',
      },
    ],
    defaultChannelId: 'channel-default',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
    const mockClient = { send: mockSend } as unknown as SSMClient;
    mapper = new ChannelMapper({
      ssmClient: mockClient,
      parameterName: '/pr-tracker/channel-mappings',
    });
  });

  describe('resolveChannel', () => {
    it('should match an exact repository name', async () => {
      mockSend.mockResolvedValueOnce({
        Parameter: { Value: JSON.stringify(sampleConfig) },
      });

      const result = await mapper.resolveChannel('org/frontend-app');

      expect(result).toEqual({
        channelId: 'channel-frontend',
        serviceUrl: 'https://smba.trafficmanager.net/teams/frontend',
      });
    });

    it('should match a glob pattern (org/backend-*)', async () => {
      mockSend.mockResolvedValueOnce({
        Parameter: { Value: JSON.stringify(sampleConfig) },
      });

      const result = await mapper.resolveChannel('org/backend-api');

      expect(result).toEqual({
        channelId: 'channel-backend',
        serviceUrl: 'https://smba.trafficmanager.net/teams/backend',
      });
    });

    it('should match a glob pattern with double-star (data-team/**)', async () => {
      mockSend.mockResolvedValueOnce({
        Parameter: { Value: JSON.stringify(sampleConfig) },
      });

      const result = await mapper.resolveChannel('data-team/analytics/pipeline');

      expect(result).toEqual({
        channelId: 'channel-data',
        serviceUrl: 'https://smba.trafficmanager.net/teams/data',
      });
    });

    it('should return the default channel when no pattern matches', async () => {
      mockSend.mockResolvedValueOnce({
        Parameter: { Value: JSON.stringify(sampleConfig) },
      });

      const result = await mapper.resolveChannel('unknown-org/some-repo');

      expect(result).toEqual({
        channelId: 'channel-default',
        serviceUrl: 'https://smba.trafficmanager.net/teams',
      });
    });

    it('should return the first matching pattern when multiple match', async () => {
      const configWithOverlap = {
        mappings: [
          {
            repositoryPattern: 'org/*',
            channelId: 'channel-org-all',
            serviceUrl: 'https://smba.trafficmanager.net/teams/org',
          },
          {
            repositoryPattern: 'org/specific-repo',
            channelId: 'channel-specific',
            serviceUrl: 'https://smba.trafficmanager.net/teams/specific',
          },
        ],
        defaultChannelId: 'channel-default',
      };

      mockSend.mockResolvedValueOnce({
        Parameter: { Value: JSON.stringify(configWithOverlap) },
      });

      // The first pattern matches, so it should win
      const result = await mapper.resolveChannel('org/specific-repo');

      expect(result).toEqual({
        channelId: 'channel-org-all',
        serviceUrl: 'https://smba.trafficmanager.net/teams/org',
      });
    });

    it('should cache the config and only call SSM once', async () => {
      mockSend.mockResolvedValueOnce({
        Parameter: { Value: JSON.stringify(sampleConfig) },
      });

      await mapper.resolveChannel('org/frontend-app');
      await mapper.resolveChannel('org/backend-api');
      await mapper.resolveChannel('unknown-org/repo');

      expect(mockSend).toHaveBeenCalledOnce();
    });

    it('should throw when SSM parameter is not found', async () => {
      mockSend.mockResolvedValueOnce({
        Parameter: undefined,
      });

      await expect(mapper.resolveChannel('org/repo')).rejects.toThrow(
        'Channel mapping parameter "/pr-tracker/channel-mappings" not found or has no value',
      );
    });

    it('should throw when SSM parameter value is empty', async () => {
      mockSend.mockResolvedValueOnce({
        Parameter: { Value: undefined },
      });

      await expect(mapper.resolveChannel('org/repo')).rejects.toThrow(
        'Channel mapping parameter "/pr-tracker/channel-mappings" not found or has no value',
      );
    });

    it('should throw when SSM parameter contains invalid JSON', async () => {
      mockSend.mockResolvedValueOnce({
        Parameter: { Value: 'not valid json{{{' },
      });

      await expect(mapper.resolveChannel('org/repo')).rejects.toThrow();
    });

    it('should throw when config is missing mappings array', async () => {
      mockSend.mockResolvedValueOnce({
        Parameter: { Value: JSON.stringify({ defaultChannelId: 'ch-1' }) },
      });

      await expect(mapper.resolveChannel('org/repo')).rejects.toThrow(
        'Invalid channel mapping configuration',
      );
    });

    it('should throw when config is missing defaultChannelId', async () => {
      mockSend.mockResolvedValueOnce({
        Parameter: { Value: JSON.stringify({ mappings: [] }) },
      });

      await expect(mapper.resolveChannel('org/repo')).rejects.toThrow(
        'Invalid channel mapping configuration',
      );
    });

    it('should throw when SSM client returns an error', async () => {
      mockSend.mockRejectedValueOnce(new Error('ParameterNotFound'));

      await expect(mapper.resolveChannel('org/repo')).rejects.toThrow('ParameterNotFound');
    });
  });

  describe('constructor defaults', () => {
    it('should use default parameter name when not specified', async () => {
      const localMockSend = vi.fn().mockResolvedValueOnce({
        Parameter: { Value: JSON.stringify(sampleConfig) },
      });
      const localMockClient = { send: localMockSend } as unknown as SSMClient;
      const defaultMapper = new ChannelMapper({ ssmClient: localMockClient });

      await defaultMapper.resolveChannel('org/frontend-app');

      const call = localMockSend.mock.calls[0][0] as GetParameterCommand;
      expect(call.input.Name).toBe('/pr-tracker/channel-mappings');
    });

    it('should use CHANNEL_MAPPING_PARAM env var when set', async () => {
      const originalEnv = process.env.CHANNEL_MAPPING_PARAM;
      process.env.CHANNEL_MAPPING_PARAM = '/custom/param/path';

      try {
        const localMockSend = vi.fn().mockResolvedValueOnce({
          Parameter: { Value: JSON.stringify(sampleConfig) },
        });
        const localMockClient = { send: localMockSend } as unknown as SSMClient;
        const envMapper = new ChannelMapper({ ssmClient: localMockClient });

        await envMapper.resolveChannel('org/frontend-app');

        const call = localMockSend.mock.calls[0][0] as GetParameterCommand;
        expect(call.input.Name).toBe('/custom/param/path');
      } finally {
        if (originalEnv === undefined) {
          delete process.env.CHANNEL_MAPPING_PARAM;
        } else {
          process.env.CHANNEL_MAPPING_PARAM = originalEnv;
        }
      }
    });
  });
});
