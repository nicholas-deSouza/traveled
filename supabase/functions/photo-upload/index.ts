import { runtimeService } from '../_shared/runtime.ts';
import { createUploadHandler } from './handler.ts';
// Supabase injects this runtime global; Deno's standard library omits it.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };
const service=runtimeService();
Deno.serve(createUploadHandler(service,()=> {
  EdgeRuntime.waitUntil(fetch(`${service.config.url}/functions/v1/photo-upload-worker`,{method:'POST',
    headers:{Authorization:`Bearer ${service.config.workerToken}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(95_000)}).catch(()=>{}));
}));
