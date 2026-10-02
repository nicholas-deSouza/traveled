import { invokeClassifier, sameToken, UploadService } from '../_shared/upload-http.ts';

export type Job = { submission_id: string; stage: 'original'|'candidate'|'publication'|'cleanup'; generation: number; attempt_id: string;
  source?: string; destination?: string; objects?: {bucket:string;path:string}[] };
export async function processJob(service: UploadService, job: Job, deadline=Date.now()+85_000) {
  const identity={submission_id:job.submission_id,stage:job.stage,generation:job.generation,attempt_id:job.attempt_id};
  let result: Record<string,unknown> = {...identity,outcome:'technical'};
  try {
    if (job.stage==='original' || job.stage==='candidate') {
      const output=await invokeClassifier(service.config,job,service.fetcher) as Record<string,unknown>;
      if (!output || typeof output!=='object' || Object.entries(identity).some(([key,value])=>output[key]!==value) ||
        !['approved','uncertain','rejected','invalid','technical','quota'].includes(String(output.outcome)) ||
        typeof output.sha256!=='string' || !/^[a-f0-9]{64}$/.test(output.sha256) || typeof output.bytes!=='number' || !Number.isSafeInteger(output.bytes)) {
        throw new Error('Classifier result identity is invalid');
      }
      result={...identity,outcome:output.outcome,sha256:output.sha256,bytes:output.bytes};
      if (typeof output.retry_after_seconds==='number' && Number.isFinite(output.retry_after_seconds) && output.retry_after_seconds>=0) result.retry_after_seconds=output.retry_after_seconds;
    } else if (job.stage==='publication') {
      if (!job.source || !job.destination) throw new Error('Publication reference missing');
      await service.copy(job.source,job.destination);
      result={...identity,outcome:'published'};
    } else {
      const removed: {bucket:string;path:string}[]=[];
      let failed=false;
      for (const object of (job.objects??[]).slice(0,20)) {
        if (Date.now()+5_000>=deadline) break;
        try { await service.remove(object.bucket,object.path); removed.push(object); } catch { failed=true; }
      }
      result={...identity,outcome:failed?'technical':'cleaned',removed};
    }
  } catch { /* No provider payload or credentials enter persistent errors. */ }
  return { finished: await service.rpc<boolean>('upload_finish',{result}), outcome: String(result.outcome) };
}
export function createWorkerHandler(service: UploadService, now=()=>Date.now(), wait=(milliseconds:number)=>new Promise<void>(resolve=>setTimeout(resolve,milliseconds))) {
  return async (request: Request): Promise<Response> => {
    if (request.method!=='POST') return Response.json({error:'Method not allowed'},{status:405});
    const token=request.headers.get('Authorization')?.replace(/^Bearer /,'')??'';
    if (!sameToken(token,service.config.workerToken)) return Response.json({error:'Unauthorized'},{status:401});
    const deadline=now()+90_000;
    // Bound the entire invocation, not each independent HTTP operation. Leave
    // five seconds after object IO to persist its result/partial cleanup.
    const bounded=new UploadService(service.config,(input,init)=>service.fetcher(input,{...init,
      signal:AbortSignal.timeout(Math.max(1,deadline-now()-(String(input).includes('/rpc/upload_finish')?0:5_000)))}));
    let processed=0;
    let cooldownPending=false;
    try {
      while (now()+65_000<deadline && processed<20) {
        const job=await bounded.rpc<Job|null>('upload_claim');
        if (!job) {
          // The database may briefly withhold another classification for its
          // global one-second cooldown. Wait once, then claim authoritatively
          // again. Empty queues and quota pauses never cause a polling loop.
          if (cooldownPending && now()+66_000<deadline) {
            cooldownPending=false;
            await wait(1_000);
            continue;
          }
          break;
        }
        const result=await processJob(bounded,job,deadline); processed++;
        if (job.stage==='original' || job.stage==='candidate') cooldownPending=result.finished && result.outcome!=='quota';
      }
      return Response.json({processed});
    } catch { return Response.json({error:'Worker could not finish; durable lease will be recovered'},{status:503}); }
  };
}
