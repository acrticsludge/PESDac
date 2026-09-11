// Study-context resolvers (settings S2).
//
// `examMonth` is per-subject override > global default > "" — a subject
// without its own date inherits the global one. `weeklyGoal` is global-only
// by design (days-per-week is a property of the person, not the subject),
// so it has no override tiers and this module performs no scope-map lookup
// for it. Both resolvers are pure and fetch-free; future countdown/streak
// surfaces read these, never raw profile fields.

import { getProfile, getScopeOverride, scopeKey } from "./session.ts";

/** Frozen setting name for the exam-month global + per-subject overrides. */
export const EXAM_MONTH_SETTING = "examMonth";

/**
 * Resolve the exam month for one subject (or the global default when no
 * subject is given). Non-string override values never occur through the UI
 * (TextInput only) but are treated as unset, never surfaced.
 */
export function resolveExamMonth(subject?: string | null): string {
  if (subject != null) {
    const scoped = getScopeOverride(
      EXAM_MONTH_SETTING,
      scopeKey("subject", subject),
    );
    if (typeof scoped === "string") return scoped;
  }
  return getProfile().examMonth;
}

/** The person-level weekly goal. Global only — no override tiers. */
export function resolveWeeklyGoal(): string {
  return getProfile().weeklyGoal;
}
