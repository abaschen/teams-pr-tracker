import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    target: 'node22',
    lib: {
      entry: resolve(__dirname, 'src/handlers/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: 'dist/lambda-bundle/dist/handlers',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    rolldownOptions: {
      // Keep Node.js built-ins and AWS SDK external
      // AWS SDK is available in the Lambda runtime and must not be bundled
      // (bundling breaks its credential resolution chain)
      external: [
        /^node:/,
        /^crypto$/,
        /^http$/,
        /^https$/,
        /^stream$/,
        /^url$/,
        /^buffer$/,
        /^events$/,
        /^path$/,
        /^fs$/,
        /^util$/,
        /^os$/,
        /^querystring$/,
        /^zlib$/,
        /^net$/,
        /^tls$/,
        /^child_process$/,
        /^@aws-sdk\//,
        /^@smithy\//,
      ],
      output: {
        // Preserve the handler export for Lambda
        exports: 'named',
        codeSplitting: false,
      },
    },
  },
  resolve: {
    alias: {
      '@models': resolve(__dirname, 'src/models'),
      '@handlers': resolve(__dirname, 'src/handlers'),
      '@normalizers': resolve(__dirname, 'src/normalizers'),
      '@engines': resolve(__dirname, 'src/engines'),
      '@adapters': resolve(__dirname, 'src/adapters'),
      '@managers': resolve(__dirname, 'src/managers'),
      '@utils': resolve(__dirname, 'src/utils'),
      '@repositories': resolve(__dirname, 'src/repositories'),
    },
  },
});
