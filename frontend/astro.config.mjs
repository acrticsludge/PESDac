// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  integrations: [react()],
  vite: {
    build: {
      // Baseline 2026-09-06: the single AppLayout island ships ~630 kB
      // (Astryx + React + app, one chunk). The limit silences the warning
      // at the measured baseline so *growth* from backend code stays
      // visible; route-splitting is backend-phase work (spec §5).
      chunkSizeWarningLimit: 700,
    },
  },
});
