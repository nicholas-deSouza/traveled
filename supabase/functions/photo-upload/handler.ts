import { ServiceError, UploadService } from '../_shared/upload-http.ts';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const digest = /^[a-f0-9]{64}$/;
const actions = new Set(['admit','list','reconcile','original_uploaded','gps','candidate','candidate_uploaded','recover','retry','cancel','delete','browser_failure']);
export async function readUploadBody(request: Request, signal: AbortSignal): Promise<string> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = '', completed = false;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw new ServiceError('Upload request timed out',408);
      const chunk = await reader.read();
      if (signal.aborted) throw new ServiceError('Upload request timed out',408);
      if (chunk.done) { completed = true; return text + decoder.decode(); }
      bytes += chunk.value.byteLength;
      if (bytes>16_384) throw new ServiceError('Upload request is too large',413);
      text += decoder.decode(chunk.value,{stream:true});
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!completed) cancel();
    reader.releaseLock();
  }
}
export function validateCommand(value: unknown): Record<string, unknown> {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new ServiceError('Invalid upload request',400);
  const body = value as Record<string,unknown>;
  if (!actions.has(String(body.action))) throw new ServiceError('Unknown upload action',400);
  if (body.action!=='list' && (typeof body.id!=='string' || !uuid.test(body.id))) throw new ServiceError('Invalid submission identity',400);
  if (body.action==='admit' || body.action==='candidate') {
    if (typeof body.request_id!=='string' || !uuid.test(body.request_id)) throw new ServiceError('Invalid request identity',400);
  }
  if (body.action==='admit') {
    if (typeof body.trip_id!=='string' || !uuid.test(body.trip_id) || typeof body.filename!=='string' ||
      body.filename.length<1 || body.filename.length>255 || typeof body.source_sha256!=='string' || !digest.test(body.source_sha256) ||
      typeof body.source_bytes!=='number' || !Number.isInteger(body.source_bytes) || body.source_bytes<1 || body.source_bytes>20*1024*1024) {
      throw new ServiceError('Invalid original photo',400);
    }
  }
  if (body.action==='candidate_uploaded' && (typeof body.generation!=='number' || !Number.isInteger(body.generation) || body.generation<1 ||
    typeof body.sha256!=='string' || !digest.test(body.sha256) || typeof body.bytes!=='number' || !Number.isInteger(body.bytes) || body.bytes<1 || body.bytes>8*1024*1024)) {
    throw new ServiceError('Invalid candidate photo',400);
  }
  if (body.action==='gps') {
    const { latitude, longitude } = body;
    if (!(latitude===null && longitude===null) && !(typeof latitude==='number' && typeof longitude==='number' &&
      Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude)<=90 && Math.abs(longitude)<=180)) throw new ServiceError('Invalid GPS acknowledgment',400);
  }
  if (body.action==='browser_failure' && (!['original_upload','gps','processing','candidate_upload'].includes(String(body.stage)) ||
    typeof body.generation!=='number' || !Number.isInteger(body.generation) || body.generation<1)) throw new ServiceError('Invalid browser stage',400);
  return body;
}
export function createUploadHandler(service: UploadService, nudge: () => void = () => {}) {
  const cors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods':'POST, OPTIONS' };
  return async (request: Request): Promise<Response> => {
    if (request.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
    if (request.method!=='POST') return Response.json({error:'Method not allowed'},{status:405,headers:cors});
    try {
      const deadline=Date.now()+90_000;
      const bounded=new UploadService(service.config,(input,init)=>service.fetcher(input,{...init,
        signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))}));
      const text = await readUploadBody(request,AbortSignal.timeout(Math.max(1,deadline-Date.now())));
      let parsed: unknown;
      try { parsed=JSON.parse(text); } catch { throw new ServiceError('Invalid upload request',400); }
      const command=validateCommand(parsed);
      const actor=await bounded.user(request);
      const response=await bounded.rpc('upload_command',{actor,command});
      if (['admit','original_uploaded','candidate_uploaded','retry','cancel','delete','reconcile'].includes(String(command.action))) nudge();
      return Response.json(response,{headers:cors});
    } catch (error) {
      const status=error instanceof ServiceError && error.status>=400 && error.status<500 ? error.status : 503;
      return Response.json({error:error instanceof ServiceError ? error.message : 'Upload service is temporarily unavailable'},{status,headers:cors});
    }
  };
}
