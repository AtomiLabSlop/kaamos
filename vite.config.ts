import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  build: {
    target: 'es2022',
    // Never publish source maps: they would hand out the original source.
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
});
