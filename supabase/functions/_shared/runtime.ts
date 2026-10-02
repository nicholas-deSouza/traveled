import { UploadService, type RuntimeConfig } from './upload-http.ts';
export function runtimeConfig(readEnv: (name: string) => string | undefined): RuntimeConfig {
  function required(name: string) { const value=readEnv(name); if (!value) throw new Error(`Missing runtime setting ${name}`); return value; }
  let keys: unknown;
  try { keys = JSON.parse(required('SUPABASE_SECRET_KEYS')); }
  catch { throw new Error('Missing or invalid runtime setting SUPABASE_SECRET_KEYS'); }
  const supabaseSecretKey = typeof keys === 'object' && keys !== null && !Array.isArray(keys)
    && Object.hasOwn(keys, 'default') ? (keys as Record<string, unknown>).default : undefined;
  if (typeof supabaseSecretKey !== 'string' || !supabaseSecretKey.startsWith('sb_secret_') || supabaseSecretKey.length <= 'sb_secret_'.length) {
    throw new Error('Missing or invalid default Supabase secret key');
  }
  return { url:required('SUPABASE_URL'),supabaseSecretKey,workerToken:required('PHOTO_UPLOAD_WORKER_TOKEN'),
    region:required('PHOTO_CLASSIFIER_AWS_REGION'),functionName:required('PHOTO_CLASSIFIER_FUNCTION_NAME'),accessKey:required('PHOTO_CLASSIFIER_AWS_ACCESS_KEY_ID'),
    secretKey:required('PHOTO_CLASSIFIER_AWS_SECRET_ACCESS_KEY'),sessionToken:readEnv('PHOTO_CLASSIFIER_AWS_SESSION_TOKEN') };
}
export function runtimeService() {
  return new UploadService(runtimeConfig(name => Deno.env.get(name)));
}
