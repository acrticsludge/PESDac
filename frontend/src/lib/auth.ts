// Auth facade for the React app. Single entry point.
import "./buffer-polyfill.ts"; // Must load before any auth module that uses Buffer.

import { useEffect, useState } from "react";
import { authClient } from "./auth-client.ts";
import { clearLocalProfileSeed } from "./session.ts";
import {
  mintTokenWithRetry,
  sharedTaggedFetch,
  isStaleTagged,
  withBearerToken,
  type TaggedCache,
  type TokenReason,
  type TokenResult,
} from "./auth-cache.ts";

const API_BASE_URL = import.meta.env?.PUBLIC_API_BASE_URL;
// Do not throw during module evaluation. A missing public env must produce a
// recoverable auth/API error, not prevent the React island from hydrating and
// leave Astro with an empty document.

/**
 * Minimum credential password length, stated upfront in password forms
 * to save a round trip. Mirrors the server's
 * emailAndPassword.minPasswordLength (lib/auth.ts); the server still
 * enforces it, so drift only costs a failed request, never a bad write.
 */
export const MIN_PASSWORD_LENGTH = 8;

// ---- Types -----------------------------------------------------------------

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  onboardingDone: boolean;
};

/**
 * Server profile row (GET/PATCH /profiles/me return the full row).
 * Only the fields the UI reads or writes are listed; the server may
 * return more (structural typing ignores extras). T20: displayName /
 * email are BetterAuth-owned identity fields; the PESDac profile API
 * does not return them. Read them from AuthUser (useProfile/useAuth)
 * and mutate them through BetterAuth's updateUser.
 */
export type ServerProfile = {
  institution: string;
  semester: string;
  branch: string;
  subjects: string[];
  campus: string;
  onboardingDone: boolean;
};

/**
 * BetterAuth session user (what the session cookie proves). Server-owned
 * profile data (displayName, onboardingDone) lives in AuthUser via
 * useProfile()/apiGetMe() — never read it off the session.
 */
export type SessionUser = {
  id: string;
  email: string;
  name: string;
  twoFactorEnabled: boolean;
};

export type AuthState =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "authenticated"; user: SessionUser };

// Server's error envelope (see app/schemas/common.py + main.py).
export type ApiErrorBody = {
  code: string;
  message: string;
  details?: unknown;
};

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;
  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.message ?? fallback);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** 401: caller should open the gate (UX-only; the server enforces auth). */
export class AuthRequiredError extends ApiError {
  constructor(body: ApiErrorBody | null) {
    super(401, body, "Sign in to continue.");
    this.name = "AuthRequiredError";
  }
}

/**
 * Render any caught failure as user-safe copy (error surface F3).
 * ApiError carries the server envelope message (server-authored,
 * user-safe). A TypeError means the request never reached the server
 * (DNS/refused/offline) — the browser's "Failed to fetch" means
 * nothing to users, so map it to connection copy. Same for an
 * AbortError from the apiFetch timeout below.
 *
 * Status code mapping (per slice 15):
 * - 404: the URL the frontend asked for doesn't exist on the server.
 *   The user can't fix this and shouldn't be told to "restart the
 *   server" (they don't have access). Tell them to try again later;
 *   the operator's 404 surfaces in the server log.
 * - 5xx: server error. Same user-safe copy. The ref ID is logged
 *   server-side for the operator; the client never sees it.
 * - Other 4xx: server-authored user-safe message if it has one,
 *   else the fallback.
 */
export function toUserMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return "That didn't work. Please try again later.";
    }
    if (error.status >= 500) {
      return "That didn't work on our end. Please try again later.";
    }
    return error.message && error.message !== "Not Found"
      ? error.message
      : fallback;
  }
  if (error instanceof TypeError) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Fired on window whenever the backend rejects our session (401).
 * The shell subscribes (Pesdac) and routes to re-login. Named export
 * so the event name can't drift between dispatcher and subscriber.
 */
export const AUTH_REQUIRED_EVENT = "pesdac:auth-required";

/**
 * Monotonic epoch that bumps on logout, deletion, and explicit 401
 * handling. Listeners can compare to invalidate cached promises/data
 * that belong to a previous user — without this, a stale profile/account
 * fetch resolving after logout can repaint a logged-out shell with
 * authenticated data (T13/T28).
 */
let authEpoch = 0;
export function getAuthEpoch(): number {
  return authEpoch;
}
export function bumpAuthEpoch(): void {
  authEpoch += 1;
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent("pesdac:auth-epoch"));
    } catch {
      // SSR / no-window fallback (only test harness reaches here).
    }
  }
}

/**
 * Reads the JSON embedded by `<InitialSession />` on the server.
 * Used by useAuth() so the first render already knows guest vs
 * authenticated, without waiting for /api/auth/get-session.
 *
 * The script tag is rendered in the body before any `client:load`
 * island, so it is available the moment React mounts. The cache
 * is process-global; React StrictMode double-invokes effects, not
 * reads, so this is safe.
 *
 * Returns `null` (guest) when:
 * - the script tag is missing (auth pages, transit navigation,
 *   server error), or
 * - the script is the literal `null` (no session cookie), or
 * - the JSON is malformed (defensive; never throws).
 */
let initialSessionCache: { raw: string; value: SessionUser | null } | undefined;
function readInitialSession(): SessionUser | null {
  if (typeof document === "undefined") {
    return null;
  }
  const el = document.getElementById("pesdac:initial-session");
  const raw = el?.textContent ?? "null";
  // Astro transitions can replace the embedded session script without
  // reloading this module. Cache by the script contents, not process-wide,
  // so a guest -> authenticated transition cannot retain a stale null.
  if (initialSessionCache?.raw === raw) return initialSessionCache.value;
  try {
    const parsed = JSON.parse(raw) as SessionUser | null;
    const value =
      parsed && typeof parsed.id === "string" && typeof parsed.email === "string"
        ? {
            id: parsed.id,
            email: parsed.email,
            name: parsed.name ?? "",
            twoFactorEnabled: parsed.twoFactorEnabled === true,
          }
        : null;
    initialSessionCache = { raw, value };
  } catch {
    initialSessionCache = { raw, value: null };
  }
  return initialSessionCache.value;
}

// Let callers observe epoch changes (e.g. hook into a re-render or test).
export function useAuthEpoch(): number {
  const [epoch, setEpoch] = useState(getAuthEpoch());
  useEffect(() => {
    const handler = () => setEpoch(getAuthEpoch());
    window.addEventListener(AUTH_REQUIRED_EVENT, handler);
    window.addEventListener("pesdac:auth-epoch", handler);
    return () => {
      window.removeEventListener(AUTH_REQUIRED_EVENT, handler);
      window.removeEventListener("pesdac:auth-epoch", handler);
    };
  }, []);
  return epoch;
}

// ---- useAuth ---------------------------------------------------------------

/**
 * Current session state, backed by the BetterAuth session cookie.
 * Session-only: id/email/name plus the 2FA flag the Authentication
 * section needs. Anything the server owns (displayName,
 * onboardingDone) comes from useProfile(), not here.
 *
 * First render uses the server-embedded session (see
 * <InitialSession />) so the gate and onboarding can decide guest
 * vs authenticated instantly. After hydration, the live
 * authClient.useSession() takes over for cross-tab sign-out and
 * server-side session invalidation.
 */
export function useAuth(): AuthState {
  const { data: session, isPending } = authClient.useSession();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  // The server render cannot inspect `document`, so it always renders the
  // loading branch. Keep the first browser render identical; only consult
  // the embedded session after the hydration effect has committed.
  if (!hydrated) {
    return { status: "loading" };
  }

  if (isPending) {
    const cached = readInitialSession();
    if (cached) {
      return { status: "authenticated", user: cached };
    }
    // No server hint means the client is still authoritative-checking the
    // cookie. Never classify that window as guest: AuthGate would open a
    // destructive-looking create-account prompt over a valid session.
    return { status: "loading" };
  }

  if (session?.user) {
    return {
      status: "authenticated",
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        twoFactorEnabled: session.user.twoFactorEnabled === true,
      },
    };
  }

  return { status: "guest" };
}

// ---- Auth actions (BetterAuth client) -------------------------------------

export async function signIn(email: string, password: string) {
  // User-A → user-B transition safety (T28): every successful sign-in
  // is a different identity. The cached /auth/me + accounts promises
  // could still belong to user-A; drop them so the next reader doesn't
  // paint user-B's screen with user-A's data.
  clearAuthCache();
  return authClient.signIn.email({ email, password });
}

export async function signUp(email: string, password: string, name: string) {
  clearAuthCache();
  return authClient.signUp.email({ email, password, name });
}

export async function signOut() {
  return authClient.signOut();
}

export async function signInWithGoogle() {
  // User-A → user-B transition safety (T28, logout/relogin fix): every
  // sign-in is a different identity. The email signIn/signUp paths
  // already drop cached /auth/me + accounts promises; social login must
  // do the same or user-A's cached rows can paint user-B's first screens.
  clearAuthCache();
  return authClient.signIn.social({ provider: "google" });
}

export async function linkGoogle() {
  return authClient.linkSocial({ provider: "google" });
}

/** A sign-in method attached to the user (from GET /list-accounts). */
export type LinkedAccount = {
  id: string;
  providerId: string;
  accountId: string;
};

// Identity-scoped promise cache (T41): each entry is tagged with the
// user-id at fetch time. A stale resolve (user-A's promise landing in
// user-B's screen, or a 401-triggered `clearAuthCache()` racing a still
// in-flight fetch) is dropped by comparing the captured user-id to the
// current session user-id before fulfilling the caller. Listeners can
// also compare the auth epoch via `getAuthEpoch()`.

let currentAccountsCache: TaggedCache<LinkedAccount[]> | null = null;

/**
 * List linked sign-in methods (identity-scoped shared cache; guests
 * never fetch). A request initiated for user A is never fulfilled for
 * user B even if A's promise resolves after B took over.
 */
export async function apiGetAccounts(currentUserId: string): Promise<LinkedAccount[]> {
  if (currentAccountsCache && currentAccountsCache.userId === currentUserId) {
    return currentAccountsCache.promise;
  }
  const { result } = sharedTaggedFetch(
    currentAccountsCache,
    () =>
      authClient.listAccounts().then((res) => {
        if (res.error || !res.data) {
          throw new Error(
            res.error?.message ?? "Couldn't load linked accounts.",
          );
        }
        return res.data.map((a) => ({
          id: a.id,
          providerId: a.providerId,
          accountId: a.accountId,
        }));
      }),
    currentUserId,
    (entry) => {
      currentAccountsCache = entry;
    },
    (entry) => currentAccountsCache === entry,
  );
  // Drop results that arrive after the user switched (T41 stale guard).
  return result.then((accounts) => {
    if (isStaleTagged(currentAccountsCache, currentUserId)) {
      throw new Error("identity-changed");
    }
    return accounts;
  });
}

/** Drop the cached account list (after link/unlink, logout, 401). */
export function refreshAccounts(): void {
  currentAccountsCache = null;
}

export type AccountsState =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "ready"; accounts: LinkedAccount[] }
  | { status: "error"; error: unknown };

/** Linked sign-in methods for the Authentication section. */
export function useAccounts(): AccountsState {
  const auth = useAuth();
  const [state, setState] = useState<AccountsState>({ status: "loading" });

  useEffect(() => {
    if (auth.status === "loading") return;
    if (auth.status === "guest") {
      setState({ status: "guest" });
      return;
    }
    let cancelled = false;
    const userId = auth.user.id;
    setState({ status: "loading" });
    apiGetAccounts(userId).then(
      (accounts) => {
        if (!cancelled) setState({ status: "ready", accounts });
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: "error", error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [auth.status, auth.status === "authenticated" ? auth.user.id : null]);

  return state;
}

/**
 * Detach a linked sign-in method. The server refuses to unlink the last
 * remaining method — the UI only offers Unlink when 2+ exist, so this
 * throwing means the state raced (banner it, don't navigate).
 */
export async function unlinkAccount(accountId: string): Promise<void> {
  const res = await authClient.unlinkAccount({ accountId });
  if (res.error) {
    throw new Error(res.error.message ?? "Couldn't unlink. Try again.");
  }
  refreshAccounts();
}

/** Start TOTP setup: returns the authenticator key + one-time backup codes. */
export async function enableTwoFactor(): Promise<{
  totpURI: string;
  backupCodes: string[];
}> {
  const res = await authClient.twoFactor.enable({
    method: "totp",
    issuer: "PESDac",
  });
  if (res.error || !res.data || !("totpURI" in res.data)) {
    throw new Error(
      res.error?.message ?? "Couldn't start 2FA setup. Try again.",
    );
  }
  return { totpURI: res.data.totpURI, backupCodes: res.data.backupCodes };
}

/** Confirm TOTP setup with a 6-digit code from the authenticator app. */
export async function verifyTwoFactorSetup(code: string): Promise<void> {
  const res = await authClient.twoFactor.verifyTotp({ code: code.trim() });
  if (res.error) {
    throw new Error(
      res.error.message ?? "That code didn't work. Try again.",
    );
  }
}

/**
 * Finish an email sign-in that challenged for TOTP (the sign-in response
 * carried twoFactorRedirect). Same endpoint the setup flow verifies
 * against — here it completes a login, not a setup.
 */
export async function verifySignInTwoFactor(code: string): Promise<void> {
  const res = await authClient.twoFactor.verifyTotp({ code: code.trim() });
  if (res.error) {
    throw new Error(
      res.error.message ?? "That code didn't work. Try again.",
    );
  }
}

/**
 * Change the credential password (current + new). Google-only users have
 * no credential account — the server answers CREDENTIAL_ACCOUNT_NOT_FOUND,
 * surfaced below.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const res = await authClient.changePassword({
    currentPassword,
    newPassword,
  });
  if (res.error) {
    throw new Error(
      res.error.message ?? "Couldn't change your password. Try again.",
    );
  }
}

/**
 * Attach an email+password credential to the current user. Google-only
 * users have no credential account — there is no client-callable setPassword
 * in BetterAuth 1.7.3, so we proxy to a server route that holds the
 * session cookie and calls `auth.api.setPassword` server-side. On
 * success the BetterAuth account row is added; `refreshAccounts()` drops
 * the cached list so the new credential surfaces immediately in the UI.
 */
export async function linkPassword(newPassword: string): Promise<void> {
  const res = await apiFetch<{ ok: true }>("/auth/link-password", {
    method: "POST",
    body: { newPassword },
  });
  if (!res?.ok) {
    throw new Error("Couldn't link password. Try again.");
  }
  refreshAccounts();
}

/** Turn TOTP off (no password prompt for Google-only users). */
export async function disableTwoFactor(): Promise<void> {
  const res = await authClient.twoFactor.disable({});
  if (res.error) {
    throw new Error(res.error.message ?? "Couldn't turn off 2FA. Try again.");
  }
}

/**
 * Read /auth/me and return the parsed user. Used by the gate (to
 * learn `onboardingDone`) and the profile dialog (to learn real
 * email/displayName).
 *
 * One shared in-flight/cached request per session: the onboarding
 * dialog and useProfile() ask for the same row. Identity-scoped (T41):
 * a request initiated for user A cannot leak into user B. A rejection
 * clears the cache so the next caller retries instead of replaying the
 * failure.
 */
let currentMeCache: TaggedCache<AuthUser> | null = null;
let currentProfileCache: TaggedCache<ServerProfile> | null = null;

export async function apiGetMe(currentUserId: string): Promise<AuthUser> {
  if (currentMeCache && currentMeCache.userId === currentUserId) {
    return currentMeCache.promise;
  }
  const { result } = sharedTaggedFetch(
    currentMeCache,
    () => apiFetch<{ user: AuthUser }>("/auth/me").then((res) => res.user),
    currentUserId,
    (entry) => {
      currentMeCache = entry;
    },
    (entry) => currentMeCache === entry,
  );
  return result.then((user) => {
    if (isStaleTagged(currentMeCache, currentUserId)) {
      throw new Error("identity-changed");
    }
    return user;
  });
}

/** Drop the cached /auth/me (logout, 401, or after saving onboarding). */
export function refreshProfile(): void {
  currentMeCache = null;
  currentProfileCache = null;
}

export type ProfileState =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "ready"; user: AuthUser }
  | { status: "error"; error: unknown };

/**
 * Server-owned identity: displayName/email/onboardingDone from /auth/me.
 * Guest sessions never fetch; authenticated sessions share the one
 * cached apiGetMe() request.
 */
export function useProfile(): ProfileState {
  const auth = useAuth();
  const [state, setState] = useState<ProfileState>({ status: "loading" });

  useEffect(() => {
    if (auth.status === "loading") return;
    if (auth.status === "guest") {
      setState({ status: "guest" });
      return;
    }
    let cancelled = false;
    const userId = auth.user.id;
    setState({ status: "loading" });
    apiGetMe(userId).then(
      (user) => {
        if (!cancelled) setState({ status: "ready", user });
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: "error", error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [auth.status, auth.status === "authenticated" ? auth.user.id : null]);

  return state;
}

/** Read the full server profile row (auto-creates a blank row first time). */
export async function apiGetProfile(currentUserId: string): Promise<ServerProfile> {
  if (currentProfileCache && currentProfileCache.userId === currentUserId) {
    return currentProfileCache.promise;
  }
  const { result } = sharedTaggedFetch(
    currentProfileCache,
    () => apiFetch<ServerProfile>("/profiles/me"),
    currentUserId,
    (entry) => {
      currentProfileCache = entry;
    },
    (entry) => currentProfileCache === entry,
  );
  return result.then((profile) => {
    if (isStaleTagged(currentProfileCache, currentUserId)) {
      throw new Error("identity-changed");
    }
    return profile;
  });
}

/**
 * Merge a partial profile into the server row; returns the full row.
 * Values are server-validated (campus RR/EC/blank, semesters, branches,
 * ≤5 known subjects) — a 422 surfaces as ApiError for the caller to
 * render.
 */
export async function apiUpdateProfile(
  patch: Record<string, string | string[] | boolean>,
): Promise<ServerProfile> {
  return apiFetch<ServerProfile>("/profiles/me", {
    method: "PATCH",
    body: patch,
  });
}

// ---- apiFetch --------------------------------------------------------------

/**
 * Typed recoverable error for auth-service outages (token-mint failures).
 * These are transient, non-session-invalidating failures that should use
 * existing toast/retry handling and keep the user in the current shell.
 * Distinguished from AuthRequiredError (backend 401) and ApiError (other status codes).
 */
export class AuthServiceError extends Error {
  readonly code: "auth-service-unavailable";
  readonly reason: TokenReason;
  readonly retry?: { afterMs: number };
  constructor(reason: Exclude<TokenReason, "ok">, retry?: { afterMs: number }) {
    const msg = reason === "missing-config" ? "Authentication service is not configured. Please contact your administrator." :
      reason === "network" ? "Couldn't reach the authentication service. Check your connection and try again." :
      reason === "timeout" ? "Authentication service timed out. Please try again." :
      reason === "rate-limited" ? "Too many authentication attempts. Please wait and try again." :
      reason === "server" ? "Authentication service is temporarily unavailable. Please try again later." :
      reason === "malformed" ? "Authentication service returned an invalid response. Please try again." :
      reason === "client-error" ? "Authentication failed. Please check your credentials." :
      reason === "unexpected-status" ? "Authentication service returned an unexpected response. Please try again." :
      "Authentication service failed.";
    super(msg);
    this.name = "AuthServiceError";
    this.code = "auth-service-unavailable";
    this.reason = reason;
    this.retry = retry;
  }
}

export type ApiFetchInit = Omit<RequestInit, "body" | "headers"> & {
  body?: unknown;
  headers?: Record<string, string>;
};

// The backend serves everything under /api/v1 (see app/main.py). The
// prefix is joined here — the single place — so callers pass bare
// paths ("/auth/me") and PUBLIC_API_BASE_URL stays a clean host.
// (Audit: without this every call 404s; there is no dev proxy.)
const API_PREFIX = "/api/v1";
// Test-only override mirroring authBaseOverride below: the node test runner
// has no PUBLIC_API_BASE_URL, so tests set the root explicitly. Empty in
// production unless the env is missing (then apiFetch throws missing-config).
let apiRootOverride = "";
function currentApiRoot(): string {
  return (apiRootOverride || (API_BASE_URL ?? "")).replace(/\/+$/, "");
}

// Hung backend must not hang the UI with no feedback: abort the request
// and let toUserMessage render the connection copy (AbortError branch).
const API_TIMEOUT_MS = 15000;
// Token mint shares the same budget but with its own shorter timeout
// (T2): the auth endpoint is small and authenticated, so a stalled mint
// is the BetterAuth server being unreachable — different problem from
// a slow downstream API.
const TOKEN_TIMEOUT_MS = 8000;

// Service token for the FastAPI backend: GET /api/auth/token mints a
// short-lived JWT (15m server-side default) for the current session.
// Cached in memory for 5 minutes so one token covers a burst of apiFetch
// calls; cleared on logout and on 401.
// Test-only override: lets the node test suite swap the base URL when
// PUBLIC_BETTER_AUTH_URL is unset in a build env. Empty in production.
let authBaseOverride = "";
function currentAuthBase(): string {
  return (
    authBaseOverride ||
    (import.meta.env?.PUBLIC_BETTER_AUTH_URL ?? "")
  ).replace(/\/+$/, "");
}

const TOKEN_TTL_MS = 5 * 60 * 1000;
let cachedToken: { token: string; at: number } | null = null;
// In-flight dedupe: many simultaneous apiFetch callers share one mint.
// Captured promise so caller-A's rejection doesn't trip caller-B.
let inFlightToken: Promise<TokenResult> | null = null;

/** Outcome categories for getBackendToken — distinct enough that callers
 *  can tell "confirmed guest" from "auth service down" from "aborted".
 *  Backend endpoints never see a token from a confused service, but the
 *  type is also useful for tests (we assert on the reason, not a string). */
async function getBackendToken(): Promise<TokenResult> {
  if (cachedToken && Date.now() - cachedToken.at < TOKEN_TTL_MS) {
    return { reason: "ok", token: cachedToken.token };
  }
  cachedToken = null;
  const base = currentAuthBase();
  if (!base) return { reason: "missing-config" };
  if (inFlightToken) return inFlightToken;
  inFlightToken = mintBackendTokenWithRetry(base);
  try {
    const result = await inFlightToken;
    return result;
  } finally {
    inFlightToken = null;
  }
}

/**
 * Token-mint wrapper that caches a successful token and delegates the
 * retry policy to the pure helper in `./auth-cache`. The first attempt
 * must always go through `mintTokenOnce`; `mintTokenWithRetry` runs a
 * second attempt on transient failures with a 200ms backoff (T40).
 */
async function mintBackendTokenWithRetry(base: string): Promise<TokenResult> {
  const result = await mintTokenWithRetry(base, fetch, TOKEN_TIMEOUT_MS);
  if (result.reason === "ok") {
    cachedToken = { token: result.token, at: Date.now() };
  }
  return result;
}

/** Drop cached auth material (logout, 401, account delete). */
export function clearAuthCache(): void {
  cachedToken = null;
  currentMeCache = null;
  currentProfileCache = null;
  currentAccountsCache = null;
  bumpAuthEpoch();
}

export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const apiRoot = currentApiRoot();
  if (!apiRoot) {
    throw new AuthServiceError("missing-config");
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init.headers ?? {}),
  };
  // The FastAPI backend verifies a BetterAuth JWT (see app/deps.py), not
  // the session cookie — attach it when a session exists. Guests send no
  // header and get the usual 401 envelope below.
  const tokenResult = await getBackendToken();
  const authorizedHeaders = withBearerToken(headers, tokenResult);
  if (!authorizedHeaders) {
    // `withBearerToken` and this branch are intentionally paired. Keep the
    // impossible ok case explicit so TypeScript and future refactors cannot
    // accidentally turn a missing header into an unauthenticated request.
    if (tokenResult.reason === "ok") {
      throw new Error("Token/header authorization invariant violated.");
    }
    // Auth service outage / timeout / malformed: do not proceed to protected
    // backend request. These are transient failures, not proof the session
    // is invalid. The user stays in the current shell with a recoverable error.
    if (tokenResult.reason === "rate-limited") {
      throw new AuthServiceError(tokenResult.reason, { afterMs: 60000 });
    }
    if (tokenResult.reason === "server" || tokenResult.reason === "client-error") {
      throw new AuthServiceError(tokenResult.reason);
    }
    throw new AuthServiceError(tokenResult.reason);
  }
  const body =
    init.body === undefined ? undefined : JSON.stringify(init.body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${apiRoot}${API_PREFIX}${path}`, {
      ...init,
      headers: body
        ? { ...authorizedHeaders, "Content-Type": "application/json" }
        : authorizedHeaders,
      body,
      credentials: "include",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  const parsed: unknown = text ? safeJson(text) : null;
  if (!res.ok) {
    const body = isErrorBody(parsed) ? parsed : null;
    if (res.status === 401) {
      // Backend rejected the session. Drop any cached token/identity so
      // the next call re-proves itself, then notify the shell so it can
      // route to re-login — the gate alone can't see this state.
      clearAuthCache();
      // Dispatch deduplicated: many simultaneous 401s only navigate once.
      // Per T13 the shell already guards against re-entry; this is the
      // belt to that suspenders so test infra can mock the listener.
      if (typeof window !== "undefined") {
        if (!(window as { __pesdacAuthDispatched?: boolean }).__pesdacAuthDispatched) {
          (window as { __pesdacAuthDispatched?: boolean }).__pesdacAuthDispatched = true;
          window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
          // Reset on next tick so subsequent distinct sessions can fire.
          // Guarded: the callback outlives the caller and window may be gone
          // (SSR teardown, test harness removing its fake window).
          setTimeout(() => {
            if (typeof window !== "undefined") {
              (window as { __pesdacAuthDispatched?: boolean }).__pesdacAuthDispatched = false;
            }
          }, 0);
        }
      }
      throw new AuthRequiredError(body);
    }
    throw new ApiError(res.status, body, res.statusText || "Request failed.");
  }
  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isErrorBody(v: unknown): v is ApiErrorBody {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { code?: unknown }).code === "string" &&
    typeof (v as { message?: unknown }).message === "string"
  );
}

// ---- Logout / delete -------------------------------------------------------

/** Outcome categories for apiLogout — honest about which side
 *  completed. Local state is ALWAYS cleared (gate reopens on next visit
 *  regardless). Server revocation may fail; we never claim full
 *  revocation if the backend call failed, but we still navigate. */
export type LogoutOutcome =
  | { kind: "ok" }
  | { kind: "server-failed"; message: string };

/**
 * Sign out everywhere: drop cached auth material, attempt backend logout,
 * then clear the BetterAuth session cookie. Every step is best-effort —
 * we always clear local state regardless of outcome so the user lands
 * on /login with no stale session hanging around. Backend/BetterAuth
 * failures are recorded in the returned outcome but never block the
 * local cleanup (per slice 15 + audit C5).
 */
export async function apiLogout(): Promise<LogoutOutcome> {
  clearAuthCache();
  // Identity hygiene (logout/relogin fix): the local profile seed is a
  // separate store from the server caches above — without this, user-A's
  // campus/semester/branch/subjects survive into user-B's session.
  clearLocalProfileSeed();
  let serverFailed = false;
  let message = "";
  try {
    await apiFetch<void>("/auth/logout", { method: "POST" });
  } catch (e) {
    serverFailed = true;
    message = toUserMessage(e, "Couldn't tell the server you logged out.");
  }
  try {
    await authClient.signOut();
  } catch {
    // Session already gone server-side — nothing left to clear.
  }
  return serverFailed ? { kind: "server-failed", message } : { kind: "ok" };
}

/**
 * Account deletion contract (T22/T31).
 *
 * Chosen strategy: pre-authorized backend deletion FIRST, then identity
 * deletion. The backend owns all PESDac data (users row cascades
 * profile/chats/demos); after backend DELETE succeeds, we have a
 * well-defined completion state. Identity deletion then succeeds
 * because the BetterAuth session is still valid (we just used it).
 *
 * Failure orderings:
 *   - Backend success, identity delete succeeds   → fully complete.
 *   - Backend success, identity delete fails     → backend data gone but
 *     sign-in record remains. User can retry the identity delete from
 *     login page; backend confirms idempotently that the user is gone.
 *   - Backend fails                              → no data touched.
 *     User can retry; the backend call is idempotent (returns 204
 *     whether the user existed or not).
 *   - Network/server failure at any step         → typed outcome lets
 *     the UI show a recoverable state with a retry reference.
 *
 * The previous "delete identity first then backend" ordering left
 * PESDac rows when the backend call failed (audit C3); the new
 * ordering eliminates that class of orphan by completing the
 * irreversible work only after the backend is reachable.
 */
export type DeleteAccountOutcome =
  | { kind: "complete" }
  | { kind: "identity-pending"; reference: string }
  | { kind: "backend-failed"; reference: string; message: string };

function newReference(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  }
  return Math.random().toString(16).slice(2, 10).padEnd(8, "0");
}

export async function apiDeleteAccount(): Promise<DeleteAccountOutcome> {
  const reference = newReference();
  // 1. Backend first (pre-authorized, session still valid).
  try {
    await apiFetch<void>("/users/me", { method: "DELETE" });
  } catch (e) {
    return {
      kind: "backend-failed",
      reference,
      message: toUserMessage(
        e,
        "PESDac couldn't reach the server to remove your data. Try again.",
      ),
    };
  }
  // 2. Identity deletion (sign-in record). Best effort — backend data
  // is already gone, and a stray sign-in row on its own can't recover
  // PESDac state. We surface a pending state if this fails so the
  // user knows their sign-in still exists and how to retry.
  try {
    const deleted = await authClient.deleteUser();
    if (deleted.error) {
      throw new Error(
        deleted.error.message ?? "BetterAuth deleteUser failed.",
      );
    }
  } catch {
    return { kind: "identity-pending", reference };
  }
  // 3. Local cleanup only after both upstream steps are confirmed.
  clearAuthCache();
  try {
    await authClient.signOut();
  } catch {
    // Already gone.
  }
  return { kind: "complete" };
}

// ---- Test hooks ------------------------------------------------------------
//
// Internal helpers used by `frontend/tests/`. They are exported so the
// node test runner can reset module-level state between cases; they
// never affect production behavior (no caller in src/ uses them).

/** Reset every identity-scoped cache (me/profile/accounts/token). */
export function __resetAuthCachesForTesting(): void {
  cachedToken = null;
  currentMeCache = null;
  currentProfileCache = null;
  currentAccountsCache = null;
  inFlightToken = null;
}

/**
 * Override the BetterAuth base URL used by the token mint helper. Only
 * effective when `PUBLIC_BETTER_AUTH_URL` is unset (the dev build
 * normally picks it up from env). Test-only.
 */
export function __setAuthBaseForTesting(value: string): void {
  authBaseOverride = value.replace(/\/+$/, "");
}

/** Snapshot of the BetterAuth base URL (test introspection only). */
export function __getAuthBaseForTesting(): string {
  return currentAuthBase();
}

/**
 * Override the API root used by apiFetch. Mirrors __setAuthBaseForTesting:
 * the node test runner has no PUBLIC_API_BASE_URL. Test-only.
 */
export function __setApiRootForTesting(value: string): void {
  apiRootOverride = value.replace(/\/+$/, "");
}

/** Snapshot of the API root (test introspection only). */
export function __getApiRootForTesting(): string {
  return currentApiRoot();
}

/**
 * Swap `globalThis.fetch` for the duration of the returned restore
 * closure. Used by the node test suite to mock token and api responses
 * without a real network. Calling again before restoring throws — tests
 * should always restore or call in a `try/finally`.
 */
export function __setFetchForTesting(
  impl: typeof fetch,
): () => void {
  const previous = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = previous;
  };
}
