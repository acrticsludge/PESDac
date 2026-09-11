// Settings-scope kernel (settings Step 0).
//
// The two primitives every settings stream builds on:
// - `resolveTiered`: read a setting through per-chat override → global →
//   built-in, first set wins, zero fetches. (Per-subject tiers compose on
//   `getScopeOverride` directly in the owning stream's resolver.)
// - `savePreference`: write-through global persist — instant local memory
//   write, debounced server PATCH, rollback + error toast on failure.
//   Guests pass `{ server: false }` and cost zero fetches.
//
// Shape mirrors the IdentitySection `saveIdentity` write-through (server
// first, revert + toast on failure) generalized to any profile patch.

import { apiUpdateProfile, toUserMessage } from "./auth.ts";
import {
  getProfile,
  getScopeOverride,
  scopeKey,
  updateProfile,
  type Profile,
} from "./session.ts";

/** First set wins: per-chat override → global profile → built-in. */
export function resolveTiered<T>(
  setting: string,
  chatCode: string | null,
  builtin: T,
): T {
  if (chatCode != null) {
    const scoped = getScopeOverride(setting, scopeKey("chat", chatCode));
    if (scoped !== undefined) return scoped as T;
  }
  const global = (getProfile() as Record<string, unknown>)[setting];
  if (global !== undefined) return global as T;
  return builtin;
}

/** Error-toast shape (Astryx `toast({ body, type })` — error path only). */
export type SettingsNotify = (toast: { body: string; type: "error" }) => void;

/** Pass `{ server: false }` for guests (and while auth is still loading):
 *  memory-only, zero fetches. `{ server: true }` debounces a PATCH. */
export type SavePreferenceOpts = { server: boolean };

const SAVE_DEBOUNCE_MS = 600;

type PendingSave = {
  latest: Partial<Profile>;
  prev: Partial<Profile>;
  notify: SettingsNotify;
  timer: ReturnType<typeof setTimeout>;
};
// One trailing timer per patch shape (sorted key list): rapid re-saves of
// the same control collapse to a single PATCH carrying the latest value,
// while unrelated controls flush independently.
const pendingSaves = new Map<string, PendingSave>();

function pendingKey(patch: Partial<Profile>): string {
  return Object.keys(patch).sort().join(",");
}

function pick(profile: Profile, patch: Partial<Profile>): Partial<Profile> {
  const out: Partial<Profile> = {};
  for (const key of Object.keys(patch) as Array<keyof Profile>) {
    (out as Record<string, unknown>)[key] = profile[key];
  }
  return out;
}

async function flushSave(key: string): Promise<void> {
  const pending = pendingSaves.get(key);
  if (!pending) return;
  pendingSaves.delete(key);
  try {
    await apiUpdateProfile(
      Object.fromEntries(Object.entries(pending.latest)) as Record<
        string,
        string | string[] | boolean
      >,
    );
  } catch (error) {
    // The optimistic memory write was wrong: restore the pre-save values
    // so local and server can never silently diverge, then name it.
    updateProfile(pending.prev);
    // `notify` is caller-owned UI (a Toast in the dialog) — never throws
    // into the store.
    try {
      pending.notify({
        body: toUserMessage(error, "Couldn't save. Try again."),
        type: "error",
      });
    } catch {
      // A throwing toast must not wedge future saves.
    }
  }
}

/**
 * Write-through global preference save. Memory updates synchronously
 * (instant UI); the server PATCH is debounced 600ms and collapses rapid
 * re-saves. On failure memory rolls back and `notify` fires once.
 */
export function savePreference(
  patch: Partial<Profile>,
  notify: SettingsNotify,
  opts: SavePreferenceOpts,
): void {
  if (Object.keys(patch).length === 0) return;
  const key = pendingKey(patch);
  // Snapshot pre-write values for rollback BEFORE the optimistic write.
  const snapshot = pick(getProfile(), patch);
  updateProfile(patch);
  if (!opts.server) return;
  const existing = pendingSaves.get(key);
  if (existing) clearTimeout(existing.timer);
  // Overlapping keys keep the oldest (pre-first-patch) prev so a failure
  // restores the true pre-optimism state, not a mid-flight value.
  const prev = { ...snapshot, ...existing?.prev };
  const entry: PendingSave = {
    latest: { ...existing?.latest, ...patch },
    prev,
    notify,
    timer: setTimeout(() => void flushSave(key), SAVE_DEBOUNCE_MS),
  };
  pendingSaves.set(key, entry);
}

/** Test hook: flush every pending PATCH immediately and await settlement. */
export async function __flushSettingsDebounceForTesting(): Promise<void> {
  const keys = [...pendingSaves.keys()];
  for (const key of keys) {
    const pending = pendingSaves.get(key);
    if (pending) clearTimeout(pending.timer);
    await flushSave(key);
  }
}
