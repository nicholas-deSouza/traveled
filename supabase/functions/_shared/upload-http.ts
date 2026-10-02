/** Small fetch adapter: every privileged RPC remains service-role only. */
export class ServiceError extends Error {
  constructor(message: string, readonly status = 500) { super(message); }
}
export interface RuntimeConfig {
  url: string; supabaseSecretKey: string; workerToken: string;
  region: string; functionName: string; accessKey: string; secretKey: string; sessionToken?: string;
}
export type Fetcher = typeof fetch;
export class UploadService {
  constructor(readonly config: RuntimeConfig, readonly fetcher: Fetcher = fetch) {}
  async call(path: string, init: RequestInit = {}, bearer?: string): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set('apikey', this.config.supabaseSecretKey);
    headers.set('Content-Type', 'application/json');
    headers.delete('Authorization');
    if (bearer) headers.set('Authorization', `Bearer ${bearer}`);
    const response = await this.fetcher(`${this.config.url}${path}`, {
      ...init, signal: init.signal ?? AbortSignal.timeout(90_000),
      headers,
    });
    const raw = await response.text();
    let body: unknown;
    try { body = raw ? JSON.parse(raw) : null; } catch { throw new ServiceError('Service returned invalid JSON'); }
    if (!response.ok) {
      // Never return a provider response, signed URL, credential, or raw Storage
      // payload. PostgreSQL application messages are constrained by migration.
      const message = path.startsWith('/rest/v1/rpc/') && typeof body === 'object' && body && 'message' in body
        ? String(body.message) : 'Storage or authentication request failed';
      throw new ServiceError(message, response.status);
    }
    return body;
  }
  rpc<T>(name: string, body: Record<string, unknown> = {}): Promise<T> {
    return this.call(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(body) }) as Promise<T>;
  }
  async user(request: Request): Promise<string> {
    const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) throw new ServiceError('Sign in to upload photos', 401);
    const user = await this.call('/auth/v1/user', {}, token) as { id?: string };
    if (!user.id) throw new ServiceError('Sign in to upload photos', 401);
    return user.id;
  }
  async copy(source: string, destination: string): Promise<void> {
    try {
      await this.call('/storage/v1/object/copy', { method: 'POST', body: JSON.stringify({
        bucketId: 'photo-quarantine', sourceKey: source, destinationKey: destination, destinationBucket: 'trip-photos',
      }) });
    } catch (error) {
      if (!(error instanceof ServiceError) || ![400,409].includes(error.status)) throw error;
      // A crashed publication may have copied the immutable generation already.
      // Existence alone grants no read access: the committed photos row gates it.
      await this.call(`/storage/v1/object/info/trip-photos/${destination.split('/').map(encodeURIComponent).join('/')}`);
    }
  }
  async remove(bucket: string, path: string): Promise<void> {
    try {
      await this.call(`/storage/v1/object/${encodeURIComponent(bucket)}`, { method: 'DELETE', body: JSON.stringify({ prefixes: [path] }) });
    } catch (error) {
      if (!(error instanceof ServiceError) || error.status !== 404) throw error;
    }
  }
}
const encoder = new TextEncoder();
function hex(bytes: ArrayBuffer) { return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
async function sha(value: string) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
async function hmac(key: Uint8Array, value: string): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(value)));
}
/** IAM authenticated synchronous invocation. Credentials stay in the Edge runtime. */
export async function invokeClassifier(config: RuntimeConfig, payload: unknown, fetcher: Fetcher = fetch, now = new Date()) {
  const host = `lambda.${config.region}.amazonaws.com`;
  const uriEncode=(value: string)=>encodeURIComponent(value).replace(/[!'()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const path = `/2015-03-31/functions/${uriEncode(config.functionName)}/invocations`;
  // SigV4 double-encodes path escapes for Lambda (the S3 exception does not
  // apply). ARN colons appear as %3A on the wire and %253A in this canonical URI.
  const canonicalPath=path.split('/').map(uriEncode).join('/');
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const shortDate = date.slice(0, 8);
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { 'content-type': 'application/json', host, 'x-amz-date': date, 'x-amz-invocation-type': 'RequestResponse' };
  if (config.sessionToken) headers['x-amz-security-token'] = config.sessionToken;
  const names = Object.keys(headers).sort();
  const canonical = `${names.map(name => `${name}:${headers[name].trim()}\n`).join('')}`;
  const signedHeaders = names.join(';');
  const canonicalRequest = ['POST',canonicalPath,'',canonical,signedHeaders,await sha(body)].join('\n');
  const scope = `${shortDate}/${config.region}/lambda/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${date}\n${scope}\n${await sha(canonicalRequest)}`;
  let key = await hmac(encoder.encode(`AWS4${config.secretKey}`), shortDate);
  key = await hmac(key, config.region); key = await hmac(key, 'lambda'); key = await hmac(key, 'aws4_request');
  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hex((await hmac(key,toSign)).buffer as ArrayBuffer)}`;
  const response = await fetcher(`https://${host}${path}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(90_000) });
  if (!response.ok || response.headers.get('x-amz-function-error')) throw new ServiceError('Classifier invocation failed');
  return response.json();
}
export function sameToken(left: string, right: string) {
  let diff = left.length ^ right.length;
  for (let i=0;i<Math.max(left.length,right.length);i++) diff |= (left.charCodeAt(i)||0) ^ (right.charCodeAt(i)||0);
  return diff===0 && right.length>=32;
}
