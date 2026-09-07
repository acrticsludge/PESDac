// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// https://astro.build/config
export default defineConfig({
  integrations: [react()],
  adapter: (await import('@astrojs/node')).default({ mode: 'standalone' }),
  vite: {
    define: {
      global: "globalThis",
    },
    resolve: {
      alias: [
        { find: /^buffer$/, replacement: resolve(__dirname, 'src/lib/buffer-polyfill.ts') },
        { find: /^events$/, replacement: resolve(__dirname, 'src/lib/events-polyfill.ts') },
      ],
    },
    // Vite 7 + React 19 + Astro 6: react/jsx-dev-runtime ships as a CJS
    // shim that returns null when process.env.NODE_ENV is undefined in
    // the browser, so the island's `jsxDEV` import is undefined and the
    // whole app crashes on first render. Force Vite to pre-bundle the
    // runtimes (which produces a proper ESM wrapper) so the import
    // resolves to a real function in the dev server.
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    build: {
      // Baseline 2026-09-06: the single AppLayout island ships ~630 kB
      // (Astryx + React + app, one chunk), rising to ~714 kB with the
      // profile dialog (SideNav, SegmentedControl, extra icons). The limit
      // silences the warning at the measured baseline so *growth* from
      // backend code stays visible; route-splitting is backend-phase work
      // (spec A5).
      chunkSizeWarningLimit: 750,
    },
  },
});
