/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  readonly PUBLIC_API_BASE_URL: string;
  readonly PUBLIC_BETTER_AUTH_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    // Triple-state session (auth-loading-flash fix): `null` is a PROVED
    // guest (getSession affirmatively returned no session); `undefined`
    // is UNKNOWN (the middleware gave up — 800ms timeout or throw — and
    // proved nothing). SSR readers must treat both as falsy (unknown is
    // null-safe: pages that can't wait keep guest behavior); only
    // InitialSession.astro distinguishes them for the client tag.
    user: import("better-auth").User | null | undefined;
    session: import("better-auth").Session | null | undefined;
  }
}
