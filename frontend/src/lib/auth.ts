// Auth facade for the React app. Single entry point that the rest of
// the app uses — components and the API adapter both go through here.
//
// TODO(BetterAuth): wire this facade to BetterAuth (session hook +
// token forwarding). Neon Auth was removed; Neon is now database-only.
// The login/signup shell is kept; Google sign-in will be re-added
// separately.

import { useEffect, useState } from "react";
import { useSession } from "better-auth/react";
import { authClient } from "./auth-client";

const API_BASE_URL = import.meta.env.PUBLIC_API_BASE_URL;
if (!API_BASE_URL) {
  throw new Error(
    "PUBLIC_API_BASE_URL is not set. Add it to frontend/.env (see .env.example).",
  );
}

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

export type AuthState =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "authenticated"; user: AuthUser };

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

// ---- useAuth ---------------------------------------------------------------

/**
 * Current auth state.
 *
 * TODO(BetterAuth): replace this stub with the BetterAuth session hook.
 * Until then the app is unauthenticated: loading during SSR/hydration,
 * guest afterwards.
 */
export function useAuth(): AuthState {
  const { data: session, isPending } = useSession();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  if (!hydrated || isPending) {
    return { status: "loading" };
  }

  if (session?.user) {
    return {
      status: "authenticated",
      user: {
        id: session.user.id,
        email: session.user.email,
        displayName: session.user.name || session.user.displayName || session.user.email.split("@")[0],
        onboardingDone: (session.user as Record<string, unknown>)?.onboardingDone === true,
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

export async function forgetPassword(email: string) {
  return authClient.forgetPassword({ email, redirectTo: "/login" });
}

/**
 * Read /auth/me and return the parsed user. Used by the gate (to
 * learn `onboardingDone`) and the profile dialog (to learn real
 * email/displayName).
 */
export async function apiGetMe(): Promise<AuthUser> {
  const res = await apiFetch<{ user: AuthUser }>("/auth/me");
  return res.user;
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

export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init.headers ?? {}),
  };
  // TODO(BetterAuth): attach `Authorization: Bearer <token>` from the
  // BetterAuth session here.
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
      // Backend rejected the session. Notify the shell so it can
      // route to re-login — the gate alone can't see this state.
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
 * Sign out (backend + local state).
 * TODO(BetterAuth): also sign out of the BetterAuth session here.
 */
export async function apiLogout(): Promise<void> {
  try {
    await apiFetch<void>("/auth/logout", { method: "POST" });
  } catch {
    // Network is irrelevant for logout; the session gate re-opens anyway.
    // Swallow.
  }
}

/**
 * Delete the user's PESDac identity (users + profile + chats).
 * The caller is expected to navigate to /signup next so the gate
 * re-opens.
 *
 * TODO(BetterAuth): also delete the BetterAuth user when wired.
 */
export async function apiDeleteAccount(
  _password?: string,
): Promise<{ fallback: boolean }> {
  await apiFetch<void>("/users/me", { method: "DELETE" });
  return { fallback: false };
}
