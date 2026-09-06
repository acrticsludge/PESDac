// Auth facade for the React app. Single entry point that the rest of
// the app uses — components and the API adapter both go through
// here, so the Neon Auth shape stays contained.
//
// Three concerns, one file:
//   1. `useAuth()` — the React hook components consume. Wraps the
//      SDK's useSession() and normalizes its shape.
//   2. `apiFetch(path, init)` — every backend call goes through here.
//      It injects `Authorization: Bearer <jwt>` from the current
//      Neon session, throws `AuthRequiredError` on 401 so the gate
//      and onboarding can react, and exposes the server's typed
//      error envelope on other non-2xx responses.
//   3. `apiLogout()` / `apiDeleteAccount()` — convenience helpers
//      used by the Account section (logout) and the Danger zone
//      (delete account). They go to Neon first (so the cookie is
//      cleared), then to our backend (so our users + profile + chats
//      rows are deleted), in that order.
//
// Cookie is on Neon's origin and is NOT sent to our API. The JWT
// inside getSession().session.token is the only thing the browser
// shares with us. All auth-class network calls belong in this file.

import { useEffect, useState } from "react";
import {
  authClient,
  getAccessToken as readAccessToken,
  apiLogout as sdkLogout,
  deleteNeonUser,
} from "./neon-auth";

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

// ---- useAuth ---------------------------------------------------------------

/**
 * Returns the current auth state. The Neon SDK already exposes
 * `useSession()` from the React adapter; we wrap it so consumers
 * never have to import neon-auth and we get a single tri-state
 * (loading / guest / authenticated) for the gate + onboarding.
 */
export function useAuth(): AuthState {
  // The React adapter wires useSession() into the singleton client.
  const session = authClient.useSession();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  if (!hydrated || session.isPending) {
    return { status: "loading" };
  }
  const data = session.data as
    | { user?: { id?: string; email?: string; name?: string }; session?: { token?: string } }
    | null
    | undefined;
  if (!data?.user) return { status: "guest" };
  return {
    status: "authenticated",
    user: {
      id: data.user.id ?? "",
      email: data.user.email ?? "",
      displayName: data.user.name ?? "",
      // The Neon session doesn't carry our onboarding flag; the gate
      // and onboarding dialog read it from /auth/me. The slice that
      // needs the flag calls apiGetMe() to refresh this state.
      onboardingDone: false,
    },
  };
}

/**
 * Read /auth/me and return the parsed user. Used by the gate (to
 * learn `onboardingDone`) and the profile dialog (to learn real
 * email/displayName). The Neon session only carries the JWT + name;
 * everything else comes from our backend.
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

export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const token = await readAccessToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init.headers ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const body =
    init.body === undefined ? undefined : JSON.stringify(init.body);

  const res = await fetch(`${API_ROOT}${API_PREFIX}${path}`, {
    ...init,
    headers: body ? { ...headers, "Content-Type": "application/json" } : headers,
    body,
  });

  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  const parsed: unknown = text ? safeJson(text) : null;
  if (!res.ok) {
    const body = isErrorBody(parsed) ? parsed : null;
    if (res.status === 401) throw new AuthRequiredError(body);
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
 * Sign out of Neon (clears the cookie server-side) and notify our
 * backend (so any in-memory session state could be discarded later).
 * The 204 from /auth/logout is best-effort — if the network is down
 * the cookie is still cleared by the SDK.
 */
export async function apiLogout(): Promise<void> {
  try {
    await apiFetch<void>("/auth/logout", { method: "POST" });
  } catch {
    // Network is irrelevant for logout; the Neon cookie is what
    // actually gates access. Swallow.
  }
  await sdkLogout();
}

/**
 * Delete the user's PESDac identity (users + profile + chats) and
 * then ask Neon to delete the underlying user. Falls back to a
 * signOut + a flag if the SDK does not expose deleteUser (per
 * spec §I F4). The caller is expected to navigate to /signup next
 * so the gate re-opens.
 */
export async function apiDeleteAccount(): Promise<{ fallback: boolean }> {
  await apiFetch<void>("/users/me", { method: "DELETE" });
  const ok = await deleteNeonUser();
  if (ok) return { fallback: false };
  // SDK does not expose deleteUser — at least clear the cookie so
  // the visitor is logged out and the gate re-opens.
  await sdkLogout();
  return { fallback: true };
}
