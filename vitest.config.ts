import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals:     true,
    include:     ['**/__tests__/**/*.test.ts'],
    exclude:     ['node_modules', '.next'],
    // Stub Supabase env vars so modules that import lib/supabase.ts
    // don't crash during unit tests that don't exercise DB code.
    env: {
      NEXT_PUBLIC_SUPABASE_URL:      'https://placeholder.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder-anon-key',
      SUPABASE_SERVICE_KEY:          'placeholder-service-key',
    },
    coverage: {
      provider: 'v8',
      include:  ['lib/**/*.ts'],
      exclude:  ['lib/supabase.ts', 'lib/auth.ts', 'node_modules'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
