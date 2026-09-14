// LLM BYOK client + status hook (spec llm-byok-settings §4–§5).
//
// One shared source for every gate (sidebar dot, onboarding prefill,
// composer banners). Mirrors the auth.ts discipline: identity-scoped
// TaggedCache fetch, version listeners for save/delete refresh, guest
// sessions never fetch. The raw key is never held here beyond the
// save-call argument — only the status shape lives in the cache.

import { useEffect, useState } from "react";
import {
  ApiError,
  apiFetch,
  useAuth,
} from "./auth.ts";
import {
  isStaleTagged,
  sharedTaggedFetch,
  type TaggedCache,
} from "./auth-cache.ts";

export type LlmStatus = {
  configured: boolean;
  provider: string | null;
  keyHint: string | null;
  model: string | null;
  validatedAt: string | null;
};

export type LlmState = "unknown" | "ready" | "unconfigured" | "invalid" | "degraded";

export const LLM_DEFAULT_MODEL = "openai/gpt-4o-mini";
export const OPENROUTER_KEYS_URL = "https://openrouter.ai/workspaces/default/keys";

/** Masked display for a stored key (`••••abcd`). Pure, tested. */
export function maskKeyHint(hint: string | null): string {
  if (!hint) return "••••";
  return `••••${hint}`;
}

/**
 * Pure state derivation (tested): fetch failures degrade open (gates
 * pass — the backend is source of truth once completions land);
 * `rejected` marks a key the provider just refused while nothing
 * working is stored.
 */
export function deriveLlmState(args: {
  status: LlmStatus | null;
  fetchFailed: boolean;
  rejected: boolean;
}): LlmState {
  if (args.fetchFailed) return "degraded";
  if (args.status == null) return "unknown";
  if (args.status.configured) return "ready";
  if (args.rejected) return "invalid";
  return "unconfigured";
}

// ---- module cache (same shape as auth.ts profile cache) ----

let currentLlmCache: TaggedCache<LlmStatus> | null = null;
let llmVersion = 0;
const llmListeners = new Set<() => void>();
// Set when a save attempt is refused with LLM_KEY_INVALID while no
// working key is stored — drives the "was rejected" banner copy.
// Cleared by any successful save/delete or a configured status read.
let llmRejected = false;

function bumpLlmVersion(): void {
  llmVersion += 1;
  llmListeners.forEach((notify) => {
    try {
      notify();
    } catch {
      // A stale listener must not break the refresh for the rest.
    }
  });
}

export function __getLlmVersionForTesting(): number {
  return llmVersion;
}

/** Re-read status everywhere (save, delete, dialog open). */
export function refreshLlmStatus(): void {
  currentLlmCache = null;
  bumpLlmVersion();
}

/** Reset module state (tests + identity teardown). */
export function __resetLlmForTesting(): void {
  currentLlmCache = null;
  llmRejected = false;
  bumpLlmVersion();
}

export async function apiLlmStatus(currentUserId: string): Promise<LlmStatus> {
  if (currentLlmCache && currentLlmCache.userId === currentUserId) {
    return currentLlmCache.promise;
  }
  const { result } = sharedTaggedFetch(
    currentLlmCache,
    () => apiFetch<LlmStatus>("/llm/status"),
    currentUserId,
    (entry) => {
      currentLlmCache = entry;
    },
    (entry) => currentLlmCache === entry,
  );
  return result.then((status) => {
    if (isStaleTagged(currentLlmCache, currentUserId)) {
      throw new Error("identity-changed");
    }
    if (status.configured) llmRejected = false;
    return status;
  });
}

export async function apiLlmSave(
  apiKey: string,
  model: string,
): Promise<LlmStatus> {
  try {
    const status = await apiFetch<LlmStatus>("/llm/key", {
      method: "PUT",
      body: { provider: "openrouter", apiKey, model },
    });
    llmRejected = false;
    currentLlmCache = null;
    bumpLlmVersion();
    return status;
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.body?.code === "LLM_KEY_INVALID"
    ) {
      llmRejected = true;
      bumpLlmVersion();
    }
    throw error;
  }
}

export async function apiLlmDelete(): Promise<void> {
  await apiFetch<undefined>("/llm/key", { method: "DELETE" });
  llmRejected = false;
  currentLlmCache = null;
  bumpLlmVersion();
}

/**
 * Every gate reads this. Guests and loading sessions never fetch:
 * guests resolve `unconfigured` (callers combine with auth.status for
 * the login CTA), loading resolves `unknown` (gates pass open).
 */
export function useLlmStatus(): { state: LlmState; status: LlmStatus | null } {
  const auth = useAuth();
  const [state, setState] = useState<{
    state: LlmState;
    status: LlmStatus | null;
  }>({ state: "unknown", status: null });
  const [version, setVersion] = useState(llmVersion);

  useEffect(() => {
    const notify = () => setVersion(llmVersion);
    llmListeners.add(notify);
    return () => {
      llmListeners.delete(notify);
    };
  }, []);

  useEffect(() => {
    if (auth.status === "loading") {
      setState({ state: "unknown", status: null });
      return;
    }
    if (auth.status === "guest") {
      setState({ state: "unconfigured", status: null });
      return;
    }
    let cancelled = false;
    const userId = auth.user.id;
    setState({ state: "unknown", status: null });
    apiLlmStatus(userId).then(
      (status) => {
        if (cancelled) return;
        setState({ state: deriveLlmState({ status, fetchFailed: false, rejected: llmRejected }), status });
      },
      () => {
        if (cancelled) return;
        // Fail open: an unreachable status endpoint must not block
        // sends — gates pass, the backend decides when completions land.
        setState({ state: "degraded", status: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [auth.status, auth.status === "authenticated" ? auth.user.id : null, version]);

  return state;
}
