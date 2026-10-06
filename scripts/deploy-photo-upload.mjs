import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFileSync } from 'node:fs';
import { createDiagnostics, fail, isRecord, request as diagnosticRequest, runScript } from './script-diagnostics.mjs';

// Operational settings only. Migrations are installed separately. Resume only
// after verification, and only while this deployment still owns the pause.
const healthQuery = 'select public.upload_health() as health';
const resumeReadyQuery = `select exists (
  select 1 from pg_catalog.pg_trigger
  where tgrelid = 'upload_private.settings'::regclass
    and tgname = 'photo_upload_admission_revision' and tgenabled in ('O', 'A')
    and tgfoid = pg_catalog.to_regprocedure('upload_private.bump_admission_revision()')
) as ready`;
const pauseQuery = `with previous as materialized (
  select admission_enabled from upload_private.settings where singleton for update
)
update upload_private.settings s set admission_enabled = false
from previous where s.singleton
returning previous.admission_enabled as admission_enabled_before,
  s.admission_revision::text as admission_revision`;
const resumeQuery = `update upload_private.settings set admission_enabled = true
where singleton and admission_enabled = false and admission_revision = $1::bigint
returning admission_revision::text as admission_revision`;
const admissionRevisionQuery = 'select admission_revision::text as admission_revision from upload_private.settings where singleton';
const isRevision = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)
  && BigInt(value) <= 9223372036854775807n;
const vaultQuery = `with existing as materialized (
  select id from vault.secrets where name = $1::text
), updated as (
  select vault.update_secret(id, $2::text, $1::text) from existing
), created as (
  select vault.create_secret($2::text, $1::text)
  where not exists (select 1 from existing)
)
select (select count(*) from updated) + (select count(*) from created) as configured`;

export function deploymentConfig(env, phase) {
  if (!['prepare', 'configure', 'verify'].includes(phase)) throw new Error('Choose prepare, configure or verify.');
  const required = name => {
    const value = env[name];
    if (typeof value !== 'string' || !value || /[\r\n]/.test(value)) throw new Error(`Missing or invalid ${name}.`);
    return value;
  };
  const project = required('SUPABASE_PROJECT_REF');
  if (!/^[a-z0-9]{20}$/.test(project)) throw new Error('Invalid SUPABASE_PROJECT_REF.');
  const region = required('PHOTO_CLASSIFIER_AWS_REGION');
  if (!/^[a-z]{2}-[a-z]+-\d+$/.test(region)) throw new Error('Invalid PHOTO_CLASSIFIER_AWS_REGION.');
  const stack = required('PHOTO_CLASSIFIER_STACK_NAME');
  if (!/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(stack)) throw new Error('Invalid PHOTO_CLASSIFIER_STACK_NAME.');
  const secretArn = required('PHOTO_CLASSIFIER_SECRET_ARN');
  const secret = /^arn:aws:secretsmanager:([^:]+):(\d{12}):secret:[A-Za-z0-9/_+=.@-]+$/.exec(secretArn);
  if (!secret || secret[1] !== region) throw new Error('Classifier secret must be an AWS ARN in the deployment region.');
  const role = /^arn:aws:iam::(\d{12}):role\/[A-Za-z0-9/_+=,.@-]+$/.exec(required('AWS_DEPLOY_ROLE_ARN'));
  if (!role || role[1] !== secret[2]) throw new Error('Deployment role and classifier secret must share an AWS account.');
  const token = required('SUPABASE_ACCESS_TOKEN');
  const workerToken = required('PHOTO_UPLOAD_WORKER_TOKEN');
  if (workerToken.length < 32) throw new Error('PHOTO_UPLOAD_WORKER_TOKEN must contain at least 32 characters.');
  const accessKey = required('PHOTO_CLASSIFIER_AWS_ACCESS_KEY_ID');
  if (!/^AKIA[A-Z0-9]{16}$/.test(accessKey)) throw new Error('Use a dedicated durable IAM access key for the Edge runtime.');
  const secretKey = required('PHOTO_CLASSIFIER_AWS_SECRET_ACCESS_KEY');
  const functionArn = env.PHOTO_CLASSIFIER_FUNCTION_NAME;
  let resumeAdmission, admissionRevision;
  if (phase !== 'prepare') {
    const fn = /^arn:aws:lambda:([^:]+):(\d{12}):function:[A-Za-z0-9_-]+$/.exec(functionArn ?? '');
    if (!fn || fn[1] !== region || fn[2] !== secret[2]) throw new Error('Classifier output must be a Lambda ARN in the configured region and account.');
  }
  if (phase === 'verify') {
    const before = env.PHOTO_UPLOAD_ADMISSION_ENABLED_BEFORE;
    admissionRevision = env.PHOTO_UPLOAD_ADMISSION_REVISION;
    if (!['true', 'false'].includes(before) || !isRevision(admissionRevision)) {
      throw new Error('Verification requires the admission state and revision returned by this deployment\'s prepare step.');
    }
    resumeAdmission = before === 'true';
  }
  return { project, region, token, workerToken, accessKey, secretKey, functionArn,
    resumeAdmission, admissionRevision, url: `https://${project}.supabase.co` };
}

export async function deployBackend(phase, env, fetchRequest = fetch, diagnostics = createDiagnostics('deploy-photo-upload')) {
  let config;
  try { config = deploymentConfig(env, phase); }
  catch (error) { throw fail('configuration', 'invalid_configuration', error.message); }
  diagnostics.event(phase, 'started');
  const request = (url, options, label, json = false, extra = {}) => diagnosticRequest(fetchRequest, url, options, {
    stage: 'edge.verify', label, json, diagnostics, ...extra,
  });
  const management = (path, body, label, json = true, extra = {}) => request(`https://api.supabase.com/v1/projects/${config.project}/${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, label, json, { stage: path === 'secrets' ? 'edge.secrets' : 'database.query', ...extra });
  const query = (sql, parameters = [], readOnly = false, extra = {}) => management('database/query', {
    query: sql, parameters, read_only: readOnly,
  }, 'Database configuration', true, { statuses: [200, 201], validate: Array.isArray, expected: 'an array of database rows', ...extra });
  async function health(requireSchedule) {
    // read_only selects supabase_read_only_user, which cannot execute this
    // service-only function. Use the deployment connection even for this SELECT.
    const rows = await query(healthQuery, [], false, {
      stage: 'database.health',
      validate: rows => Array.isArray(rows) && rows.length === 1 && isRecord(rows[0]?.health)
        && ['queues', 'cron', 'pg_net', 'scheduled', 'admission_enabled'].every(key => typeof rows[0].health[key] === 'boolean'),
      expected: 'one health row with boolean queues, cron, pg_net, scheduled and admission_enabled fields',
    });
    const state = rows?.[0]?.health;
    if (!state || !['queues', 'cron', 'pg_net'].every(key => state[key] === true)) {
      throw fail('database.health', 'missing_extensions', 'Upload migration or required Queues, Cron and pg_net extensions are missing.');
    }
    if (requireSchedule && (state.scheduled !== true || state.admission_enabled !== false)) {
      throw fail('database.health', 'unsafe_health_state', 'Worker schedule must be active and upload admission must remain paused.');
    }
    return state;
  }

  if (phase === 'prepare') {
    await health(false);
    const readiness = await query(resumeReadyQuery, [], false, {
      stage: 'database.resume-readiness',
      validate: rows => Array.isArray(rows) && rows.length === 1 && typeof rows[0]?.ready === 'boolean',
      expected: 'one automatic-resume readiness row',
    });
    if (!readiness[0].ready) throw fail('database.resume-readiness', 'missing_resume_migration',
      'Install the photo upload automatic-resume migration before deploying. Upload admission has not been changed.');
    const rows = await query(pauseQuery, [], false, {
      stage: 'database.pause',
      validate: rows => Array.isArray(rows) && rows.length === 1
        && typeof rows[0]?.admission_enabled_before === 'boolean' && isRevision(rows[0]?.admission_revision),
      expected: 'one paused admission row with its previous state and revision',
    });
    // Confirm the singleton exists and the pause took effect before changing services.
    const state = await health(false);
    if (state.admission_enabled !== false) throw fail('database.pause', 'admission_not_paused', 'Could not pause upload admission.');
    diagnostics.event(phase, 'completed');
    return { admission_enabled_before: rows[0].admission_enabled_before,
      admission_revision: rows[0].admission_revision };
  }
  if (phase === 'configure') {
    const secrets = {
      PHOTO_UPLOAD_WORKER_TOKEN: config.workerToken,
      PHOTO_CLASSIFIER_AWS_REGION: config.region,
      PHOTO_CLASSIFIER_FUNCTION_NAME: config.functionArn,
      PHOTO_CLASSIFIER_AWS_ACCESS_KEY_ID: config.accessKey,
      PHOTO_CLASSIFIER_AWS_SECRET_ACCESS_KEY: config.secretKey,
      // Clear any expired session credential from a previous manual deployment.
      PHOTO_CLASSIFIER_AWS_SESSION_TOKEN: '',
    };
    // Secret writes need only a successful status; the response can have no JSON body.
    await management('secrets', Object.entries(secrets).map(([name, value]) => ({ name, value })), 'Edge runtime configuration', false, { statuses: [200, 201, 204] });
    for (const [name, value] of [
      ['photo_upload_worker_url', `${config.url}/functions/v1/photo-upload-worker`],
      ['photo_upload_worker_token', config.workerToken],
    ]) {
      await query(vaultQuery, [name, value], false, {
        stage: name === 'photo_upload_worker_url' ? 'vault.worker-url' : 'vault.worker-token',
        validate: rows => Array.isArray(rows) && rows.length === 1 && [1, '1'].includes(rows[0]?.configured),
        expected: 'exactly one Vault row with configured equal to 1',
      });
    }
    diagnostics.event(phase, 'completed');
    return {};
  }

  const uploadUrl = `${config.url}/functions/v1/photo-upload`;
  const preflight = await request(uploadUrl, { method: 'OPTIONS', headers: {
    Origin: 'https://upload-check.invalid', 'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization,content-type',
  } }, 'Upload preflight', false, { stage: 'edge.preflight', statuses: [204] });
  if (preflight.status !== 204 || preflight.headers.get('access-control-allow-origin') !== '*') {
    throw fail('edge.preflight', 'invalid_cors', 'Upload API CORS preflight must allow origin *.');
  }
  // Denial probes catch accidentally enabled gateway JWT checks and handler boot failures.
  for (const [url, body] of [[uploadUrl, '{"action":"list"}'], [`${uploadUrl}-worker`, '{}']]) {
    await request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
      'Edge authorization probe', false, { stage: url === uploadUrl ? 'edge.upload-auth' : 'edge.worker-auth', statuses: [401] });
  }
  // This is an operational worker wakeup: pending real jobs can be processed.
  const worker = await request(`${uploadUrl}-worker`, { method: 'POST', headers: {
    Authorization: `Bearer ${config.workerToken}`, 'Content-Type': 'application/json',
  }, body: '{}' }, 'Worker health check', true, {
    stage: 'edge.worker-health', statuses: [200],
    validate: value => isRecord(value) && Number.isSafeInteger(value.processed) && value.processed >= 0,
    expected: 'an object with a nonnegative integer processed field',
  });
  diagnostics.event('edge.worker-health', 'validated', { count: worker.processed });
  await query('select public.upload_schedule()', [], false, { stage: 'database.schedule' });
  await health(true);
  let admissionStatus = 'kept_paused';
  if (config.resumeAdmission) {
    const rows = await query(resumeQuery, [config.admissionRevision], false, {
      stage: 'database.resume',
      validate: rows => Array.isArray(rows) && (rows.length === 0
        || rows.length === 1 && rows[0]?.admission_revision === String(BigInt(config.admissionRevision) + 1n)),
      expected: 'no rows after an intervening switch change, or one resumed admission row with the next revision',
    });
    admissionStatus = rows.length === 1 ? 'resumed' : 'operator_override';
    diagnostics.event('database.resume', rows.length === 1 ? 'restored' : 'skipped');
  } else {
    const rows = await query(admissionRevisionQuery, [], false, {
      stage: 'database.admission-state',
      validate: rows => Array.isArray(rows) && rows.length === 1 && isRevision(rows[0]?.admission_revision),
      expected: 'one current admission revision row',
    });
    if (rows[0].admission_revision !== config.admissionRevision) admissionStatus = 'operator_override';
  }
  diagnostics.event(phase, 'completed');
  return { admission_status: admissionStatus };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runScript('deploy-photo-upload', async diagnostics => {
    const result = await deployBackend(process.argv[2], process.env, fetch, diagnostics);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT,
        Object.entries(result).map(([name, value]) => `${name}=${value}\n`).join(''));
    }
    const messages = {
      resumed: 'Backend verified. Upload admission automatically resumed.',
      kept_paused: 'Backend verified. Upload admission was already paused and remains paused.',
      operator_override: 'Backend verified. Upload admission changed during deployment; automatic resume skipped.',
    };
    console.log(messages[result.admission_status] ?? 'Backend configuration step completed.');
  });
}
