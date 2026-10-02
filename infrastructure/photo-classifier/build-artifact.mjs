import { mkdtemp, mkdir, cp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Run inside the Linux x86_64 Node24 SAM container. Explicit allowlist prevents copying secrets.
if (process.platform !== 'linux' || process.arch !== 'x64' || Number(process.versions.node.split('.')[0]) !== 24) {
  throw new Error('Artifact must be built in the Linux x86_64 Node24 SAM container');
}
const source = dirname(fileURLToPath(import.meta.url));
const repo = join(source, '../..');
const stage = await mkdtemp(join(tmpdir(), 'traveled-classifier-'));
const packageDir = join(stage, 'infrastructure/photo-classifier');
await mkdir(join(packageDir, 'src'), { recursive: true });
await mkdir(join(stage, 'src/lib'), { recursive: true });
for (const name of ['package.json','package-lock.json','tsconfig.json']) {
  await cp(join(source,name), join(packageDir,name));
}
for (const name of await readdir(join(source,'src'))) {
  if (name.endsWith('.ts')) await cp(join(source,'src',name), join(packageDir,'src',name));
}
await cp(join(repo,'src/lib/photoUploadContract.ts'), join(stage,'src/lib/photoUploadContract.ts'));
function run(command, args, cwd) {
  const result = spawnSync(command,args,{cwd,stdio:'inherit'});
  if (result.status !== 0) throw new Error(`${command} failed`);
}
run('npm',['ci','--include=optional','--ignore-scripts'],packageDir);
run('npm',['run','build'],packageDir);
const artifact = process.argv[2];
if (!artifact) throw new Error('An output artifact directory is required');
await mkdir(artifact,{recursive:true});
await cp(join(packageDir,'dist'),artifact,{recursive:true});
await cp(join(packageDir,'package.json'), join(artifact,'package.json'));
await cp(join(packageDir,'package-lock.json'), join(artifact,'package-lock.json'));
// Runtime install in Linux ensures the ZIP contains matching native binaries and the reviewed graph.
run('npm',['ci','--omit=dev','--include=optional','--ignore-scripts'],artifact);
run('node',[join(source,'test/artifact-smoke.mjs'),artifact],source);
