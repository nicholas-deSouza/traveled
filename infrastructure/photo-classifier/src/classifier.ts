import { createHash } from 'node:crypto';
import type { ClassificationRequest, ClassificationResult } from '../../../src/lib/photoUploadContract.ts';

export const ORIGINAL_LIMIT = 20 * 1024 * 1024;
export const CANDIDATE_LIMIT = 8 * 1024 * 1024;
export const PIXEL_LIMIT = 50_000_000;
export class InvalidImage extends Error {}
export type PreparedImage = { bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' | 'image/webp' };
export type Dependencies = {
  download: (request: ClassificationRequest, signal: AbortSignal) => Promise<Uint8Array>;
  prepare: (bytes: Uint8Array, stage: ClassificationRequest['stage']) => Promise<PreparedImage>;
  moderate: (image: PreparedImage, signal: AbortSignal) => Promise<{ status: number; body: unknown; retryAfter?: string | null }>;
};

/** Reject request-controlled origins and object identities before any privileged read. */
export function validateRequest(value: unknown): ClassificationRequest {
  if (!value || typeof value !== 'object') throw new Error('Invalid classification request');
  const r = value as ClassificationRequest;
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const identity = new RegExp(`^${uuid}$`, 'i');
  if (!identity.test(r.submission_id) || !identity.test(r.attempt_id) || r.bucket !== 'photo-quarantine'
      || !['original', 'candidate'].includes(r.stage) || !Number.isSafeInteger(r.generation)
      || (r.stage === 'original' ? r.generation !== 0 : r.generation < 1)
      || !/^[0-9a-f]{64}$/.test(r.expected_sha256)
      || !Number.isSafeInteger(r.expected_bytes) || r.expected_bytes < 1
      || r.expected_bytes > (r.stage === 'original' ? ORIGINAL_LIMIT : CANDIDATE_LIMIT)) {
    throw new Error('Invalid classification request');
  }
  const suffix = r.stage === 'original' ? 'original' : `candidate-${r.generation}.webp`;
  if (typeof r.path !== 'string' || !new RegExp(`^${uuid}/${r.submission_id}/${suffix.replace('.', '\\.')}$`, 'i').test(r.path)) {
    throw new Error('Invalid classification path');
  }
  return r;
}

/** Only the three agreed numeric scores can approve bytes. Provider messages never escape. */
export function providerOutcome(status: number, value: unknown, retryAfter?: string | null): Pick<ClassificationResult, 'outcome' | 'error' | 'retry_after_seconds'> {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const error = body.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : {};
  // Sightengine documents error.type=usage_limit; message fallback only authorizes a pause.
  const quotaText = `${error.code ?? ''} ${error.message ?? ''}`;
  if (status === 429 || (body.status !== 'success' && (error.type === 'usage_limit' || /quota|operations? limit|usage limit|daily limit|monthly limit|too many requests/i.test(quotaText)))) {
    const parsed = retryAfter && /^\d+$/.test(retryAfter)
      ? Number(retryAfter) : retryAfter ? Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000) : 60;
    const seconds = Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 2147483647 ? parsed : 60;
    return { outcome: 'quota', error: 'Moderation allowance unavailable', retry_after_seconds: seconds };
  }
  if (status < 200 || status >= 300 || body.status !== 'success') return { outcome: 'technical', error: 'Moderation service failed' };
  const nudity = body.nudity && typeof body.nudity === 'object' ? body.nudity as Record<string, unknown> : {};
  const scores = ['sexual_activity', 'sexual_display', 'erotica'].map(key => nudity[key]);
  if (scores.some(s => typeof s !== 'number' || !Number.isFinite(s) || s < 0 || s > 1)) {
    return { outcome: 'technical', error: 'Invalid moderation response' };
  }
  const max = Math.max(...scores as number[]);
  return { outcome: max >= 0.8 ? 'rejected' : max >= 0.2 ? 'uncertain' : 'approved' };
}

export function createClassifier(deps: Dependencies) {
  return async (event: unknown): Promise<ClassificationResult> => {
    const request = validateRequest(event);
    const identity = {
      submission_id: request.submission_id, stage: request.stage, generation: request.generation,
      attempt_id: request.attempt_id,
    };
    // Pre-download failures echo expected identity; only approved/content outcomes verify actual bytes.
    let sha256 = request.expected_sha256; let bytes = request.expected_bytes;
    // Keep enough Lambda wall time for returning an explicit failure rather than timing out.
    const signal = AbortSignal.timeout(52_000);
    try {
      const original = await deps.download(request, signal);
      bytes = original.byteLength;
      sha256 = createHash('sha256').update(original).digest('hex');
      if (bytes !== request.expected_bytes || sha256 !== request.expected_sha256) {
        return { ...identity, sha256, bytes, outcome: 'invalid', error: 'Stored image identity mismatch' };
      }
      const image = await deps.prepare(original, request.stage);
      const response = await deps.moderate(image, signal);
      return { ...identity, sha256, bytes, ...providerOutcome(response.status, response.body, response.retryAfter) };
    } catch (error) {
      return { ...identity, sha256, bytes, outcome: error instanceof InvalidImage ? 'invalid' : 'technical',
        error: error instanceof InvalidImage ? error.message : 'Classification unavailable' };
    }
  };
}
