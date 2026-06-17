import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamsThreadManager } from '@managers/thread-manager.js';
import type { NormalizedPREvent } from '@models/events.js';
import type { ValidationTeamConfig } from '@models/rules.js';
import type { ThreadReference, ThreadUpdate, FinalStatus } from '@models/state.js';

describe('TeamsThreadManager', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let manager: TeamsThreadManager;

  const defaultConfig = {
    botId: 'test-bot-id',
    botPassword: 'test-bot-password',
    channelId: 'test-channel-id',
    serviceUrl: 'https://smba.trafficmanager.net/teams',
    tokenEndpoint: 'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token',
  };

  const samplePR: NormalizedPREvent = {
    provider: 'github',
    eventType: 'pr_opened',
    prId: '123',
    prTitle: 'Add new feature',
    prUrl: 'https://github.com/org/repo/pull/123',
    repositoryName: 'repo',
    repositoryFullName: 'org/repo',
    author: 'developer1',
    branch: 'feature/new-stuff',
    baseBranch: 'main',
    timestamp: '2024-01-15T10:00:00Z',
  };

  const sampleTeams: ValidationTeamConfig[] = [
    { teamName: 'Security', teamsTagId: 'tag-sec', reviewers: ['sec-rev1'] },
    { teamName: 'Architecture', teamsTagId: 'tag-arch', reviewers: ['arch-rev1', 'arch-rev2'] },
  ];

  const sampleThreadRef: ThreadReference = {
    conversationId: 'conv-123',
    activityId: 'activity-456',
    channelId: 'test-channel-id',
    serviceUrl: 'https://smba.trafficmanager.net/teams',
  };

  function createTokenResponse() {
    return {
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'test-token-abc',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockFetch = vi.fn();
    manager = new TeamsThreadManager({
      ...defaultConfig,
      fetchFn: mockFetch as unknown as typeof globalThis.fetch,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getToken', () => {
    it('should acquire a token from the Microsoft login endpoint', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());

      const token = await manager.getToken();

      expect(token).toBe('test-token-abc');
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledWith(
        defaultConfig.tokenEndpoint,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }),
      );

      // Verify body parameters
      const callBody = mockFetch.mock.calls[0][1].body as string;
      expect(callBody).toContain('grant_type=client_credentials');
      expect(callBody).toContain(`client_id=${defaultConfig.botId}`);
      expect(callBody).toContain(`client_secret=${defaultConfig.botPassword}`);
      expect(callBody).toContain('scope=https%3A%2F%2Fapi.botframework.com%2F.default');
    });

    it('should cache the token and not re-fetch within validity period', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());

      const token1 = await manager.getToken();
      const token2 = await manager.getToken();

      expect(token1).toBe(token2);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('should refresh the token when expired', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      const token1 = await manager.getToken();

      // Advance time past expiry (3600s - 300s buffer = 3300s worth)
      vi.advanceTimersByTime(3400 * 1000);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'refreshed-token',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
      });

      const token2 = await manager.getToken();

      expect(token1).toBe('test-token-abc');
      expect(token2).toBe('refreshed-token');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw when token acquisition fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      await expect(manager.getToken()).rejects.toThrow(
        'Failed to acquire Bot Framework token: 401 Unauthorized',
      );
    });
  });

  describe('createThread', () => {
    it('should POST to the conversations endpoint and return a ThreadReference', async () => {
      // Token fetch
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      // Create conversation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'new-conv-id',
            activityId: 'new-activity-id',
          }),
      });

      const result = await manager.createThread(samplePR, sampleTeams);

      expect(result).toEqual({
        conversationId: 'new-conv-id',
        activityId: 'new-activity-id',
        channelId: 'test-channel-id',
        serviceUrl: 'https://smba.trafficmanager.net/teams',
      });

      // Verify the POST to create conversation
      const [url, options] = mockFetch.mock.calls[1];
      expect(url).toBe('https://smba.trafficmanager.net/teams/v3/conversations');
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe('Bearer test-token-abc');

      const body = JSON.parse(options.body);
      expect(body.bot.id).toBe('test-bot-id');
      expect(body.isGroup).toBe(true);
      expect(body.channelData.channel.id).toBe('test-channel-id');
      expect(body.activity.type).toBe('message');
    });

    it('should compose message with PR metadata and team statuses', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'conv-1', activityId: 'act-1' }),
      });

      await manager.createThread(samplePR, sampleTeams);

      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      const message = body.activity.text;

      expect(message).toContain('Add new feature');
      expect(message).toContain('developer1');
      expect(message).toContain('org/repo');
      expect(message).toContain('feature/new-stuff');
      expect(message).toContain('https://github.com/org/repo/pull/123');
      expect(message).toContain('Security');
      expect(message).toContain('Architecture');
      expect(message).toContain('Pending');
    });

    it('should retry on Teams API errors with exponential backoff', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      // First attempt fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });
      // Second attempt fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });
      // Third attempt succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'conv-retry', activityId: 'act-retry' }),
      });

      const resultPromise = manager.createThread(samplePR, sampleTeams);

      // Advance past first retry delay (1s)
      await vi.advanceTimersByTimeAsync(1000);
      // Advance past second retry delay (2s)
      await vi.advanceTimersByTimeAsync(2000);

      const result = await resultPromise;

      expect(result.conversationId).toBe('conv-retry');
      // 1 token call + 3 conversation attempts = 4 total
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('should throw after all retry attempts are exhausted', async () => {
      vi.useRealTimers();

      // Create a manager with minimal retry delay for fast testing
      const fastManager = new TeamsThreadManager({
        ...defaultConfig,
        fetchFn: mockFetch as unknown as typeof globalThis.fetch,
      });

      mockFetch.mockResolvedValueOnce(createTokenResponse());
      // All 3 attempts fail
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(fastManager.createThread(samplePR, sampleTeams)).rejects.toThrow(
        'Teams API error: 500 Internal Server Error',
      );

      // 1 token call + 3 conversation attempts = 4 total
      expect(mockFetch).toHaveBeenCalledTimes(4);

      vi.useFakeTimers();
    });
  });

  describe('postUpdate', () => {
    it('should POST a reply to the existing thread', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      const update: ThreadUpdate = {
        eventType: 'review_submitted',
        actor: 'reviewer1',
        summary: 'Approved with comments',
        timestamp: '2024-01-15T11:00:00Z',
      };

      await manager.postUpdate(sampleThreadRef, update);

      const [url, options] = mockFetch.mock.calls[1];
      expect(url).toBe(
        'https://smba.trafficmanager.net/teams/v3/conversations/conv-123/activities',
      );
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body);
      expect(body.type).toBe('message');
      expect(body.replyToId).toBe('activity-456');
      expect(body.text).toContain('review_submitted');
      expect(body.text).toContain('reviewer1');
      expect(body.text).toContain('Approved with comments');
    });

    it('should retry on failure', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      const update: ThreadUpdate = {
        eventType: 'comment_added',
        actor: 'user2',
        summary: 'Left a comment',
        timestamp: '2024-01-15T12:00:00Z',
      };

      const resultPromise = manager.postUpdate(sampleThreadRef, update);
      await vi.advanceTimersByTimeAsync(1000);
      await resultPromise;

      // 1 token + 2 activity posts
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('closeThread', () => {
    it('should POST a final merged status message', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      const finalStatus: FinalStatus = {
        outcome: 'merged',
        actor: 'developer1',
        approvedTeams: ['Security', 'Architecture'],
        pendingTeams: [],
        timestamp: '2024-01-16T09:00:00Z',
      };

      await manager.closeThread(sampleThreadRef, finalStatus);

      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.text).toContain('Merged');
      expect(body.text).toContain('developer1');
      expect(body.text).toContain('Security, Architecture');
      expect(body.text).toContain('✅');
      expect(body.replyToId).toBe('activity-456');
    });

    it('should POST a final closed status message with pending teams', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      const finalStatus: FinalStatus = {
        outcome: 'closed',
        actor: 'author1',
        approvedTeams: ['Security'],
        pendingTeams: ['Architecture'],
        timestamp: '2024-01-16T09:00:00Z',
      };

      await manager.closeThread(sampleThreadRef, finalStatus);

      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.text).toContain('Closed');
      expect(body.text).toContain('author1');
      expect(body.text).toContain('❌');
      expect(body.text).toContain('Architecture');
    });

    it('should display "None" when no teams are approved or pending', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      const finalStatus: FinalStatus = {
        outcome: 'closed',
        actor: 'author1',
        approvedTeams: [],
        pendingTeams: [],
        timestamp: '2024-01-16T09:00:00Z',
      };

      await manager.closeThread(sampleThreadRef, finalStatus);

      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.text).toContain('**Approved:** None');
      expect(body.text).toContain('**Pending:** None');
    });
  });

  describe('updateMentions (stub)', () => {
    it('should resolve without errors', async () => {
      await expect(
        manager.updateMentions(sampleThreadRef, ['Security'], ['Architecture']),
      ).resolves.toBeUndefined();
    });
  });

  describe('updateReadinessReaction (stub)', () => {
    it('should resolve without errors', async () => {
      await expect(
        manager.updateReadinessReaction(sampleThreadRef, true),
      ).resolves.toBeUndefined();
    });
  });

  describe('composeCreateMessage', () => {
    it('should include all required PR metadata fields', () => {
      const message = manager.composeCreateMessage(samplePR, sampleTeams);

      expect(message).toContain('Add new feature');
      expect(message).toContain('developer1');
      expect(message).toContain('org/repo');
      expect(message).toContain('feature/new-stuff');
      expect(message).toContain('https://github.com/org/repo/pull/123');
    });

    it('should include all team names with pending status', () => {
      const message = manager.composeCreateMessage(samplePR, sampleTeams);

      expect(message).toContain('Security: ⏳ Pending');
      expect(message).toContain('Architecture: ⏳ Pending');
    });

    it('should handle empty teams list', () => {
      const message = manager.composeCreateMessage(samplePR, []);

      expect(message).toContain('Add new feature');
      expect(message).toContain('Required Approvals');
    });
  });

  describe('composeUpdateMessage', () => {
    it('should include event type, actor, and summary', () => {
      const update: ThreadUpdate = {
        eventType: 'review_submitted',
        actor: 'reviewer1',
        summary: 'Approved changes',
        timestamp: '2024-01-15T11:00:00Z',
      };

      const message = manager.composeUpdateMessage(update);

      expect(message).toContain('review_submitted');
      expect(message).toContain('reviewer1');
      expect(message).toContain('Approved changes');
    });
  });

  describe('composeCloseMessage', () => {
    it('should format merged outcome with checkmark', () => {
      const status: FinalStatus = {
        outcome: 'merged',
        actor: 'dev1',
        approvedTeams: ['Team A', 'Team B'],
        pendingTeams: [],
        timestamp: '2024-01-16T09:00:00Z',
      };

      const message = manager.composeCloseMessage(status);

      expect(message).toContain('✅');
      expect(message).toContain('Merged');
      expect(message).toContain('dev1');
      expect(message).toContain('Team A, Team B');
      expect(message).toContain('**Pending:** None');
    });

    it('should format closed outcome with cross mark', () => {
      const status: FinalStatus = {
        outcome: 'closed',
        actor: 'dev2',
        approvedTeams: [],
        pendingTeams: ['Team C'],
        timestamp: '2024-01-16T09:00:00Z',
      };

      const message = manager.composeCloseMessage(status);

      expect(message).toContain('❌');
      expect(message).toContain('Closed');
      expect(message).toContain('dev2');
      expect(message).toContain('**Approved:** None');
      expect(message).toContain('Team C');
    });
  });
});
