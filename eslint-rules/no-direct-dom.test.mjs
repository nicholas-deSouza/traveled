import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './no-direct-dom.mjs';

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [{
    files: ['**/*.tsx'],
    languageOptions: { parser: tseslint.parser, parserOptions: { project: './tsconfig.app.json', tsconfigRootDir: process.cwd() } },
    plugins: { local: { rules: { 'no-direct-dom': rule } } },
    rules: { 'local/no-direct-dom': 'error' },
  }],
});

for (const code of [
  'declare const element: HTMLElement; element.querySelector("button");',
  'declare const element: HTMLElement; element["querySelectorAll"]("button");',
  'declare const ref: { current: HTMLDialogElement | null }; ref.current?.querySelector("button");',
  'declare const element: HTMLElement; const { querySelector } = element;',
  'declare const element: HTMLElement; element.textContent = "new";',
  'window.document;',
  'globalThis.document;',
]) {
  test(`rejects DOM access: ${code}`, async () => {
    const [result] = await eslint.lintText(code, { filePath: 'src/main.tsx' });
    assert.equal(result.messages.length, 1, JSON.stringify(result.messages));
    assert.equal(result.messages[0].ruleId, 'local/no-direct-dom');
  });
}

for (const code of [
  'const record = { textContent: "value", document: "file" }; record.textContent; record.document;',
  'const service = { querySelector: (s: string) => s }; service.querySelector("item");',
  'declare const custom: { setAttribute(s: string): void }; custom.setAttribute("x");',
  'declare const custom: { querySelector: string }; const { querySelector } = custom;',
  'declare const ref: { current: HTMLDialogElement | null }; ref.current?.showModal(); ref.current?.focus();',
]) {
  test(`allows non-DOM APIs or supported ref operations: ${code}`, async () => {
    const [result] = await eslint.lintText(code, { filePath: 'src/main.tsx' });
    assert.deepEqual(result.messages, []);
  });
}
