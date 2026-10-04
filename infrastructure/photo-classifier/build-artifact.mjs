import { mkdtemp, mkdir, cp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { stageVendor } from './stage-vendor.mjs';
import { createDiagnostics, fail, isMain, runCommand, runScript, ScriptError } from '../../scripts/script-diagnostics.mjs';

// Run inside the Linux x86_64 Node24 SAM container. Explicit allowlist prevents copying secrets.
export async function buildArtifact(artifact, diagnostics = createDiagnostics('build-classifier-artifact'), runtime = process, execute = spawnSync) {
if (runtime.platform !== 'linux' || runtime.arch !== 'x64' || Number(runtime.versions.node.split('.')[0]) !== 24) {
  throw fail('configuration', 'unsupported_runtime', 'Artifact must be built in the Linux x86_64 Node24 SAM container.');
}
if (typeof artifact !== 'string' || !artifact.trim()) throw fail('configuration', 'missing_output', 'An output artifact directory is required.');
let currentStage = 'source-staging';
try {
diagnostics.event(currentStage, 'started');
const source = dirname(fileURLToPath(import.meta.url));
const repo = join(source, '../..');
const stage = await mkdtemp(join(tmpdir(), 'traveled-classifier-'));
const packageDir = join(stage, 'infrastructure/photo-classifier');
await mkdir(join(packageDir, 'src'), { recursive: true });
await mkdir(join(stage, 'src/lib'), { recursive: true });
for (const name of ['package.json','package-lock.json','tsconfig.json','stage-vendor.mjs']) {
  await cp(join(source,name), join(packageDir,name));
}
for (const name of await readdir(join(source,'src'))) {
  if (name.endsWith('.ts')) await cp(join(source,'src',name), join(packageDir,'src',name));
}
await cp(join(repo,'src/lib/photoUploadContract.ts'), join(stage,'src/lib/photoUploadContract.ts'));
await stageVendor(stage);
function run(command, args, cwd, stage) {
  currentStage = stage;
  runCommand(command, args, { cwd, stdio: 'inherit' }, stage, diagnostics, execute);
}
diagnostics.event(currentStage, 'completed');
run('npm',['ci','--include=optional','--ignore-scripts'],packageDir,'install-build-dependencies');
run('npm',['run','build'],packageDir,'compile-classifier');
currentStage = 'assemble-artifact';
diagnostics.event(currentStage, 'started');
await mkdir(artifact,{recursive:true});
await cp(join(packageDir,'dist'),artifact,{recursive:true});
await cp(join(packageDir,'package.json'), join(artifact,'package.json'));
await cp(join(packageDir,'package-lock.json'), join(artifact,'package-lock.json'));
// Runtime install in Linux ensures the ZIP contains matching native binaries and the reviewed graph.
diagnostics.event(currentStage, 'completed');
run('npm',['ci','--omit=dev','--include=optional','--ignore-scripts'],artifact,'install-runtime-dependencies');
run('node',[join(source,'test/artifact-smoke.mjs'),artifact],source,'native-smoke');
} catch (error) {
  if (error instanceof ScriptError) throw error;
  throw fail(currentStage, 'artifact_io_failed', 'Classifier artifact files could not be prepared. Check the reviewed lockfile, source files and directory permissions.');
}
}

if (isMain(import.meta.url)) await runScript('build-classifier-artifact', diagnostics => buildArtifact(process.argv[2], diagnostics));
