import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertDenied, runStorageChecks } from './check-upload-storage.mjs';
import { createDiagnostics } from './script-diagnostics.mjs';

const uuid = '11111111-1111-4111-8111-111111111111';
const env = { UPLOAD_TEST_URL: 'http://localhost:54321', UPLOAD_TEST_SERVICE_KEY: 'private-service', UPLOAD_TEST_ANON_KEY: 'private-anon' };
const quiet = createDiagnostics('test', () => {});
const errorResponse = (status, code, legacy = false) => Response.json({ [legacy ? 'error' : 'code']: code, message: 'private-provider-message' }, { status });

test('denial checks distinguish access, immutability, unreadable objects, metadata and physical removal', async () => {
  for (const [expectation, status, code, legacy] of [
    ['metadata', 403, '42501'],
    ['access', 403, 'AccessDenied'], ['access', 400, 'Unauthorized', true],
    ['immutable', 409, 'ResourceAlreadyExists'], ['immutable', 400, 'Duplicate', true], ['immutable', 403, 'AccessDenied'],
    ['unreadable', 404, 'NoSuchKey'], ['unreadable', 400, 'not_found', true], ['unreadable', 403, 'AccessDenied'],
    ['missing', 404, 'NoSuchKey'], ['missing', 404, 'not_found'],
  ]) await assertDenied(errorResponse(status, code, legacy), expectation);
});

test('unrelated client, authentication, schema, conflict and service errors cannot pass a denial gate', async () => {
  for (const [expectation, status, code] of [
    ['metadata', 400, 'PGRST204'], ['metadata', 400, '23502'], ['metadata', 400, '42501'], ['metadata', 409, '23505'],
    ['access', 400, 'InvalidRequest'], ['access', 401, 'InvalidJWT'], ['access', 403, 'InvalidSignature'],
    ['access', 404, 'NoSuchKey'], ['access', 409, 'ResourceAlreadyExists'],
    ['immutable', 400, 'InvalidMimeType'], ['unreadable', 404, 'NoSuchBucket'], ['missing', 403, 'AccessDenied'],
    ['access', 200, 'AccessDenied'], ['access', 429, 'SlowDown'], ['access', 500, 'InternalError'],
  ]) await assert.rejects(assertDenied(errorResponse(status, code), expectation, 'publication.client-metadata-insert'), error => {
    assert.equal(error.stage, 'publication.client-metadata-insert');
    assert.equal(error.details.status, status);
    assert.ok(['unexpected_status', 'unexpected_denial'].includes(error.code));
    assert.ok(!error.message.includes('private-provider-message'));
    return true;
  });
});

test('denial error bodies are bounded, parsed and redacted rather than trusted or printed', async () => {
  for (const [response, code] of [
    [new Response(null, { status: 403 }), 'empty_response'],
    [new Response('private-provider-html', { status: 403 }), 'invalid_json'],
    [Response.json(null, { status: 403 }), 'invalid_shape'],
    [Response.json({ code: 'AccessDenied', message: 'x'.repeat(70_000) }, { status: 403 }), 'response_too_large'],
  ]) {
    const lines = [];
    const diagnostics = createDiagnostics('test', line => lines.push(line));
    await assert.rejects(assertDenied(response), error => {
      assert.equal(error.code, code);
      diagnostics.error('storage.denial', error);
      return true;
    });
    assert.ok(!lines.join('').includes('private-provider'));
    assert.ok(!lines.join('').includes('xxxxx'));
  }
});

// Exercise the gate's real request sequence without credentials or a live Supabase.
function scenario({ wrongTarget = false, galleryReadable = true, metadataDenial = () => errorResponse(403, '42501') } = {}) {
  let id, finishes = 0, claims = 0, originalUploads = 0, admissions = 0, deleted = false;
  const original = { bucket: 'photo-quarantine', path: 'private-original-path', generation: 0 };
  const candidate = { bucket: 'photo-quarantine', path: 'private-candidate-path', generation: 1 };
  const destination = 'private-gallery-path';
  const calls = [];
  const fetchRequest = async (url, options) => {
    const path = new URL(url).pathname, method = options.method ?? 'GET';
    calls.push({ path, method });
    if (path === '/auth/v1/signup') return Response.json({ access_token: 'private-user-token', user: { id: uuid } });
    if (path === '/rest/v1/rpc/create_group') return Response.json(uuid);
    if (path === '/rest/v1/trips') return Response.json([{ id: uuid }]);
    if (path === '/rest/v1/rpc/upload_command') {
      const command = JSON.parse(options.body).command;
      if (command.action === 'admit') {
        id = command.id;
        admissions++;
        return Response.json({ submission: { id }, target: wrongTarget && admissions === 2 ? { ...original, path: 'private-wrong-target' } : original });
      }
      if (command.action === 'candidate') return Response.json({ submission: { id }, target: candidate });
      if (command.action === 'delete') deleted = true;
      return Response.json({ submission: { id, cleanup_pending: false } });
    }
    if (path === '/rest/v1/rpc/upload_claim') {
      const stage = ['original', 'candidate', 'publication', 'cleanup'][claims++];
      const fields = stage === 'publication' ? { source: candidate.path, destination }
        : stage === 'cleanup' ? { objects: [{ bucket: 'trip-photos', path: destination }] }
          : { ...(stage === 'original' ? original : candidate), expected_bytes: 1, expected_sha256: 'a'.repeat(64) };
      return Response.json({ submission_id: id, attempt_id: uuid, generation: 1, stage, ...fields });
    }
    if (path === '/rest/v1/rpc/upload_finish') { finishes++; return Response.json(true); }
    if (path === '/rest/v1/photos') return method === 'POST' ? metadataDenial() : Response.json([{ id, latitude: 0, longitude: 0 }]);
    if (path === `/storage/v1/object/photo-quarantine/${original.path}` && method === 'POST') {
      return ++originalUploads === 1 ? new Response(null, { status: 200 }) : errorResponse(409, 'ResourceAlreadyExists');
    }
    if (path === `/storage/v1/object/authenticated/photo-quarantine/${original.path}`) {
      return finishes > 0 ? new Response(null, { status: 200 }) : errorResponse(404, 'NoSuchKey');
    }
    if (path === `/storage/v1/object/photo-quarantine/${candidate.path}`) return new Response(null, { status: 200 });
    if (path === `/storage/v1/object/trip-photos/${destination}`) return errorResponse(403, 'AccessDenied');
    if (path === `/storage/v1/object/authenticated/trip-photos/${destination}`) {
      return finishes >= 3 && !deleted ? new Response(null, { status: galleryReadable ? 200 : 403 }) : errorResponse(404, 'NoSuchKey');
    }
    if (path === '/storage/v1/object/copy' || method === 'DELETE') return Response.json({});
    throw new Error('Unexpected fixture request');
  };
  return { fetchRequest, calls };
}

test('the complete Storage gate still verifies publication and cleanup with operation-specific denials', async () => {
  const { fetchRequest, calls } = scenario();
  await runStorageChecks(env, fetchRequest, quiet);
  assert.ok(calls.some(call => call.method === 'DELETE'));
});

test('named assertions identify a changed admission target and an unreadable committed gallery without leaking values', async () => {
  for (const [options, stage, message] of [
    [{ wrongTarget: true }, 'admission.idempotent-target', 'Repeated admission must return the same upload target.'],
    [{ galleryReadable: false }, 'publication.committed-gallery-readable', 'Committed gallery object must be readable.'],
  ]) {
    const { fetchRequest, calls } = scenario(options);
    const lines = [];
    const diagnostics = createDiagnostics('test', line => lines.push(line));
    await assert.rejects(runStorageChecks(env, fetchRequest, diagnostics), error => {
      assert.equal(error.code, 'assertion_failed');
      assert.equal(error.stage, stage);
      assert.equal(error.message, message);
      diagnostics.error('storage-gates', error);
      return true;
    });
    assert.ok(!lines.join('').includes('private-'));
    assert.ok(!calls.some(call => call.method === 'DELETE'));
  }
});

test('invalid metadata inserts fail the integration gate before publication or cleanup', async () => {
  const { fetchRequest, calls } = scenario({ metadataDenial: () => errorResponse(400, 'PGRST204') });
  await assert.rejects(runStorageChecks(env, fetchRequest, quiet), error => error.stage === 'publication.client-metadata-insert' && error.code === 'unexpected_status');
  assert.ok(!calls.some(call => call.path === '/storage/v1/object/copy' || call.method === 'DELETE'));
});
