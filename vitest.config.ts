import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@models': path.resolve(__dirname, 'src/models'),
      '@handlers': path.resolve(__dirname, 'src/handlers'),
      '@normalizers': path.resolve(__dirname, 'src/normalizers'),
      '@engines': path.resolve(__dirname, 'src/engines'),
      '@adapters': path.resolve(__dirname, 'src/adapters'),
      '@managers': path.resolve(__dirname, 'src/managers'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@repositories': path.resolve(__dirname, 'src/repositories'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/models/**/*.ts'],
    },
  },
});
