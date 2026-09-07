// Auth facade for the React app. Single entry point.
import "./buffer-polyfill"; // Must load before any auth module that uses Buffer.

import { useEffect, useState } from "react";
import { authClient } from "./auth-client";

const API_BASE_URL = import.meta.env.PUBLIC_API_BASE_URL;
if (!API_BASE_URL) {
  throw new Error(
    "PUBLIC_API_BASE_URL is not set. Add it to frontend/.env (see .env.example).",
  );
}

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
 * return more (structural typing ignores extras).
 */
export type ServerProfile = {
  displayName: string;
  email: string;
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
 */
export function toUserMessage(error: unknown, fallback: string): string {
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
let initialSessionCache: SessionUser | null | undefined;
function readInitialSession(): SessionUser | null {
  if (initialSessionCache !== undefined) return initialSessionCache;
  if (typeof document === "undefined") {
    initialSessionCache = null;
    return null;
  }
  const el = document.getElementById("pesdac:initial-session");
  const raw = el?.textContent ?? "null";
  try {
    const parsed = JSON.parse(raw) as SessionUser | null;
    initialSessionCache =
      parsed && typeof parsed.id === "string" && typeof parsed.email === "string"
        ? {
            id: parsed.id,
            email: parsed.email,
            name: parsed.name ?? "",
            twoFactorEnabled: parsed.twoFactorEnabled === true,
          }
        : null;
  } catch {
    initialSessionCache = null;
  }
  return initialSessionCache;
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

  if (!hydrated || isPending) {
    const cached = readInitialSession();
    if (cached) {
      return { status: "authenticated", user: cached };
    }
    return { status: "guest" };
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
  return authClient.signIn.email({ email, password });
}

export async function signUp(email: string, password: string, name: string) {
  return authClient.signUp.email({ email, password, name });
}

export async function signOut() {
  return authClient.signOut();
}

export async function signInWithGoogle() {
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

let accountsPromise: Promise<LinkedAccount[]> | null = null;

/** List linked sign-in methods (shared cache; guests never fetch). */
export async function apiGetAccounts(): Promise<LinkedAccount[]> {
  if (!accountsPromise) {
    accountsPromise = authClient.listAccounts().then((res) => {
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
    });
    void accountsPromise.catch(() => {
      accountsPromise = null;
    });
  }
  return accountsPromise;
}

/** Drop the cached account list (after link/unlink, logout, 401). */
export function refreshAccounts(): void {
  accountsPromise = null;
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
    setState({ status: "loading" });
    apiGetAccounts().then(
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
  }, [auth.status]);

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
 * surfaced below. There is no client path to SET a first password: the
 * server's setPassword endpoint is serverOnly in BetterAuth 1.7.3, and
 * the reset-email flow needs a mail sender we don't have.
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
 * dialog and useProfile() ask for the same row. A rejection clears the
 * cache so the next caller retries instead of replaying the failure.
 */
let mePromise: Promise<AuthUser> | null = null;

export async function apiGetMe(): Promise<AuthUser> {
  if (!mePromise) {
    mePromise = apiFetch<{ user: AuthUser }>("/auth/me").then(
      (res) => res.user,
    );
    void mePromise.catch(() => {
      mePromise = null;
    });
  }
  return mePromise;
}

/** Drop the cached /auth/me (logout, 401, or after saving onboarding). */
export function refreshProfile(): void {
  mePromise = null;
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
    setState({ status: "loading" });
    apiGetMe().then(
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
  }, [auth.status]);

  return state;
}

/** Read the full server profile row (auto-creates a blank row first time). */
export async function apiGetProfile(): Promise<ServerProfile> {
  return apiFetch<ServerProfile>("/profiles/me");
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

export type ApiFetchInit = Omit<RequestInit, "body" | "headers"> & {
  body?: unknown;
  headers?: Record<string, string>;
};

// The backend serves everything under /api/v1 (see app/main.py). The
// prefix is joined here — the single place — so callers pass bare
// paths ("/auth/me") and PUBLIC_API_BASE_URL stays a clean host.
// (Audit: without this every call 404s; there is no dev proxy.)
const API_PREFIX = "/api/v1";
const API_ROOT = API_BASE_URL.replace(/\/+$/, "");

// Hung backend must not hang the UI with no feedback: abort the request
// and let toUserMessage render the connection copy (AbortError branch).
const API_TIMEOUT_MS = 15000;

// Service token for the FastAPI backend: GET /api/auth/token mints a
// short-lived JWT (15m server-side default) for the current session.
// Cached in memory for 5 minutes so one token covers a burst of apiFetch
// calls; cleared on logout and on 401.
const AUTH_BASE = (import.meta.env.PUBLIC_BETTER_AUTH_URL ?? "").replace(
  /\/+$/,
  "",
);
const TOKEN_TTL_MS = 5 * 60 * 1000;
let cachedToken: { token: string; at: number } | null = null;

async function getBackendToken(): Promise<string | null> {
  if (cachedToken && Date.now() - cachedToken.at < TOKEN_TTL_MS) {
    return cachedToken.token;
  }
  cachedToken = null;
  if (!AUTH_BASE) return null;
  try {
    const res = await fetch(`${AUTH_BASE}/api/auth/token`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const token =
      typeof data === "object" && data !== null
        ? (data as { token?: unknown }).token
        : null;
    if (typeof token !== "string" || !token) return null;
    cachedToken = { token, at: Date.now() };
    return token;
  } catch {
    return null;
  }
}

/** Drop cached auth material (logout, 401, account delete). */
export function clearAuthCache(): void {
  cachedToken = null;
  mePromise = null;
  accountsPromise = null;
}

export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init.headers ?? {}),
  };
  // The FastAPI backend verifies a BetterAuth JWT (see app/deps.py), not
  // the session cookie — attach it when a session exists. Guests send no
  // header and get the usual 401 envelope below.
  const token = await getBackendToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const body =
    init.body === undefined ? undefined : JSON.stringify(init.body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_ROOT}${API_PREFIX}${path}`, {
      ...init,
      headers: body ? { ...headers, "Content-Type": "application/json" } : headers,
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
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
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

/**
 * Sign out everywhere: drop cached auth material, tell the backend
 * (204 no-op), then clear the BetterAuth session cookie. Either call
 * failing still converges — useSession flips to null once the cookie is
 * gone, and a stale cookie just 401s into the re-login flow.
 */
export async function apiLogout(): Promise<void> {
  clearAuthCache();
  try {
    await apiFetch<void>("/auth/logout", { method: "POST" });
  } catch {
    // Network is irrelevant for logout; the session gate re-opens anyway.
    // Swallow.
  }
  try {
    await authClient.signOut();
  } catch {
    // Session already gone server-side — nothing left to clear.
  }
}

/**
 * Delete the user's PESDac identity (users + profile + chats) AND the
 * BetterAuth sign-in record, then sign out. Order matters:
 *
 * 1. BetterAuth delete first — it needs a fresh session, so a stale
 *    login fails here BEFORE any data is touched.
 * 2. Backend DELETE next — the cached JWT still verifies (signature +
 *    expiry), so this succeeds even though the session row is gone. The
 *    backend upsert can't resurrect the user afterwards: no auth user
 *    remains to mint tokens for.
 * 3. Sign out + clear caches.
 *
 * If step 2 fails after step 1 succeeded, the sign-in record is gone but
 * backend rows may remain — { fallback: true } tells the caller to show
 * the contact-support notice instead of navigating away.
 */
export async function apiDeleteAccount(): Promise<{ fallback: boolean }> {
  const deleted = await authClient.deleteUser();
  if (deleted.error) {
    throw new Error(
      deleted.error.message ?? "Couldn't delete your account. Try again.",
    );
  }
  try {
    await apiFetch<void>("/users/me", { method: "DELETE" });
  } catch {
    clearAuthCache();
    try {
      await authClient.signOut();
    } catch {
      // Session already destroyed by the delete — nothing left.
    }
    return { fallback: true };
  }
  clearAuthCache();
  try {
    await authClient.signOut();
  } catch {
    // Session already destroyed by the delete — nothing left.
  }
  return { fallback: false };
}
