// Foreground-gated revalidation (caching Phase 4, spec §5 Fix 4).
//
// Within one identity nothing ever revalidates: other-device edits never
// arrive and bfcache restores logged-out paint. This module adds
// listeners only — no fetch logic lives here:
//
// - `pageshow` re-proves the session before rows paint (fail closed to
//   loading on ambiguity, never a cached paint);
// - foreground refetch (60 s coalesce floor) refreshes hydrate + open
//   thread, skipped entirely while logged out/guest;
// - a logout-only `storage` ping drops sibling-tab caches immediately.
//
// Every leg reuses the existing paths (`hydrateChats`/`loadChatMessages`
// via `revalidateForeground`, the Phase-1 reset, the global
// AUTH_REQUIRED flow). No intervals, no polling, no focus-refetch loops,
// no new background work.

import { useEffect, useRef } from "react";
import {
  resetChatStoreForIdentity,
  revalidateForeground,
  type ChatAuth,
  type ChatNotify,
} from "./session.ts";

/**
 * Single logout-ping key, written ONLY on logout transitions
 * (`apiLogout`). Receivers run the Phase-1 reset — never navigation.
 * Colon form (not the `pesdac-` prefix) so the pre-migration purge in
 * `session.ts` never sweeps it on page load.
 */
export const LOGOUT_PING_KEY = "pesdac:logout-ping";

/**
 * Foreground refetch coalesce floor (spec §10.3 locked decision): rapid
 * tab-toggling can't storm the API. No age bookkeeping beyond this — a
 * hidden tab is unobservable by definition.
 */
export const FOREGROUND_REFETCH_FLOOR_MS = 60_000;

/** Pure: is a foreground refetch due under the coalesce floor? */
export function shouldForegroundRefetch(
  lastRefetchAtMs: number,
  nowMs: number,
  floorMs: number = FOREGROUND_REFETCH_FLOOR_MS,
): boolean {
  return nowMs - lastRefetchAtMs >= floorMs;
}

export type ForegroundTickContext = {
  auth: ChatAuth;
  nowMs: number;
  lastRefetchAtMs: number;
};

/**
 * Pure foreground decision: guests/logged-out never refetch (zero
 * fetches); authenticated identities refetch only past the floor.
 * Returns the (possibly advanced) floor timestamp alongside the verdict
 * so callers thread one value through.
 */
export function handleForegroundTick(ctx: ForegroundTickContext): {
  refetch: boolean;
  lastRefetchAtMs: number;
} {
  if (ctx.auth == null) {
    return { refetch: false, lastRefetchAtMs: ctx.lastRefetchAtMs };
  }
  if (!shouldForegroundRefetch(ctx.lastRefetchAtMs, ctx.nowMs)) {
    return { refetch: false, lastRefetchAtMs: ctx.lastRefetchAtMs };
  }
  return { refetch: true, lastRefetchAtMs: ctx.nowMs };
}

/**
 * Pure pageshow decision: only a bfcache restore (`persisted=true`) with
 * a known identity reproves. Initial loads ride the normal hydrate path;
 * guests hold memory truth with zero fetches.
 */
export function shouldReproveOnPageshow(
  persisted: boolean,
  auth: ChatAuth,
): auth is NonNullable<ChatAuth> {
  return persisted && auth != null;
}

/** Pure: is this storage event our logout ping (anything else is noise)? */
export function isLogoutPingEvent(key: string | null): boolean {
  return key === LOGOUT_PING_KEY;
}

/**
 * Write the logout ping. Called ONLY from `apiLogout` — never from
 * hydrate/refetch/receiver paths. Best-effort under denied storage.
 */
export function broadcastLogoutPing(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOGOUT_PING_KEY, String(Date.now()));
  } catch {
    // Storage denied (private mode) — sibling sync is best-effort; this
    // tab's own logout already cleared its heap via clearAuthCache().
  }
}

/**
 * Subscribe to sibling-tab logout pings. The callback runs the Phase-1
 * reset (no navigation — `storage` fires only in tabs that did NOT
 * initiate the logout, and routing there would yank the user's context).
 * Returns the unsubscriber; callers clean up on unmount.
 */
export function installLogoutPingReceiver(onLogoutPing: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (!isLogoutPingEvent(e.key)) return;
    onLogoutPing();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

export type CacheRevalidationProps = {
  chatAuth: ChatAuth;
  /** Custom-chat code of the open thread (if any); membership-guarded downstream. */
  openCode: string | null;
  notify?: ChatNotify;
  /**
   * Sibling-tab logout handler. Required (no default) so the call site
   * decides the cache depth explicitly: the app passes clearAuthCache
   * (spec §7 invalidation matrix — sibling ping equals the logout row
   * minus navigation: token, identity caches, and epoch die with the rows).
   * A bare chat-store reset would leave the sibling's JWT, profile seed,
   * and epoch alive. No navigation ever runs from the ping.
   */
  onSiblingLogout: () => void;
  /** Test seam: clock for the coalesce floor. */
  now?: () => number;
};

/**
 * Foreground/pageshow listeners for the persisted shell. All decisions
 * delegate to the pure helpers above; all fetching delegates to
 * `revalidateForeground`. Live session ownership stays in `useAuth` —
 * this hook only triggers re-proof (hydrate's first fetch 401s on a dead
 * session, and the existing global AUTH_REQUIRED flow owns re-login).
 */
export function useCacheRevalidation(props: CacheRevalidationProps): void {
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });
  const lastRefetchAtRef = useRef(0);
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    const clock = () => propsRef.current.now?.() ?? Date.now();
    const doForegroundRefetch = () => {
      const { chatAuth, openCode, notify } = propsRef.current;
      const tick = handleForegroundTick({
        auth: chatAuth,
        nowMs: clock(),
        lastRefetchAtMs: lastRefetchAtRef.current,
      });
      lastRefetchAtRef.current = tick.lastRefetchAtMs;
      if (tick.refetch && chatAuth != null) {
        void revalidateForeground(chatAuth, { openCode, notify });
      }
    };
    const onPageshow = (e: PageTransitionEvent) => {
      const { chatAuth, openCode, notify } = propsRef.current;
      if (!shouldReproveOnPageshow(e.persisted, chatAuth)) return;
      // Fail closed: invalidate rows BEFORE the reproof so no cached paint
      // survives the restore window. Drafts survive (same-identity return,
      // not a transition — no server leg can restore typed-but-unsent
      // input). The reproof below either repaints rows (live session) or
      // 401s into the global re-login flow (dead session stays loading —
      // the wipe above already dropped the marker).
      resetChatStoreForIdentity({ preserveDrafts: true });
      lastRefetchAtRef.current = clock();
      void revalidateForeground(chatAuth, { openCode, notify });
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      doForegroundRefetch();
    };
    const cleanupPing = installLogoutPingReceiver(() => {
      // Sibling-tab logout: the call-site handler owns the depth (the app
      // passes clearAuthCache — full logout row minus navigation). Never
      // navigate here: `storage` fires only in tabs that did NOT initiate
      // the logout, and routing there would yank the user's context.
      propsRef.current.onSiblingLogout();
    });
    window.addEventListener("pageshow", onPageshow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pageshow", onPageshow);
      document.removeEventListener("visibilitychange", onVisibility);
      cleanupPing();
    };
  }, []);
}
