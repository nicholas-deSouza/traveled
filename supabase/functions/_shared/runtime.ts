import { UploadService, type RuntimeConfig } from './upload-http.ts';
export function runtimeService() {
  function required(name: string) { const value=Deno.env.get(name); if (!value) throw new Error(`Missing runtime setting ${name}`); return value; }
  const config: RuntimeConfig = { url:required('SUPABASE_URL'),serviceKey:required('SUPABASE_SERVICE_ROLE_KEY'),workerToken:required('PHOTO_UPLOAD_WORKER_TOKEN'),
    region:required('PHOTO_CLASSIFIER_AWS_REGION'),functionName:required('PHOTO_CLASSIFIER_FUNCTION_NAME'),accessKey:required('PHOTO_CLASSIFIER_AWS_ACCESS_KEY_ID'),
    secretKey:required('PHOTO_CLASSIFIER_AWS_SECRET_ACCESS_KEY'),sessionToken:Deno.env.get('PHOTO_CLASSIFIER_AWS_SESSION_TOKEN') };
  return new UploadService(config);
}
