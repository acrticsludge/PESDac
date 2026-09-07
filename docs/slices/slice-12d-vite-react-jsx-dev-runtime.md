# Slice 12D — Fix Vite 7 + React 19 jsx-dev-runtime crash

> **Status:** SHIPPED.
> **Date:** 2026-09-07.
> **Scope:** Dev server only; production build is unaffected.

## 1. Symptom

User reports: "I refresh, I see the actual page for 1 ms, then it's a blank page."

Browser console: `AppLayout.tsx:15 Uncaught TypeError: jsxDEV is not a function at AppLayout (AppLayout.tsx:15:5)`.

The SSR'd HTML paints briefly, then the client-side React island crashes on the first call to `jsxDEV` and unmounts everything.

## 2. Root cause

`package.json` pins `"vite": "^7"` (via `overrides`). React 19.2.8 ships `react/jsx-dev-runtime` as a CJS shim:

```js
// node_modules/react/jsx-dev-runtime.js
if (process.env.NODE_ENV === "production") {
  module.exports = require("./cjs/react-jsx-dev-runtime.production.js");
} else {
  module.exports = require("./cjs/react-jsx-dev-runtime.development.js");
}
```

In the **browser** (where the dev server's `?import` URL is consumed), `process.env.NODE_ENV` is `undefined`, so the if-branch evaluates to the production path. The production runtime is built without `jsxDEV` (it exports `jsx` and `jsxs` only). The shim then returns `null` for `jsxDEV` and React crashes on the first JSX call inside the island.

Astro 6's default Vite config doesn't pre-bundle `react/jsx-dev-runtime` because `@astrojs/react` 6 expects it to be resolved by Vite as a CJS module — which worked under Vite 6 + React 18, but is broken under Vite 7 + React 19 because Vite 7's CJS interop evaluates the CJS file server-side at module-graph-build time, and the conditional inside fails with the wrong `process.env`.

## 3. Fix

Add `optimizeDeps.include` for the four React 19 / jsx-* entry points to force Vite to pre-bundle them as proper ESM modules. Vite's prebundle step resolves the CJS conditional correctly (it runs in Node) and produces a single ESM wrapper the browser can consume.

`astro.config.mjs`:

```js
vite: {
  // ... existing config ...
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
}
```

The production build is unaffected: `astro build` always uses `react/jsx-runtime` (the production jsx transform), so the broken dev shim never enters the build pipeline.

## 4. Verification

- Dev server up cleanly (no warnings about React 19 CJS interop).
- `/login` and `/new` both return 200 with full content.
- Browser prebundled runtime is a proper ESM wrapper (verified by curling `/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=...`).
- `AppLayout.tsx` source is served with the prebundled import: `__vite__cjsImport0_react_jsxDevRuntime` + `const jsxDEV = __vite__cjsImport0_react_jsxDevRuntime["jsxDEV"]` (the standard Vite-prebundled pattern).
- `astro build` completes in 4.5s with no errors.

## 5. Rollback

Revert `astro.config.mjs`. Five-line change.

## 6. Out of scope

- Upgrading to Vite 8 or downgrading to Vite 6. The override is there for a reason; this is the smallest fix.
- Pinning React 19 to a specific patch version. The CJS shim behaviour is consistent across 19.x; the only fix is at the Vite config level.
- Investigating the chunk-size warning in the Vite optimize log (`chunk-HEOX6PIW exceeds 500KB`). That's a separate concern; Astryx is large. Tracked as a future optimization slice.
