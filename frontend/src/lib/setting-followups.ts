// Follow-up suggestions resolver (settings S1).
//
// Precedence is `per-chat override > global default` (spec §2): suggestion
// display is a thread-situation concern, so there is no per-subject tier.
// Reads ride the Step-0 kernel (`resolveTiered`); writes below are
// memory-only by kernel construction (guests cost zero fetches, and every
// identity transition wipes the map).

import { DEFAULT_PROFILE } from "./session.ts";
import { resolveTiered } from "./settings-scope.ts";

/** Kernel setting name for the per-chat override map. */
export const FOLLOW_UPS_SETTING = "followUps";

/**
 * Show suggestion pills for this chat? The per-chat override wins when
 * set; otherwise the global profile default applies.
 */
export function resolveFollowUps(chatCode: string | null): boolean {
  return resolveTiered<boolean>(
    FOLLOW_UPS_SETTING,
    chatCode,
    DEFAULT_PROFILE.followUps,
  );
}

/**
 * Next state for the thread menu's single three-state item:
 * unset → Off → On → Use default (delete). Pure so the menu stays a
 * thin caller and the cycle is unit-testable.
 */
export function nextFollowUpsOverride(
  current: boolean | undefined,
): boolean | undefined {
  if (current === undefined) return false;
  if (current === false) return true;
  return undefined;
}
