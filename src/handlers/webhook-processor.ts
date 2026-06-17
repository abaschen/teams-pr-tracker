/**
 * Webhook Processor - Lambda entry point for webhook events.
 *
 * Routes incoming requests by provider path, orchestrates:
 * verify signature → parse body → normalize event → (future: load state → process → persist → side effects)
 *
 * Returns:
 * - 200 for valid events and unrecognized event types
 * - 400 for malformed/unparseable payloads or unknown providers
 * - 401 for invalid signatures
 * - 503 for DynamoDB unavailability
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from '../models/api-gateway.js';
import type { Provider } from '../models/events.js';
import { SignatureVerifierImpl } from './signature-verifier.js';
import { getNormalizer } from '../normalizers/normalizer-factory.js';

/** Supported provider identifiers */
const SUPPORTED_PROVIDERS: ReadonlySet<string> = new Set(['github', 'bitbucket', 'gitlab']);

/** Environment variable names for webhook secrets by provider */
const SECRET_ENV_KEYS: Record<Provider, string> = {
  github: 'GITHUB_WEBHOOK_SECRET',
  bitbucket: 'BITBUCKET_WEBHOOK_SECRET',
  gitlab: 'GITLAB_WEBHOOK_SECRET',
};

/** Signature header names by provider */
const SIGNATURE_HEADERS: Record<Provider, string> = {
  github: 'x-hub-signature-256',
  bitbucket: 'x-hub-signature',
  gitlab: 'x-gitlab-token',
};

/** Event type header names by provider (used by normalizers) */
const EVENT_HEADERS: Record<Provider, string> = {
  github: 'x-github-event',
  bitbucket: 'x-event-key',
  gitlab: 'x-gitlab-event',
};

/**
 * Extracts the provider from the request path.
 * Expects path format: /webhook/{provider}
 * Returns the last path segment in lowercase or null if invalid.
 */
export function extractProvider(path: string): string | null {
  const segments = path.replace(/\/+$/, '').split('/').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1].toLowerCase() : null;
}

/**
 * Creates a JSON API Gateway response.
 */
function jsonResponse(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * Gets a header value case-insensitively.
 */
function getHeader(headers: Record<string, string | undefined>, name: string): string | undefined {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }
  return undefined;
}

const signatureVerifier = new SignatureVerifierImpl();

/**
 * Main Lambda handler for webhook processing.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const requestId = event.requestContext?.requestId ?? 'unknown';

  // 1. Extract provider from path
  const providerName = extractProvider(event.path);
  if (!providerName || !SUPPORTED_PROVIDERS.has(providerName)) {
    console.error(`[${requestId}] Unknown or missing provider in path: ${event.path}`);
    return jsonResponse(400, { error: 'Unknown provider', path: event.path });
  }

  const provider = providerName as Provider;

  // 2. Validate request body exists
  if (!event.body || event.body.trim() === '') {
    console.error(`[${requestId}] Missing or empty request body for ${provider}`);
    return jsonResponse(400, { error: 'Missing request body' });
  }

  const rawBody = event.body;

  // 3. Get webhook secret from environment
  const secretEnvKey = SECRET_ENV_KEYS[provider];
  const secret = process.env[secretEnvKey];
  if (!secret) {
    console.error(`[${requestId}] Missing webhook secret env var: ${secretEnvKey}`);
    return jsonResponse(401, { error: 'Webhook secret not configured' });
  }

  // 4. Extract signature header
  const signatureHeaderName = SIGNATURE_HEADERS[provider];
  const signature = getHeader(event.headers, signatureHeaderName) ?? '';

  // 5. Verify signature
  const isValid = signatureVerifier.verify(provider, rawBody, signature, secret);
  if (!isValid) {
    console.error(`[${requestId}] Invalid signature for ${provider} webhook`);
    return jsonResponse(401, { error: 'Invalid webhook signature' });
  }

  // 6. Parse JSON body
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch (parseError) {
    console.error(`[${requestId}] Malformed JSON payload for ${provider}:`, parseError);
    return jsonResponse(400, { error: 'Malformed JSON payload' });
  }

  // 7. Normalize the event
  const eventHeaderName = EVENT_HEADERS[provider];
  const eventHeader = getHeader(event.headers, eventHeaderName);

  const normalizer = getNormalizer(provider);
  const normalizedEvent = normalizer(parsedBody, eventHeader);

  if (normalizedEvent === null) {
    // Unrecognized event type - acknowledge with 200, no further action
    return jsonResponse(200, { message: 'Event acknowledged, no action required' });
  }

  // 8. For recognized events, return success
  // Full pipeline (load state → process → persist state → side effects) will be wired in task 12.1
  return jsonResponse(200, {
    message: 'Webhook processed successfully',
    provider,
    eventType: normalizedEvent.eventType,
    prId: normalizedEvent.prId,
  });
}
