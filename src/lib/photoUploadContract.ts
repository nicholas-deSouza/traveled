/** Wire contract shared by the browser and trusted upload API. No verdicts or paths are client-authored. */
export const UPLOAD_LIMITS = {
  originalBytes: 20 * 1024 * 1024, candidateBytes: 8 * 1024 * 1024,
  pixels: 50_000_000, longEdge: 2560, quality: 0.8, queue: 100,
  budgetBytes: 800 * 1024 * 1024, expiryDays: 7, automaticRetries: 4,
} as const;
export type UploadPhase = 'original_upload' | 'original_check' | 'gps' | 'processing' | 'candidate_upload' | 'candidate_check' | 'publication' | 'complete';
export type UploadOutcome = 'published' | 'rejected' | 'invalid' | 'canceled' | 'expired' | 'deleted' | 'access_revoked' | null;
export type UploadSubmission = {
  id: string; trip_id: string; user_id: string; filename: string | null;
  phase: UploadPhase; outcome: UploadOutcome; generation: number;
  created_at: string; expires_at: string; gps_acknowledged: boolean;
  latitude: number | null; longitude: number | null;
  source_sha256: string | null; source_bytes: number | null;
  retry_at: string | null; attempts: number; error: string | null;
  // Admission and queue pauses are browser feedback from rejected admission requests.
  pause_reason: 'quota' | 'capacity' | 'admission' | 'queue' | 'technical' | null;
  cleanup_pending: boolean;
};
export type UploadTarget = { bucket: 'photo-quarantine'; path: string; generation: number };
export type UploadRequest =
  | { action: 'admit'; id: string; request_id: string; trip_id: string; filename: string; source_sha256: string; source_bytes: number }
  | { action: 'list' }
  | { action: 'reconcile'; id: string }
  | { action: 'original_uploaded'; id: string }
  | { action: 'gps'; id: string; latitude: number | null; longitude: number | null }
  | { action: 'candidate'; id: string; request_id: string }
  | { action: 'candidate_uploaded'; id: string; generation: number; sha256: string; bytes: number }
  | { action: 'recover'; id: string }
  | { action: 'browser_failure'; id: string; generation: number; stage: 'original_upload' | 'gps' | 'processing' | 'candidate_upload' }
  | { action: 'retry' | 'cancel'; id: string }
  | { action: 'delete'; id: string };
export type UploadResponse = { submission?: UploadSubmission; submissions?: UploadSubmission[]; target?: UploadTarget; recovery_path?: string };
export type ClassificationRequest = {
  submission_id: string; stage: 'original' | 'candidate'; generation: number; attempt_id: string;
  bucket: 'photo-quarantine'; path: string; expected_sha256: string; expected_bytes: number;
};
export type ClassificationResult = {
  submission_id: string; stage: 'original' | 'candidate'; generation: number; attempt_id: string;
  sha256: string; bytes: number;
  outcome: 'approved' | 'uncertain' | 'rejected' | 'invalid' | 'technical' | 'quota';
  error?: string; retry_after_seconds?: number;
};
export function retryDelay(attempt: number, random = Math.random, minimumMs = 0) {
  return Math.max(minimumMs, (2 ** attempt + random()) * 1000);
}
