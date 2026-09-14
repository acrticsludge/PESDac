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

// In-flight PATCH count per patch shape. A failure consults this (via
// `pendingSaves`) to tell "a newer save owns the outcome" from "nothing
// follows me" — an older response must never clobber newer memory.
const inflightSaves = new Map<string, number>();

function pendingKey(patch: Partial<Profile>): string {
  return Object.keys(patch).sort().join(",");
}

/**
 * True while the setting has a queued (debounced, unsent) or in-flight
 * PATCH. Kernel support for per-control pending affordances; no UI reads
 * it yet (see the §8 strikethrough — wiring needs a design pass).
 */
export function isSettingSaving(setting: keyof Profile): boolean {
  const needle = setting as string;
  for (const key of pendingSaves.keys()) {
    if (key.split(",").includes(needle)) return true;
  }
  for (const [key, count] of inflightSaves) {
    if (count > 0 && key.split(",").includes(needle)) return true;
  }
  return false;
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
  // What this send owns: only keys whose memory still shows exactly what
  // we sent are eligible for reconcile/rollback below. A newer optimistic
  // save always wins over this (older) response.
  const sent = pending.latest as Record<string, unknown>;
  const prev = pending.prev as Record<string, unknown>;
  const untouched = (): Record<string, unknown> => {
    const current = getProfile() as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(sent)) {
      if (Object.is(current[k], v)) out[k] = v;
    }
    return out;
  };
  inflightSaves.set(key, (inflightSaves.get(key) ?? 0) + 1);
  try {
    const canonical = (await apiUpdateProfile(
      Object.fromEntries(Object.entries(sent)) as Record<
        string,
        string | string[] | boolean
      >,
    )) as unknown as Record<string, unknown>;
    // Canonical full-profile response: adopt the server values for keys
    // this send owns and the user hasn't touched since. Keys the user
    // re-saved mid-flight keep their newer optimistic values (the newer
    // flush reconciles them when it lands).
    const owned = untouched();
    const adopt: Partial<Profile> = {};
    for (const k of Object.keys(owned)) {
      (adopt as Record<string, unknown>)[k] = canonical?.[k] ?? owned[k];
    }
    if (Object.keys(adopt).length > 0) updateProfile(adopt);
  } catch (error) {
    // Roll back only untouched keys — a newer save owns touched ones.
    // Toast only when no newer server save is queued: a queued flush owns
    // the outcome (and its own toast). A newer guest (memory-only) save
    // queues nothing, so the failure still surfaces.
    const owned = untouched();
    const restore: Partial<Profile> = {};
    for (const k of Object.keys(owned)) {
      if (Object.prototype.hasOwnProperty.call(prev, k)) {
        (restore as Record<string, unknown>)[k] = prev[k];
      }
    }
    if (Object.keys(restore).length > 0) updateProfile(restore);
    if (!pendingSaves.has(key)) {
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
  } finally {
    const left = (inflightSaves.get(key) ?? 1) - 1;
    if (left <= 0) inflightSaves.delete(key);
    else inflightSaves.set(key, left);
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
