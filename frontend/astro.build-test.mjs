import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  integrations: [react()],
  adapter: () => import('C:/Users/anubh/AppData/Local/Temp/opencode/test-adapter/index.js'),
  output: 'hybrid',
  vite: {
    build: { chunkSizeWarningLimit: 750 },
  },
});
