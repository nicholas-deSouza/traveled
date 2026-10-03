import { isDeepStrictEqual } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { createDiagnostics, fail, isMain, isRecord, parseJSON, readResponseText, request, runScript, ScriptError } from './script-diagnostics.mjs';

// Explicit integration gate for a disposable local Supabase. Never loads .env.
export function storageConfiguration(env) {
  let origin;
  try { origin = new URL(env.UPLOAD_TEST_URL || 'http://127.0.0.1:54321'); }
  catch { throw fail('configuration', 'invalid_origin', 'Storage checks require a valid disposable localhost URL.'); }
  if (!['127.0.0.1', 'localhost'].includes(origin.hostname) || !['http:', 'https:'].includes(origin.protocol)
    || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    throw fail('configuration', 'nonlocal_origin', 'Storage checks require a disposable localhost Supabase.');
  }
  const serviceKey = env.UPLOAD_TEST_SERVICE_KEY, anonKey = env.UPLOAD_TEST_ANON_KEY;
  if (![serviceKey, anonKey].every(key => typeof key === 'string' && key.trim() && !/[\r\n]/.test(key))) {
    throw fail('configuration', 'missing_credentials', 'Provide ephemeral local test API keys through the process environment.');
  }
  return { origin: origin.origin, serviceKey, anonKey };
}

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const target = value => isRecord(value) && ['photo-quarantine', 'trip-photos'].includes(value.bucket) && typeof value.path === 'string' && value.path.length > 0;
export function validStoragePayload(path, value, body) {
  if (path === '/auth/v1/signup') return isRecord(value) && typeof value.access_token === 'string' && value.access_token.length > 0 && uuid(value.user?.id);
  if (path === '/rest/v1/rpc/create_group') return uuid(value);
  if (path === '/rest/v1/trips') return Array.isArray(value) && value.length === 1 && uuid(value[0]?.id);
  if (path.startsWith('/rest/v1/photos?')) return Array.isArray(value) && value.every(row => uuid(row?.id) && ['latitude', 'longitude'].every(key => row[key] === null || typeof row[key] === 'number' && Number.isFinite(row[key])));
  if (path.endsWith('/upload_command')) return isRecord(value?.submission) && uuid(value.submission.id)
    && (!['admit', 'candidate'].includes(body?.command?.action) || target(value.target) && Number.isSafeInteger(value.target.generation) && value.target.generation >= 0)
    && (body?.command?.action !== 'reconcile' || typeof value.submission.cleanup_pending === 'boolean');
  if (path.endsWith('/upload_finish')) return value === true;
  if (path.endsWith('/upload_claim')) {
    if (value === null) return true;
    if (!isRecord(value) || !uuid(value.submission_id) || !uuid(value.attempt_id) || !Number.isSafeInteger(value.generation) || value.generation < 0) return false;
    if (['original', 'candidate'].includes(value.stage)) return target(value) && typeof value.expected_sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.expected_sha256) && Number.isSafeInteger(value.expected_bytes) && value.expected_bytes > 0;
    if (value.stage === 'publication') return ['source', 'destination'].every(key => typeof value[key] === 'string' && value[key].length > 0);
    return value.stage === 'cleanup' && Array.isArray(value.objects) && value.objects.every(target);
  }
  return isRecord(value) || Array.isArray(value);
}

function expectedStoragePayload(path) {
  if (path === '/auth/v1/signup') return 'an access_token and user UUID; disable signup email confirmation in the disposable instance';
  if (path === '/rest/v1/rpc/create_group') return 'a group UUID';
  if (path.endsWith('/upload_finish')) return 'true confirming the job lease was finished';
  if (path.endsWith('/upload_claim')) return 'null or a job with submission_id, attempt_id, generation and valid fields for its stage';
  if (path.endsWith('/upload_command')) return 'a submission UUID and required target or cleanup fields for the command';
  if (path.startsWith('/rest/v1/photos?')) return 'photo rows with UUID ids and numeric or null GPS fields';
  return 'a JSON object or array';
}

// Match both the operation and the provider error code. Never print provider messages.
const accessErrors = [[403, ['AccessDenied', 'unauthorized', 'Unauthorized']], [400, ['AccessDenied', 'unauthorized', 'Unauthorized']]];
const missingErrors = [[404, ['NoSuchKey', 'not_found', 'NotFound']], [400, ['NoSuchKey', 'not_found', 'NotFound']]];
const duplicateErrors = [[409, ['ResourceAlreadyExists', 'KeyAlreadyExists', 'already_exists', 'Duplicate']], [400, ['ResourceAlreadyExists', 'KeyAlreadyExists', 'already_exists', 'Duplicate']]];
const denialContracts = {
  metadata: [[403, ['42501']]],
  access: accessErrors,
  unreadable: [...accessErrors, ...missingErrors],
  immutable: [...accessErrors, ...duplicateErrors],
  missing: missingErrors,
};
export async function assertDenied(response, expectation = 'access', stage = 'storage.denial') {
  const contract = denialContracts[expectation];
  if (!contract) throw fail(stage, 'invalid_denial_contract', 'Unknown Storage denial expectation.');
  const details = { status: response.status };
  if (!contract.some(([status]) => status === response.status)) {
    throw fail(stage, 'unexpected_status', `Expected ${expectation} denial; unrelated HTTP failures do not prove this gate.`, details);
  }
  const text = await readResponseText(response, stage, 'Denial check', details, 64 * 1024);
  const payload = parseJSON(text, stage, 'Denial check', isRecord, details, 'a provider error object');
  const code = payload.code ?? payload.error;
  if (!contract.some(([status, codes]) => status === response.status && codes.includes(code))) {
    throw fail(stage, 'unexpected_denial', `Expected ${expectation} denial; the provider error does not establish this gate.`, details);
  }
}

export async function runStorageChecks(env = process.env, fetchRequest = fetch, diagnostics = createDiagnostics('check-upload-storage')) {
const { origin, serviceKey, anonKey } = storageConfiguration(env);
let gate = 'setup';
const mark = stage => { gate = stage; diagnostics.event(stage, 'started'); };
const check = (condition, name, message, details) => {
  if (!condition) throw fail(`${gate}.${name}`, 'assertion_failed', message, details);
};
const denied = (response, expectation, name) => assertDenied(response, expectation, `${gate}.${name}`);
try {
async function http(path, token = serviceKey, options = {}) {
  const response = await request(fetchRequest, origin + path, { ...options, headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers } }, {
    stage: gate, label: 'Local Storage API', diagnostics, allowHttpErrors: true,
  });
  return response;
}
async function json(path, token, body, method = 'POST') {
  return request(fetchRequest, origin + path, { method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { apikey: anonKey, Authorization: `Bearer ${token ?? serviceKey}`, 'Content-Type': 'application/json' } }, {
    stage: gate, label: 'Local API', diagnostics, json: true,
    validate: value => validStoragePayload(path, value, body), expected: expectedStoragePayload(path),
  });
}
mark('setup');
const account = await json('/auth/v1/signup', anonKey, { email: `upload-${randomUUID()}@example.test`, password: randomUUID() + 'aA1!' });
check(account.access_token, 'signup-session', 'Disable signup email confirmation in the disposable test instance.');
const token = account.access_token, actor = account.user.id;
const group = await json('/rest/v1/rpc/create_group', token, { group_name: 'Disposable upload integration' });
const [trip] = await request(fetchRequest, origin + '/rest/v1/trips', { method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ group_id: group, title: 'Upload test', created_by: actor }) }, {
  stage: gate, label: 'Trip creation', diagnostics, json: true, validate: value => validStoragePayload('/rest/v1/trips', value), expected: 'one trip row with a UUID id',
});
const rpc = (name, body) => json(`/rest/v1/rpc/${name}`, serviceKey, body);
const command = command => rpc('upload_command', { actor, command });
const source = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh1kAAAAASUVORK5CYII=', 'base64');
const candidate = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const id = randomUUID();
mark('admission');
const admission = { action: 'admit', id, request_id: randomUUID(), trip_id: trip.id, filename: 'fixture.png', source_sha256: sha(source), source_bytes: source.length };
const admitted = await command(admission);
check(isDeepStrictEqual((await command(admission)).target, admitted.target), 'idempotent-target', 'Repeated admission must return the same upload target.');
const upload = (target, bytes, mime, uploader = token) => http(`/storage/v1/object/${target.bucket}/${target.path}`, uploader, { method: 'POST', body: bytes, headers: { 'Content-Type': mime, 'x-upsert': 'false' } });
const originalUpload = await upload(admitted.target, source, 'image/png');
check(originalUpload.ok, 'original-upload', 'Admitted original upload must succeed.', { status: originalUpload.status });
await denied(await upload(admitted.target, source, 'image/png'), 'immutable', 'immutable-original');
await denied(await http(`/storage/v1/object/authenticated/photo-quarantine/${admitted.target.path}`, token), 'unreadable', 'unapproved-original');
await command({ action: 'original_uploaded', id });
async function claim(stage) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const job = await rpc('upload_claim', {});
    if (job?.submission_id === id && job.stage === stage) return job;
    check(!job, 'claimed-job', 'Unexpected work in the disposable instance.');
    await new Promise(resolve => setTimeout(resolve, 1100));
  }
  throw fail(gate, 'job_not_ready', `No durable ${stage} job became available within the polling limit.`);
}
// These checks inject a trusted classifier response. Lambda's real-byte and
// provider contracts are verified separately by classifier/native artifact tests.
const originalJob = await claim('original');
mark('original-approval');
await rpc('upload_finish', { result: { ...originalJob, outcome: 'approved', sha256: sha(source), bytes: source.length } });
const approvedOriginal = await http(`/storage/v1/object/authenticated/photo-quarantine/${admitted.target.path}`, token);
check(approvedOriginal.ok, 'approved-original-readable', 'Approved original object must be readable.', { status: approvedOriginal.status });
await command({ action: 'gps', id, latitude: 0, longitude: 0 });
const allocated = await command({ action: 'candidate', id, request_id: randomUUID() });
mark('candidate-approval');
const candidateUpload = await upload(allocated.target, candidate, 'image/webp');
check(candidateUpload.ok, 'candidate-upload', 'Allocated candidate upload must succeed.', { status: candidateUpload.status });
await command({ action: 'candidate_uploaded', id, generation: allocated.target.generation, sha256: sha(candidate), bytes: candidate.length });
const candidateJob = await claim('candidate');
await rpc('upload_finish', { result: { ...candidateJob, outcome: 'approved', sha256: sha(candidate), bytes: candidate.length } });
const publication = await claim('publication');
mark('publication');
const direct = await http('/rest/v1/photos', token, { method: 'POST', body: JSON.stringify({ id, trip_id: trip.id, uploaded_by: actor, storage_path: publication.destination }) });
await denied(direct, 'metadata', 'client-metadata-insert');
await denied(await upload({ bucket: 'trip-photos', path: publication.destination }, candidate, 'image/webp'), 'access', 'client-gallery-upload');
await json('/storage/v1/object/copy', serviceKey, { bucketId: 'photo-quarantine', sourceKey: publication.source, destinationKey: publication.destination, destinationBucket: 'trip-photos' });
const galleryPath = `/storage/v1/object/authenticated/trip-photos/${publication.destination}`;
await denied(await http(galleryPath, token), 'unreadable', 'uncommitted-gallery');
await rpc('upload_finish', { result: { ...publication, outcome: 'published' } });
const committedGallery = await http(galleryPath, token);
check(committedGallery.ok, 'committed-gallery-readable', 'Committed gallery object must be readable.', { status: committedGallery.status });
const metadata = await json(`/rest/v1/photos?id=eq.${id}&select=id,latitude,longitude`, token, undefined, 'GET');
check(isDeepStrictEqual(metadata, [{ id, latitude: 0, longitude: 0 }]), 'published-gps', 'Published metadata must contain the admitted photo and its GPS coordinates.');
mark('cleanup');
await command({ action: 'delete', id });
await denied(await http(galleryPath, token), 'unreadable', 'deleted-gallery');
const cleanup = await claim('cleanup');
for (const object of cleanup.objects) await json(`/storage/v1/object/${object.bucket}`, serviceKey, { prefixes: [object.path] }, 'DELETE');
await rpc('upload_finish', { result: { ...cleanup, outcome: 'cleaned', removed: cleanup.objects } });
check((await command({ action: 'reconcile', id })).submission.cleanup_pending === false, 'cleanup-complete', 'Reconciliation must confirm physical cleanup is complete.');
await denied(await http(galleryPath, serviceKey), 'missing', 'physical-gallery-removal');
console.log('Disposable Storage gates, immutable transfers, publication, GPS and physical cleanup passed.');
diagnostics.event('storage-gates', 'completed');
} catch (error) {
  if (error instanceof ScriptError) throw error;
  throw fail(gate, 'gate_failed', 'Storage validation gate failed. Check the preceding HTTP status and the access, identity or publication assertion for this stage.');
}
}

if (isMain(import.meta.url)) await runScript('check-upload-storage', diagnostics => runStorageChecks(process.env, fetch, diagnostics));
