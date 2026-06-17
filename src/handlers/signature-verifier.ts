/**
 * Signature Verifier - validates webhook authenticity for each provider.
 *
 * - GitHub: HMAC-SHA256 via X-Hub-Signature-256 header (format: sha256=<hex>)
 * - Bitbucket: HMAC-SHA256 via X-Hub-Signature header (raw hex)
 * - GitLab: Token comparison via X-Gitlab-Token header
 *
 * All comparisons use timing-safe equality to prevent timing attacks.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Provider } from '../models/events.js';
import type { SignatureVerifier } from '../models/interfaces.js';

/**
 * Performs a constant-time string comparison to prevent timing attacks.
 * Returns false if either string is empty.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) {
    return false;
  }

  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

/**
 * Computes HMAC-SHA256 of the payload using the given secret and returns the hex digest.
 */
function computeHmacSha256(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/**
 * Verifies a GitHub webhook signature.
 * Expects signature in format: sha256=<hex>
 */
function verifyGitHub(payload: string, signature: string, secret: string): boolean {
  if (!signature || !signature.startsWith('sha256=')) {
    return false;
  }

  const expectedHex = computeHmacSha256(payload, secret);
  const receivedHex = signature.slice('sha256='.length);

  return constantTimeEqual(expectedHex, receivedHex);
}

/**
 * Verifies a Bitbucket webhook signature.
 * Expects raw hex HMAC-SHA256 signature.
 */
function verifyBitbucket(payload: string, signature: string, secret: string): boolean {
  if (!signature) {
    return false;
  }

  const expectedHex = computeHmacSha256(payload, secret);

  return constantTimeEqual(expectedHex, signature);
}

/**
 * Verifies a GitLab webhook token.
 * Simple constant-time comparison of the token header value with the configured secret.
 */
function verifyGitLab(_payload: string, token: string, secret: string): boolean {
  if (!token) {
    return false;
  }

  return constantTimeEqual(token, secret);
}

/**
 * Implementation of the SignatureVerifier interface.
 * Routes verification to the appropriate provider-specific strategy.
 */
export class SignatureVerifierImpl implements SignatureVerifier {
  verify(provider: Provider, payload: string, signature: string, secret: string): boolean {
    switch (provider) {
      case 'github':
        return verifyGitHub(payload, signature, secret);
      case 'bitbucket':
        return verifyBitbucket(payload, signature, secret);
      case 'gitlab':
        return verifyGitLab(payload, signature, secret);
      default:
        return false;
    }
  }
}
