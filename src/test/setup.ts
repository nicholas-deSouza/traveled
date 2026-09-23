import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Never initialize the real client or contact a backend in component tests.
vi.mock('../lib/supabase', () => ({ supabase: null, isSupabaseConfigured: false }));
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});
