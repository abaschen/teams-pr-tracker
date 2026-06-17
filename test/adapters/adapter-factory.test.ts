import { describe, it, expect } from 'vitest';
import { getAdapter } from '../../src/adapters/adapter-factory.js';

describe('adapter-factory', () => {
  describe('getAdapter', () => {
    it('throws for an unsupported provider string', () => {
      expect(() => getAdapter('unknown' as never)).toThrow(
        'Unsupported provider: "unknown"'
      );
    });

    it('throws "not yet implemented" for github until adapter is wired', () => {
      expect(() => getAdapter('github')).toThrow(
        'Adapter for provider "github" is not yet implemented'
      );
    });

    it('throws "not yet implemented" for bitbucket until adapter is wired', () => {
      expect(() => getAdapter('bitbucket')).toThrow(
        'Adapter for provider "bitbucket" is not yet implemented'
      );
    });

    it('throws "not yet implemented" for gitlab until adapter is wired', () => {
      expect(() => getAdapter('gitlab')).toThrow(
        'Adapter for provider "gitlab" is not yet implemented'
      );
    });
  });
});
