import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const project = fileURLToPath(new URL('../../', import.meta.url));
const preview = fileURLToPath(new URL('./', import.meta.url));
export default defineConfig({
  plugins: [react()],
  resolve: { alias: {
    '@': resolve(project, 'src'),
    'react': resolve(project, 'node_modules/react'),
    'react-dom': resolve(project, 'node_modules/react-dom'),
    'next/link': resolve(preview, 'stubs/link.tsx'),
    'next/navigation': resolve(preview, 'stubs/navigation.ts'),
  } },
  define: { 'process.env': JSON.stringify({ NODE_ENV: 'development', NEXT_PUBLIC_APP_VERSION: '0.1.0 · UX 预览' }) },
  server: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: true, fs: { allow: [project] } },
  build: { outDir: 'site-output' },
});
