import { betterAuth } from "better-auth";
import { twoFactor, jwt } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import * as schema from "./db/schema";

// Same dual-source rule as lib/db/index.ts: Astro 6 dev SSR exposes
// .env through import.meta.env, not process.env.
const serverEnv = (k: string): string | undefined =>
  process.env[k] ??
  (import.meta.env as Record<string, string | undefined>)[k];

const configuredTrustedOrigins = (serverEnv("BETTER_AUTH_TRUSTED_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);
const configuredTrustedProxies = (serverEnv("BETTER_AUTH_TRUSTED_PROXIES") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export const auth = betterAuth({
  appName: "PESDac",
  baseURL: serverEnv("BETTER_AUTH_URL") || "http://localhost:4321",
  secret: serverEnv("BETTER_AUTH_SECRET")!,
  // Keep callbackURL/origin validation explicit. The Better Auth base URL is
  // trusted automatically; deployment-specific frontend origins belong in
  // BETTER_AUTH_TRUSTED_ORIGINS rather than a wildcard.
  trustedOrigins: configuredTrustedOrigins,
  
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  
  socialProviders: {
    google: {
      clientId: serverEnv("GOOGLE_CLIENT_ID")!,
      clientSecret: serverEnv("GOOGLE_CLIENT_SECRET")!,
    },
  },
  
  plugins: [
    // allowPasswordless: Google-only users have no credential password,
    // so password-gated 2FA flows must not demand one. Users WITH a
    // password still have to provide it (BetterAuth checks the credential
    // account when one exists).
    twoFactor({ issuer: "PESDac", allowPasswordless: true }),
    // Issues short-lived JWTs (GET /api/auth/token) and serves the JWKS
    // (GET /api/auth/jwks) the FastAPI backend verifies against. The
    // token payload is the session user (sub = user id, incl. email),
    // which is exactly what backend/app/auth/betterauth.py requires.
    jwt(),
  ],

  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },
  },

  // Keep Better Auth endpoint protection enabled in every environment. The
  // backend has its own route limits; this protects the identity endpoints
  // and is intentionally bounded for local development as well.
  rateLimit: {
    enabled: true,
    window: 10,
    max: 100,
  },

  advanced: {
    // Production deployments should forward one of these headers only from
    // a trusted reverse proxy. Local dev has no meaningful socket IP in the
    // Astro adapter, so disable IP extraction there while retaining the
    // per-path limiter.
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for", "x-real-ip"],
      trustedProxies: configuredTrustedProxies,
      disableIpTracking: serverEnv("ENV") !== "prod",
    },
  },

  // Account deletion is a first-class flow (profile Danger zone): direct
  // delete gated by a fresh session (no email verification step — the app
  // has no email provider). See apiDeleteAccount in the frontend facade.
  user: {
    deleteUser: {
      enabled: true,
    },
  },
});
