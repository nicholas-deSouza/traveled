import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// Metadata is an allowlist, never a dump of requests, responses, environments or native errors.
function metadata(value = {}) {
  const result = {};
  for (const key of ['status', 'bytes', 'duration_ms', 'count', 'exit_status']) {
    if (Number.isSafeInteger(value[key]) && value[key] >= 0) result[key] = value[key];
  }
  if (['json', 'html', 'text', 'other', 'missing'].includes(value.content_type)) result.content_type = value.content_type;
  return result;
}

export class ScriptError extends Error {
  constructor(stage, code, message, details = {}) {
    super(message);
    this.name = 'ScriptError';
    this.stage = stage;
    this.code = code;
    this.details = metadata(details);
  }
}

export const fail = (stage, code, message, details) => new ScriptError(stage, code, message, details);
export const isMain = url => Boolean(process.argv[1]) && url === pathToFileURL(resolve(process.argv[1])).href;
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function createDiagnostics(script, write = line => console.error(line)) {
  const reported = new WeakSet();
  const event = (stage, event, details = {}) => write(JSON.stringify({ script, stage, event, ...metadata(details) }));
  const error = (stage, error) => {
    if (error && typeof error === 'object') {
      if (reported.has(error)) return;
      reported.add(error);
    }
    const known = error instanceof ScriptError;
    write(JSON.stringify({ script, stage: known ? error.stage : stage, event: 'failed',
      code: known ? error.code : 'unexpected_failure',
      message: known ? error.message : 'Unexpected failure. Inspect the last stage and rerun its validation.',
      ...(known ? error.details : metadata({ status: error?.status })) }));
  };
  return { event, error };
}

export async function runScript(script, main, diagnostics = createDiagnostics(script)) {
  const started = Date.now();
  diagnostics.event('script', 'started');
  try {
    await main(diagnostics);
    diagnostics.event('script', 'completed', { duration_ms: Date.now() - started });
  } catch (error) {
    diagnostics.error('script', error);
    process.exitCode = 1;
  }
}

export function parseJSON(text, stage, label, validate = () => true, details = {}, expected = 'JSON matching the expected shape') {
  const bytes = Buffer.byteLength(text);
  const info = { ...details, bytes };
  if (!text.trim()) throw fail(stage, 'empty_response', `${label} returned an invalid response: expected JSON, received an empty body.`, info);
  let value;
  try { value = JSON.parse(text); }
  catch { throw fail(stage, 'invalid_json', `${label} returned an invalid response: body is not valid JSON.`, info); }
  if (!validate(value)) throw fail(stage, 'invalid_shape', `${label} returned an invalid response: expected ${expected}.`, info);
  return value;
}

export function readJSONFile(path, stage, label, validate) {
  let text;
  try { text = readFileSync(path, 'utf8'); }
  catch { throw fail(stage, 'file_read_failed', `${label} could not be read. Check that the expected input file exists and is readable.`); }
  return parseJSON(text, stage, label, validate);
}

function contentType(response) {
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!type) return 'missing';
  if (type === 'application/json' || /^application\/[a-z0-9.+-]+\+json$/.test(type)) return 'json';
  if (type === 'text/html') return 'html';
  return type.startsWith('text/') ? 'text' : 'other';
}

async function bodyText(response, stage, label, details, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw fail(stage, 'response_too_large', `${label} response exceeded the permitted size.`, { ...details, bytes });
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, bytes).toString('utf8');
  } catch (error) {
    if (error instanceof ScriptError) throw error;
    throw fail(stage, 'response_read_failed', `${label} response could not be read. Check connectivity and service availability.`, details);
  } finally { reader.releaseLock(); }
}

export async function request(fetchRequest, url, options, {
  stage, label, diagnostics, json = false, validate = () => true,
  statuses, allowHttpErrors = false, maxBytes = 1024 * 1024, expected,
}) {
  const started = Date.now();
  diagnostics?.event(stage, 'started');
  try {
    let response;
    try {
      response = await fetchRequest(url, { ...options, redirect: 'error',
        signal: options.signal ?? AbortSignal.timeout(100_000) });
    } catch (error) {
      const timeout = ['TimeoutError', 'AbortError'].includes(error?.name);
      throw fail(stage, timeout ? 'request_timeout' : 'request_failed',
        `${label} request ${timeout ? 'timed out' : 'failed'}. Check connectivity and service availability.`);
    }
    if (!(response instanceof Response)) throw fail(stage, 'invalid_http_response', `${label} did not return an HTTP response.`);
    const details = { status: response.status, content_type: contentType(response) };
    if (statuses ? !statuses.includes(response.status) : !allowHttpErrors && !response.ok) {
      const hint = response.status === 401 ? 'Authentication was rejected; verify the configured credentials.'
        : response.status === 403 ? 'Permission denied; verify the caller has access to this operation.'
        : response.status === 404 ? 'Endpoint or resource not found; verify the deployment and target.'
        : response.status === 429 ? 'Rate limited; wait before retrying.'
        : response.status >= 500 ? 'Service failure; check service availability before retrying.'
        : 'Verify the request, deployed schema and expected response status.';
      throw fail(stage, 'http_status', `${label} failed (HTTP ${response.status}). ${hint}${statuses ? ` Expected HTTP ${statuses.join(' or ')}.` : ''}`, details);
    }
    if (!json) {
      diagnostics?.event(stage, 'completed', { ...details, duration_ms: Date.now() - started });
      return response;
    }
    const text = await bodyText(response, stage, label, details, maxBytes);
    // Check emptiness before content type so empty successful responses have a precise diagnosis.
    if (text.trim() && details.content_type !== 'json') {
      throw fail(stage, 'unexpected_content_type', `${label} returned an invalid response: expected application/json.`, { ...details, bytes: Buffer.byteLength(text) });
    }
    const value = parseJSON(text, stage, label, validate, details, expected);
    diagnostics?.event(stage, 'completed', { ...details, bytes: Buffer.byteLength(text), duration_ms: Date.now() - started });
    return value;
  } catch (error) {
    diagnostics?.error(stage, error);
    throw error;
  }
}

export async function apiCall(stage, operation, validate = () => true, diagnostics = createDiagnostics('greploop')) {
  diagnostics.event(stage, 'started');
  let result;
  try { result = await operation(); }
  catch (error) {
    const problem = fail(stage, 'api_request_failed', 'GitHub API request failed. Check permissions, rate limits and service availability.', { status: error?.status });
    diagnostics.error(stage, problem);
    throw problem;
  }
  if (!validate(result)) {
    const problem = fail(stage, 'invalid_shape', 'GitHub API response does not match the expected shape.', { status: result?.status });
    diagnostics.error(stage, problem);
    throw problem;
  }
  diagnostics.event(stage, 'completed', { status: result?.status });
  return result;
}

export function runCommand(command, args, options, stage, diagnostics, execute = spawnSync) {
  diagnostics?.event(stage, 'started');
  let result;
  try { result = execute(command, args, options); }
  catch { throw fail(stage, 'process_start_failed', 'Command could not be started. Check the required executable and working directory.'); }
  if (result.error) throw fail(stage, 'process_start_failed', 'Command could not be started. Check the required executable and working directory.');
  if (result.status !== 0 || result.signal) throw fail(stage, 'process_failed', 'Command failed. Inspect its preceding output and retry this stage.', { exit_status: result.status });
  if (options.encoding && options.stdio !== 'inherit' && typeof result.stdout !== 'string') throw fail(stage, 'invalid_process_output', 'Command returned an invalid response: expected text stdout.');
  diagnostics?.event(stage, 'completed', { exit_status: result.status });
  return result;
}
