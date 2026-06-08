import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
      exclude: [
        'node_modules/**',
        'build/**',
        '**/*.test.ts',
        'eslint.config.js',
        'packages/librarian-git-mcp/src/index.ts',
        'packages/librarian-hub-mcp/src/index.ts',
        'packages/librarian-search-mcp/src/index.ts',
      ],
    },
  },
});
