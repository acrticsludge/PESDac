# Plan: settings wiring — 4 parallel streams, conflict-free by construction

Specs: `docs/reasonix/specs/spec-followup-suggestions.md`, `spec-quiz-customization.md`,
`spec-answer-shaping.md`, `spec-study-context.md`, `spec-locale.md` (all FROZEN —
defects become reports, never unilateral edits).
Base: `main` **after Step 0 lands**. Prompts:
`docs/reasonix/prompts/setting-{followups,study-quiz,shaping,locale}-muse-spark.md`.

## Why 4 streams, why these boundaries

The conflict surface is small but real: every stream wants `sections.tsx`, and three
want the thread menu. Deconfliction rules applied:

1. **Exactly one stream touches `ThreadView.tsx`** (S1 — the only per-chat menu
   entry in v1). Quiz/shaping per-chat panels are explicitly v2 (override API +
   resolvers ship now); nothing else loses scope that matters.
2. **Shared-function edits are single-line, disjoint, anchored.** `sections.tsx`
   edits are confined to named rows (see ownership table); no stream reformats,
   reorders, or touches another row.
3. **The `toast` lines are pre-placed by Step 0**, so no two streams insert the
   same line in one function.
4. **All new logic lives in stream-owned NEW files.** Nothing shared is edited
   except the rows in (2).
5. **Nobody touches existing tests.** Each stream adds exactly one new test file
   (the Phase-1–5 lesson: editing shared routers breaks queue alignment).
6. **Nobody touches** `auth.ts`, `chat-sync.ts`, `Pesdac.tsx`, `backend/`,
   `Profile` type, theme, toast bridge/copy, or another stream's owned paths.

## Step 0 (lead = me, synchronous, BEFORE any stream cuts — ~30 min)

Land on `main`, gates green:

- `session.ts`: generic scope-override map + `getScopeOverride` / `setScopeOverride`
  / `clearScopeOverrides` (wired into `resetChatStoreForIdentity`, same pattern as
  `messageStates`, plus the `__resetChatBackingForTesting` hook) + `scopeKey(scope, id)`;
  tests in `frontend/tests/settings-scope.test.ts`.
- `frontend/src/lib/settings-scope.ts` (new): `resolveTiered` (first set wins:
  per-chat override → global profile → built-in; zero fetches) + `savePreference`
  (synchronous optimistic `updateProfile`, debounced 600ms `apiUpdateProfile`,
  rollback to pre-save snapshot + error toast on failure; per-patch-shape timers
  collapse rapid re-saves; `AuthRequiredError` rolls back via the same path while
  the global flow owns the gate UI) + `__flushSettingsDebounceForTesting` + tests
  proving guest-zero-fetch, transition-clearing, first-set-wins, rollback, collapse.
- One `const toast = useToast();` line each in `AssistantSection`, `StudySection`,
  `LanguageSection` (behavior-identical; `useToast` already imported in `sections.tsx`).
- Streams verify Step 0 (grep the three function names); if absent, STOP and report.

Frozen kernel API (signatures streams code against — Step 0 implements exactly this):

```ts
// session.ts
export type ScopeKind = "chat" | "subject";
export function scopeKey(scope: ScopeKind, id: string): string
// => `chat:<code>` | `subject:<code>`
export function getScopeOverride(setting: string, scope: string): string | boolean | number | undefined
export function setScopeOverride(setting: string, scope: string, value: string | boolean | number | undefined): void
// undefined deletes (= inherit). Identity-scoped; cleared on transition.
export function clearScopeOverrides(): void

// settings-scope.ts
export function resolveTiered<T>(setting: string, chatCode: string | null, builtin: T): T
// first set wins: per-chat override → global profile → built-in. Zero fetches.
export function savePreference(
  patch: Partial<Profile>,
  notify: (toast: { body: string; type: "error" }) => void,
  opts: { server: boolean },
): void // memory writes synchronously; server PATCH debounced 600ms.
// Callers pass { server: auth.status === "authenticated" } — guests and
// auth-still-loading pass false (memory-only, zero fetches). The flag is
// required (no default) so a forgotten flag is a check error, never a
// silent guest fetch.
export function __flushSettingsDebounceForTesting(): Promise<void>
```

Frozen setting-name strings: `followUps`, `difficulty`, `proactiveQuiz`, `verbosity`,
`citations`, `examMonth`, `weeklyGoal`, `language`, `region`, `timezone`, `format`,
`optionCount`, `questionCount`.

## Streams (parallel-safe; each cuts its branch from post-Step-0 `main`)

| Stream | Branch | Owns (ONLY) | Must NEVER touch |
|---|---|---|---|
| S1 follow-ups | `feat/setting-followups` | `ThreadView.tsx` Conversation-actions array (append after Copy-transcript item) + pill gate (~834, ~1960); `sections.tsx` follow-ups row `onChange` ONLY; `lib/setting-followups.ts` (new: `resolveFollowUps`); `tests/setting-followups.test.ts` (new) | everything S2–S4 own; existing tests |
| S2 study+quiz | `feat/setting-study-quiz` | `sections.tsx` StudySection ONLY (examMonth/weeklyGoal/difficulty `onChange`s; format-block insert anchored after difficulty row; subject-exam row insert anchored after weekly-goal row); `lib/setting-quiz.ts` + `lib/setting-study.ts` (new); `tests/setting-study-quiz.test.ts` (new) | ThreadView; AssistantSection; LanguageSection; existing tests |
| S3 shaping | `feat/setting-shaping` | `sections.tsx` AssistantSection verbosity + citations `onChange`s ONLY; `lib/setting-shaping.ts` (new: `resolveAnswerStyle`); `tests/setting-shaping.test.ts` (new) | ThreadView; StudySection; LanguageSection; existing tests |
| S4 locale | `feat/setting-locale` | `sections.tsx` LanguageSection 3 `onChange`s ONLY; `lib/format-timestamps.ts` (new: Intl helper, no call-site rewiring); `tests/setting-locale.test.ts` (new) | everything else; existing tests |

Deliberately v2 (noted, not implemented): quiz/shaping per-chat panels + menu entries;
timestamp call-site adoption; quiz engine; i18n catalog; retention enforcement.

## Merge procedure (lead reviewer = me, after all streams report)

1. Review each branch against its prompt + spec (five axes) — user brings them back
   for review + bugfix first.
2. Fix findings on the branch, re-verify that branch's gates.
3. Merge sequentially (`--ff-only` if clean, else merge-commit): S1 → S2 → S3 → S4
   (any order works — disjoint by construction; this order puts render-affecting
   S1 first). Full frontend gates after each merge.
4. Shared-browser spot check: toggle each setting, reload (persisted?), guest
   (zero fetches?), logout/login (roaming for authed, cleared drafts of overrides?).

## If git reports a conflict anyway

Stop. Do not resolve by guessing which side is right — the ownership table says who
owns the hunk. Report the file + hunk; the lead resolves at merge time.
