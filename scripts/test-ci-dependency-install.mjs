import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function dependencySteps(workflowPath, jobName) {
  const workflow = readFileSync(new URL(workflowPath, import.meta.url), 'utf8');
  const job = workflow.match(new RegExp(`^ {2}${jobName}:\\n([\\s\\S]*?)(?=^ {2}[a-z][\\w-]*:\\n|(?![\\s\\S]))`, 'm'))?.[1];
  assert.ok(job, `${jobName} job must exist`);

  const steps = job.split(/(?=^ {6}- )/m).slice(1);
  const rootInstall = steps.findIndex(step => /^(?: {6}- | {8})run: pnpm install --frozen-lockfile[ \t]*$/m.test(step));
  const classifierInstall = steps.findIndex(step => /^(?: {6}- | {8})run: npm ci --prefix infrastructure\/photo-classifier --include=optional[ \t]*$/m.test(step));
  const fullTest = steps.findIndex(step => /^(?: {6}- | {8})run: pnpm test[ \t]*$/m.test(step));

  assert.ok(rootInstall >= 0, `${jobName} must install root dependencies with the frozen lockfile`);
  assert.ok(classifierInstall >= 0, `${jobName} must install classifier dependencies with npm ci and include optional native dependencies`);
  assert.ok(fullTest >= 0, `${jobName} must run the full pnpm test suite`);
  assert.ok(rootInstall < classifierInstall, `${jobName} must install root dependencies before classifier dependencies`);
  assert.ok(classifierInstall < fullTest, `${jobName} must install classifier dependencies before the full test suite`);

  return [steps[rootInstall], steps[classifierInstall], steps[fullTest]];
}

test('CI checks install classifier optional native dependencies between root install and the full test suite', () => {
  dependencySteps('../.github/workflows/ci.yml', 'checks');
});

test('Greploop validate installs classifier optional native dependencies before tests in the source checkout', () => {
  const steps = dependencySteps('../.github/workflows/greploop.yml', 'validate');
  for (const step of steps) {
    assert.match(step, /^ {8}working-directory: source[ \t]*$/m, 'dependency installation and full tests must run in the source checkout');
  }
});
