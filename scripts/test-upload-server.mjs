import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const cache=new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const output=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};cache.set(path,module.exports);
  const scopedRequire=name=>name.startsWith('.') ? load(resolve(dirname(path),name)) : require(name);
  vm.runInNewContext(output,{exports:module.exports,module,require:scopedRequire,Request,Response,Headers,AbortSignal,TextEncoder,TextDecoder,crypto:webcrypto,console,Date,Set,Map,Uint8Array});
  return module.exports;
}
const {UploadService,invokeClassifier,sameToken}=load(resolve(root,'supabase/functions/_shared/upload-http.ts'));
const {createUploadHandler,readUploadBody,validateCommand}=load(resolve(root,'supabase/functions/photo-upload/handler.ts'));
const {createWorkerHandler,processJob}=load(resolve(root,'supabase/functions/photo-upload-worker/handler.ts'));
const config={url:'https://example.supabase.co',serviceKey:'private-service-key',workerToken:'a'.repeat(40),region:'us-west-2',functionName:'classifier',accessKey:'example-key',secretKey:'example-secret'};
const uuid='11111111-1111-4111-8111-111111111111';
const identity={submission_id:uuid,stage:'original',generation:0,attempt_id:uuid};
const calls=[];
const service=new UploadService(config,async(url,init)=> {
  calls.push({url,init});
  if (url.includes('/auth/v1/user')) return Response.json({id:uuid});
  return Response.json({submission:{id:uuid}});
});
let nudges=0;
const api=createUploadHandler(service,()=>nudges++);
assert.equal((await api(new Request('https://edge',{method:'OPTIONS'}))).status,204);
assert.equal((await api(new Request('https://edge',{method:'GET'}))).status,405);
assert.equal((await api(new Request('https://edge',{method:'POST',body:'{'}))).status,400);
assert.equal((await api(new Request('https://edge',{method:'POST',body:JSON.stringify({action:'list'})}))).status,401);
const response=await api(new Request('https://edge',{method:'POST',headers:{Authorization:'Bearer user-token'},body:JSON.stringify({action:'reconcile',id:uuid,user_id:'forged'})}));
assert.equal(response.status,200);
assert.equal(JSON.parse(calls.at(-1).init.body).actor,uuid,'Actor must come from authenticated server verification');
assert.equal(calls[0].init.headers.Authorization,'Bearer user-token');
assert.equal(nudges,1);
const rejectedTokenCalls=[];
const rejectedTokenApi=createUploadHandler(new UploadService(config,async(url)=> {
  rejectedTokenCalls.push(url);
  return Response.json({error:'Invalid JWT'},{status:401});
}),()=>assert.fail('An invalid bearer must never schedule work'));
const rejectedTokenResponse=await rejectedTokenApi(new Request('https://edge',{
  method:'POST',headers:{Authorization:'Bearer forged-or-expired-token'},
  body:JSON.stringify({action:'reconcile',id:uuid,user_id:uuid}),
}));
assert.equal(rejectedTokenResponse.status,401,'A forged or expired bearer cannot access account operations');
assert.deepEqual(rejectedTokenCalls,[config.url+'/auth/v1/user'],'Invalid Auth verification must stop before any service-role database call');
const bodyLimit=16_384;
const commandPrefix='{"action":"list","padding":"',commandSuffix='"}';
const boundaryBody=commandPrefix+'x'.repeat(bodyLimit-commandPrefix.length-commandSuffix.length)+commandSuffix;
assert.equal((await api(new Request('https://edge',{method:'POST',headers:{Authorization:'Bearer user-token'},body:boundaryBody}))).status,200,
  'A valid command exactly at the byte limit is accepted');
const callsBeforeOversized=calls.length;
for (const contentLength of [undefined,'1']) {
  let produced=0,canceled=false;
  const stream=new ReadableStream({
    pull(controller) {
      produced+=4096;
      controller.enqueue(new Uint8Array(4096));
      if (produced>=512*1024) controller.close();
    },
    cancel() { canceled=true; },
  });
  const headers=contentLength ? {'Content-Length':contentLength} : {};
  const oversized=await api(new Request('https://edge',{method:'POST',headers,body:stream,duplex:'half'}));
  assert.equal(oversized.status,413);
  assert.ok(produced<=bodyLimit+8192,'Oversized streams stop after the limit, allowing one prefetched chunk');
  assert.equal(canceled,true,'The unread oversized body is canceled');
}
assert.equal(calls.length,callsBeforeOversized,'Oversized unauthenticated bodies never reach Auth or the database');
const unicodeBody=JSON.stringify({action:'list',padding:'é'.repeat(9000)});
assert.ok(unicodeBody.length<bodyLimit && new TextEncoder().encode(unicodeBody).length>bodyLimit);
assert.equal((await api(new Request('https://edge',{method:'POST',body:unicodeBody}))).status,413,'The limit counts UTF-8 bytes rather than characters');
let stalledCanceled=false;
const stalled=new Request('https://edge',{method:'POST',duplex:'half',body:new ReadableStream({cancel(){stalledCanceled=true;}})});
const bodyAbort=new AbortController();
const timeout=setTimeout(()=>bodyAbort.abort(),10);
try {
  await assert.rejects(()=>readUploadBody(stalled,bodyAbort.signal),(error)=>error.status===408 && /timed out/.test(error.message));
  assert.equal(stalledCanceled,true,'A stalled body is canceled when its deadline expires');
} finally { clearTimeout(timeout); }
for (const gps of [{latitude:0,longitude:null},{latitude:NaN,longitude:4},{latitude:91,longitude:1},{latitude:1,longitude:181}]) {
  assert.throws(()=>validateCommand({action:'gps',id:uuid,...gps}));
}
assert.doesNotThrow(()=>validateCommand({action:'gps',id:uuid,latitude:null,longitude:null}));
assert.doesNotThrow(()=>validateCommand({action:'gps',id:uuid,latitude:0,longitude:0}));
assert.throws(()=>validateCommand({action:'candidate_uploaded',id:uuid,generation:1,sha256:'f'.repeat(64),bytes:8*1024*1024+1}));
assert.throws(()=>validateCommand({action:'admit',id:uuid,request_id:uuid,trip_id:uuid,filename:'x',source_sha256:'invalid',source_bytes:1}));
assert.throws(()=>validateCommand({action:'browser_failure',id:uuid,stage:'candidate_upload'}));
assert.doesNotThrow(()=>validateCommand({action:'browser_failure',id:uuid,stage:'candidate_upload',generation:2}));
assert.equal(sameToken(config.workerToken,config.workerToken),true);
assert.equal(sameToken('a'.repeat(39),config.workerToken),false);
assert.equal(sameToken('',''),false);

let invocation;
await invokeClassifier(config,{...identity,bucket:'photo-quarantine',path:`${uuid}/${uuid}/original`,expected_sha256:'f'.repeat(64),expected_bytes:10},async(url,init)=> {
  invocation={url,init};return Response.json({...identity,outcome:'approved',sha256:'f'.repeat(64),bytes:10});
},new Date('2026-09-30T12:30:00Z'));
assert.match(invocation.url,/lambda.us-west-2.amazonaws.com\/2015-03-31\/functions\/classifier\/invocations/);
assert.equal(invocation.init.headers['x-amz-date'],'20260930T123000Z');
assert.match(invocation.init.headers.Authorization,/AWS4-HMAC-SHA256 Credential=example-key\/20260930\/us-west-2\/lambda\/aws4_request/);
assert.equal(invocation.init.headers['x-amz-invocation-type'],'RequestResponse');
assert.ok(invocation.init.body.length<1024,'Invocation carries references rather than photo payload');
await invokeClassifier({...config,functionName:'arn:aws:lambda:us-west-2:123456789012:function:classifier'},{test:'reference'},async(url,init)=> {
  assert.ok(url.includes('/functions/arn%3Aaws%3Alambda%3Aus-west-2%3A123456789012%3Afunction%3Aclassifier/invocations'));
  assert.ok(init.headers.Authorization.endsWith('Signature=78f87f13270c76bfbd1be35745049fa12d5f6049a46ee3647567b57fb53a9af9'),
    'Lambda ARN signature uses the double-encoded canonical path, matching the fixed independent HMAC vector');
  return Response.json({});
},new Date('2026-09-30T12:30:00Z'));
await assert.rejects(()=>invokeClassifier(config,identity,async()=>new Response('{}',{status:200,headers:{'x-amz-function-error':'Unhandled'}})));
const completed=[];
const workerService={config,fetcher:async()=>Response.json({...identity,attempt_id:'stale',outcome:'approved',sha256:'f'.repeat(64),bytes:10}),
  rpc:async(name,args)=>{completed.push({name,args});return true;},copy:async()=>{},remove:async()=>{}};
await processJob(workerService,identity);
assert.equal(completed.at(-1).args.result.outcome,'technical','A stale classifier cannot approve a current lease');
workerService.fetcher=async()=>Response.json({...identity,outcome:'quota',sha256:'f'.repeat(64),bytes:10,retry_after_seconds:900});
await processJob(workerService,identity);
assert.equal(completed.at(-1).args.result.outcome,'quota');
assert.equal(completed.at(-1).args.result.retry_after_seconds,900);
const removed=[];
workerService.remove=async(bucket,path)=>{if(path==='fails')throw Error('transient');removed.push(path);};
await processJob(workerService,{...identity,stage:'cleanup',objects:[{bucket:'photo-quarantine',path:'good'},{bucket:'photo-quarantine',path:'fails'}]});
assert.deepEqual(removed,['good']);
assert.equal(completed.at(-1).args.result.removed.length,1,'Partial deletion progress survives a retry');
const publication={...identity,stage:'publication',source:'source',destination:'destination'};
let copied=false;
workerService.copy=async()=>{copied=true;};
await processJob(workerService,publication);
assert.equal(copied,true);
assert.equal(completed.at(-1).args.result.outcome,'published');
workerService.copy=async()=>{throw Error('copy failed');};
await processJob(workerService,publication);
assert.equal(completed.at(-1).args.result.outcome,'technical','Copy failure never publishes');
const handler=createWorkerHandler(workerService);
assert.equal((await handler(new Request('https://worker',{method:'POST',headers:{Authorization:'Bearer forged'}}))).status,401);
function workerFixture(claimPlan,outcome='approved',classificationMs=0) {
  let clock=Date.now(),claims=0;
  const waits=[];
  const fixtureService=new UploadService(config,async(url,init)=> {
    if (url.includes('/rpc/upload_claim')) { claims++; return Response.json(claimPlan.shift()??null); }
    if (url.includes('/rpc/upload_finish')) return Response.json(true);
    if (url.includes('lambda.')) {
      clock+=classificationMs;
      return Response.json({...JSON.parse(init.body),outcome,sha256:'f'.repeat(64),bytes:10});
    }
    throw Error('Unexpected worker request');
  });
  const run=createWorkerHandler(fixtureService,()=>clock,async(ms)=>{waits.push(ms);clock+=ms;});
  return {run,waits,claims:()=>claims};
}
const secondJob={...identity,stage:'candidate',generation:1,attempt_id:'22222222-2222-4222-8222-222222222222'};
const cooldown=workerFixture([identity,null,secondJob,null,null]);
const cooldownResponse=await cooldown.run(new Request('https://worker',{method:'POST',headers:{Authorization:`Bearer ${config.workerToken}`}}));
assert.equal((await cooldownResponse.json()).processed,2,'One invocation progresses through multiple classifications separated by the DB cooldown');
assert.deepEqual(cooldown.waits,[1000,1000],'At most one bounded cooldown wait per completed classification');
assert.equal(cooldown.claims(),5,'A second empty claim ends the invocation rather than spinning');
const quotaFixture=workerFixture([identity,null],'quota');
await quotaFixture.run(new Request('https://worker',{method:'POST',headers:{Authorization:`Bearer ${config.workerToken}`}}));
assert.deepEqual(quotaFixture.waits,[],'Quota pauses do not trigger cooldown polling');
const deadlineFixture=workerFixture([identity,null],'approved',25_000);
await deadlineFixture.run(new Request('https://worker',{method:'POST',headers:{Authorization:`Bearer ${config.workerToken}`}}));
assert.deepEqual(deadlineFixture.waits,[],'No cooldown wait starts without enough time for another full classification');
console.log('Upload server: authenticated actions, GPS validation, IAM reference invocation, stale-result rejection, publication and partial cleanup passed.');
