import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

// Explicit integration gate for a disposable local Supabase. Never loads .env.
const origin = process.env.UPLOAD_TEST_URL || 'http://127.0.0.1:54321';
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw Error('Storage checks require a disposable localhost Supabase');
const serviceKey = process.env.UPLOAD_TEST_SERVICE_KEY;
const anonKey = process.env.UPLOAD_TEST_ANON_KEY;
if (!serviceKey || !anonKey) throw Error('Provide ephemeral local test API keys through the process environment');
async function http(path, token = serviceKey, options = {}) {
  const response = await fetch(origin + path, { ...options, headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers } });
  return response;
}
async function json(path, token, body, method = 'POST') {
  const response = await http(path, token, { method, body: JSON.stringify(body) });
  assert.ok(response.ok, `Local API failed at ${path}: ${response.status}`);
  return response.json();
}
const account = await json('/auth/v1/signup', anonKey, { email: `upload-${randomUUID()}@example.test`, password: randomUUID() + 'aA1!' });
assert.ok(account.access_token, 'Disable signup email confirmation in the disposable test instance');
const token = account.access_token, actor = account.user.id;
const group = await json('/rest/v1/rpc/create_group', token, { group_name: 'Disposable upload integration' });
const tripResponse = await http('/rest/v1/trips', token, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ group_id: group, title: 'Upload test', created_by: actor }) });
assert.ok(tripResponse.ok); const [trip] = await tripResponse.json();
const rpc = (name, body) => json(`/rest/v1/rpc/${name}`, serviceKey, body);
const command = command => rpc('upload_command', { actor, command });
const source = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh1kAAAAASUVORK5CYII=', 'base64');
const candidate = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const id = randomUUID();
const admission = { action: 'admit', id, request_id: randomUUID(), trip_id: trip.id, filename: 'fixture.png', source_sha256: sha(source), source_bytes: source.length };
const admitted = await command(admission);
assert.deepEqual((await command(admission)).target, admitted.target);
const upload = (target, bytes, mime, uploader = token) => http(`/storage/v1/object/${target.bucket}/${target.path}`, uploader, { method: 'POST', body: bytes, headers: { 'Content-Type': mime, 'x-upsert': 'false' } });
assert.ok((await upload(admitted.target, source, 'image/png')).ok);
assert.equal((await upload(admitted.target, source, 'image/png')).ok, false, 'Original paths cannot be overwritten');
assert.equal((await http(`/storage/v1/object/authenticated/photo-quarantine/${admitted.target.path}`, token)).ok, false, 'Uploader cannot read unapproved bytes');
await command({ action: 'original_uploaded', id });
async function claim(stage) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const job = await rpc('upload_claim', {});
    if (job?.submission_id === id && job.stage === stage) return job;
    assert.ok(!job, 'Unexpected work in disposable instance');
    await new Promise(resolve => setTimeout(resolve, 1100));
  }
  throw Error(`No durable ${stage} job`);
}
// These checks inject a trusted classifier response. Lambda's real-byte and
// provider contracts are verified separately by classifier/native artifact tests.
const originalJob = await claim('original');
await rpc('upload_finish', { result: { ...originalJob, outcome: 'approved', sha256: sha(source), bytes: source.length } });
assert.ok((await http(`/storage/v1/object/authenticated/photo-quarantine/${admitted.target.path}`, token)).ok);
await command({ action: 'gps', id, latitude: 0, longitude: 0 });
const allocated = await command({ action: 'candidate', id, request_id: randomUUID() });
assert.ok((await upload(allocated.target, candidate, 'image/webp')).ok);
await command({ action: 'candidate_uploaded', id, generation: allocated.target.generation, sha256: sha(candidate), bytes: candidate.length });
const candidateJob = await claim('candidate');
await rpc('upload_finish', { result: { ...candidateJob, outcome: 'approved', sha256: sha(candidate), bytes: candidate.length } });
const publication = await claim('publication');
const direct = await http('/rest/v1/photos', token, { method: 'POST', body: JSON.stringify({ id, trip_id: trip.id, uploaded_by: actor, storage_path: publication.destination }) });
assert.equal(direct.ok, false, 'Client cannot insert gallery metadata');
assert.equal((await upload({ bucket: 'trip-photos', path: publication.destination }, candidate, 'image/webp')).ok, false, 'Client cannot write gallery objects');
await json('/storage/v1/object/copy', serviceKey, { bucketId: 'photo-quarantine', sourceKey: publication.source, destinationKey: publication.destination, destinationBucket: 'trip-photos' });
const galleryPath = `/storage/v1/object/authenticated/trip-photos/${publication.destination}`;
assert.equal((await http(galleryPath, token)).ok, false, 'Copy is withheld before commit');
await rpc('upload_finish', { result: { ...publication, outcome: 'published' } });
assert.ok((await http(galleryPath, token)).ok, 'Committed gallery object is readable');
const metadata = await http(`/rest/v1/photos?id=eq.${id}&select=id,latitude,longitude`, token);
assert.deepEqual(await metadata.json(), [{ id, latitude: 0, longitude: 0 }]);
await command({ action: 'delete', id });
assert.equal((await http(galleryPath, token)).ok, false, 'Delete closes visibility before byte cleanup');
const cleanup = await claim('cleanup');
for (const object of cleanup.objects) await json(`/storage/v1/object/${object.bucket}`, serviceKey, { prefixes: [object.path] }, 'DELETE');
await rpc('upload_finish', { result: { ...cleanup, outcome: 'cleaned', removed: cleanup.objects } });
assert.equal((await command({ action: 'reconcile', id })).submission.cleanup_pending, false);
assert.equal((await http(galleryPath, serviceKey)).ok, false, 'Storage API deleted physical bytes');
console.log('Disposable Storage gates, immutable transfers, publication, GPS and physical cleanup passed.');
