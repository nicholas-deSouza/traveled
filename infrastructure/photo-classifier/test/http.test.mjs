import { test } from 'node:test';
import assert from 'node:assert/strict';
import { download, moderate } from '../src/handler.ts';

const id = '11111111-1111-4111-8111-111111111111';
const path = `${id}/${id}/original`;
const request = { path, bucket: 'photo-quarantine', expected_bytes: 3 };
const signal = AbortSignal.timeout(1000);
function configure() {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-storage-credential';
  process.env.SIGHTENGINE_API_USER = 'test-provider-user';
  process.env.SIGHTENGINE_API_SECRET = 'test-provider-credential';
}
test('privileged download uses configured origin, authenticated route and bounded streaming', async (t) => {
  configure();
  const seen = [];
  t.mock.method(globalThis,'fetch',async (url,options) => {
    seen.push([String(url),options]); return new Response(new Uint8Array([1,2,3]));
  });
  assert.deepEqual([...await download(request,signal)],[1,2,3]);
  assert.equal(seen[0][0],`https://project.supabase.co/storage/v1/object/authenticated/photo-quarantine/${path}`);
  assert.equal(seen[0][1].redirect,'error');
  assert.equal(seen[0][1].headers.Authorization,'Bearer test-storage-credential');
  await assert.rejects(download({ ...request, expected_bytes: 2 }, signal), /exceeds/);
});
test('download refuses errors, oversized headers and non-HTTPS configured origins', async (t) => {
  configure();
  const mocked = t.mock.method(globalThis,'fetch',async () => new Response('no',{status:404}));
  await assert.rejects(download(request,signal), /unavailable/);
  mocked.mock.mockImplementation(async () => new Response('',{headers:{'content-length':String(21*1024*1024)}}));
  await assert.rejects(download(request,signal), /exceeds/);
  process.env.SUPABASE_URL = 'http://evil.test';
  await assert.rejects(download(request,signal), /configuration/);
});
test('moderation posts byte multipart to the fixed provider endpoint, not a Storage URL', async (t) => {
  configure(); let seen;
  t.mock.method(globalThis,'fetch',async (url,options) => {
    seen = {url,options}; return new Response(JSON.stringify({status:'success',nudity:{sexual_activity:0,sexual_display:0,erotica:0}}),{headers:{'retry-after':'90'}});
  });
  const result = await moderate({bytes:new Uint8Array([1,2,3]),mime:'image/webp'},signal);
  assert.equal(seen.url,'https://api.sightengine.com/1.0/check.json');
  assert.equal(seen.options.redirect,'error');
  const form = seen.options.body;
  assert.equal(form.get('models'),'nudity-2.1');
  assert.equal(form.get('media').name,'photo.webp');
  assert.deepEqual([...new Uint8Array(await form.get('media').arrayBuffer())],[1,2,3]);
  assert.equal(form.has('url'),false); assert.equal(result.status,200); assert.equal(result.retryAfter,'90');
});
test('provider malformed or oversized response cannot become approval', async (t) => {
  configure();
  const mock = t.mock.method(globalThis,'fetch',async () => new Response('not JSON'));
  assert.equal((await moderate({bytes:new Uint8Array([1]),mime:'image/jpeg'},signal)).body,null);
  mock.mock.mockImplementation(async () => new Response('X'.repeat(65537)));
  await assert.rejects(moderate({bytes:new Uint8Array([1]),mime:'image/jpeg'},signal), /Invalid provider/);
});
