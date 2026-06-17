import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { SignatureVerifierImpl } from '../../src/handlers/signature-verifier.js';

describe('SignatureVerifierImpl', () => {
  const verifier = new SignatureVerifierImpl();
  const secret = 'test-webhook-secret';
  const payload = JSON.stringify({ action: 'opened', pull_request: { number: 1 } });

  function computeHmac(body: string, key: string): string {
    return createHmac('sha256', key).update(body, 'utf8').digest('hex');
  }

  describe('GitHub signature verification', () => {
    it('should return true for a valid sha256 signature', () => {
      const hmac = computeHmac(payload, secret);
      const signature = `sha256=${hmac}`;

      expect(verifier.verify('github', payload, signature, secret)).toBe(true);
    });

    it('should return false for an invalid signature', () => {
      const signature = 'sha256=deadbeef0000000000000000000000000000000000000000000000000000abcd';

      expect(verifier.verify('github', payload, signature, secret)).toBe(false);
    });

    it('should return false for a missing signature (empty string)', () => {
      expect(verifier.verify('github', payload, '', secret)).toBe(false);
    });

    it('should return false for signature without sha256= prefix', () => {
      const hmac = computeHmac(payload, secret);

      expect(verifier.verify('github', payload, hmac, secret)).toBe(false);
    });

    it('should return false when signature is computed with wrong secret', () => {
      const wrongHmac = computeHmac(payload, 'wrong-secret');
      const signature = `sha256=${wrongHmac}`;

      expect(verifier.verify('github', payload, signature, secret)).toBe(false);
    });

    it('should return false for a tampered payload', () => {
      const hmac = computeHmac(payload, secret);
      const signature = `sha256=${hmac}`;
      const tamperedPayload = JSON.stringify({ action: 'closed' });

      expect(verifier.verify('github', tamperedPayload, signature, secret)).toBe(false);
    });
  });

  describe('Bitbucket signature verification', () => {
    it('should return true for a valid HMAC-SHA256 hex signature', () => {
      const signature = computeHmac(payload, secret);

      expect(verifier.verify('bitbucket', payload, signature, secret)).toBe(true);
    });

    it('should return false for an invalid signature', () => {
      const signature = 'deadbeef0000000000000000000000000000000000000000000000000000abcd';

      expect(verifier.verify('bitbucket', payload, signature, secret)).toBe(false);
    });

    it('should return false for a missing signature (empty string)', () => {
      expect(verifier.verify('bitbucket', payload, '', secret)).toBe(false);
    });

    it('should return false when signature is computed with wrong secret', () => {
      const wrongSignature = computeHmac(payload, 'wrong-secret');

      expect(verifier.verify('bitbucket', payload, wrongSignature, secret)).toBe(false);
    });

    it('should return false for a tampered payload', () => {
      const signature = computeHmac(payload, secret);
      const tamperedPayload = JSON.stringify({ action: 'closed' });

      expect(verifier.verify('bitbucket', tamperedPayload, signature, secret)).toBe(false);
    });
  });

  describe('GitLab token verification', () => {
    it('should return true when token matches the configured secret', () => {
      expect(verifier.verify('gitlab', payload, secret, secret)).toBe(true);
    });

    it('should return false when token does not match the secret', () => {
      expect(verifier.verify('gitlab', payload, 'wrong-token', secret)).toBe(false);
    });

    it('should return false for a missing token (empty string)', () => {
      expect(verifier.verify('gitlab', payload, '', secret)).toBe(false);
    });

    it('should return false for partial token match', () => {
      expect(verifier.verify('gitlab', payload, secret.slice(0, 5), secret)).toBe(false);
    });

    it('should not be affected by payload content (token-only check)', () => {
      const differentPayload = JSON.stringify({ different: 'data' });

      expect(verifier.verify('gitlab', differentPayload, secret, secret)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty payload with valid GitHub signature', () => {
      const emptyPayload = '';
      const hmac = computeHmac(emptyPayload, secret);
      const signature = `sha256=${hmac}`;

      expect(verifier.verify('github', emptyPayload, signature, secret)).toBe(true);
    });

    it('should handle empty payload with valid Bitbucket signature', () => {
      const emptyPayload = '';
      const signature = computeHmac(emptyPayload, secret);

      expect(verifier.verify('bitbucket', emptyPayload, signature, secret)).toBe(true);
    });

    it('should handle unicode payload correctly', () => {
      const unicodePayload = JSON.stringify({ title: '修复 bug: résumé → done' });
      const hmac = computeHmac(unicodePayload, secret);
      const signature = `sha256=${hmac}`;

      expect(verifier.verify('github', unicodePayload, signature, secret)).toBe(true);
    });

    it('should handle large payloads', () => {
      const largePayload = JSON.stringify({ data: 'x'.repeat(100_000) });
      const hmac = computeHmac(largePayload, secret);
      const signature = `sha256=${hmac}`;

      expect(verifier.verify('github', largePayload, signature, secret)).toBe(true);
    });
  });
});
