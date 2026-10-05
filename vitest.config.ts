import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Node 25 exposes native Web Storage on the worker global. Let jsdom provide
// its own Storage implementation instead, including browser-compatible spies.
const browserStorageArgs = process.allowedNodeEnvironmentFlags.has('--no-experimental-webstorage')
  ? ['--no-experimental-webstorage'] : [];

export default defineConfig({
  plugins: [react()],
  envDir: false,
  test: {
    environment: 'jsdom',
    poolOptions: {
      forks: { execArgv: browserStorageArgs },
      threads: { execArgv: browserStorageArgs },
    },
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    clearMocks: true,
    restoreMocks: true,
  },
});
