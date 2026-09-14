# ProfileDialog settings — wiring inventory & fit report

Date: 2026-09-11. Source of truth: `frontend/src/components/profile/sections.tsx` (8 sections),
`frontend/src/lib/session.ts` (Profile store), `backend/app/models/profiles.py` +
`backend/app/schemas/profiles.py` (server row + PATCH contract).

Status key: **WIRED** = end-to-end (UI → effect → persistence). **STORED** = persists
locally, no consumer. **PLACEHOLDER** = UI only, intentionally deferred.

## 1. Already wired — touch nothing

| Setting | Path |
|---|---|
| Display name (authed → BetterAuth; guest → local) | `updateDisplayName` / local store |
| Email (read-only when authed) | server row |
| Campus / Semester / Branch (server-first + local rollback) | `saveIdentity` → `PATCH /profiles/me` |
| Google link / unlink, 2FA setup/verify/disable, change + link password | BetterAuth via `auth.ts` |
| Export my data (server export authed, local dump guest) | `GET /users/me/export` / `dumpStore` |
| Delete all chats (server-first, then local) | `DELETE /chats` + `clearAllChats` |
| Delete account (backend-first, idempotent) | `apiDeleteAccount` |
| Shortcuts ×3 (New chat / Cancel / Focus composer) | honored in `Pesdac.tsx:1496-1524` keydown |
| Default answer depth | consumed in send path (`ThreadView.tsx:738`) |

## 2. Wireable now — backend is already ready

The server accepts **every** preference field via `ProfilePatch` (validated enums mirroring
the frontend option lists 1:1 — languages, regions, timezones, goals, difficulties, depths,
verbosities, citations, retentions all match), and `ProfileOut` returns them. `apiUpdateProfile`
already takes `string | string[] | boolean`. So each item below is a small `saveIdentity`-style
change (optimistic local write → PATCH → rollback + toast on failure), no migration, no new
endpoint. Caution: keep server writes behind authenticated status — guests stay memory-only
(zero fetches); the login seed only overwrites identity fields, so device prefs are never
clobbered today.

### Tier A — pure frontend, no backend needed

**Follow-up suggestions** (`profile.followUps`). Fit: excellent.
The toggle is stored but never read — `ThreadView` renders `b.followUps` pills unconditionally
(`ThreadView.tsx:834,1960`). Wiring = one gate (`getProfile().followUps && …`). Zero risk,
instant behavior change, and it composes with any future backend shaping of suggestions
(server can keep sending them; the client decides display).

### Tier B — persist to server now, behavior binds later

These have no consumer yet, so wiring today means cross-device persistence (roaming) via the
existing PATCH contract; the behavior half arrives with its feature. Each is ~10 lines in
`sections.tsx` following `saveIdentity`.

| Setting | Fit | Future compatibility |
|---|---|---|
| Quiz difficulty | Good. Enum validated both ends. | Consumed by the quiz engine when it lands; values (`easy/medium/hard`) are already the shape a generator prompt wants. |
| Proactive quizzes | Good. Boolean, already in `ProfilePatch`. | Quiz engine reads one flag; no schema change later. |
| Explanation verbosity | Good. Enum validated both ends. | Send path includes it in the AI request during the backend/AI phase; footnote already promises this. |
| Source citations | Good. Same shape as verbosity. | Same AI-request binding; `always / on request` maps directly onto a system-prompt rule. |
| Weekly study goal, Exam month | Good. Columns exist (`weekly_goal`, `exam_month`). | Feed a future streak/progress surface and exam countdown; values are display-ready strings. |
| Language, Region, Time zone | Good for persistence; application is a project. | Roaming first. Later: `Intl.DateTimeFormat` + `Intl.NumberFormat` can consume region/timezone in one helper (~small); full UI-language switching needs i18n infra (~large) — persisting now doesn't block or prejudge that. |

### Tier C — persist now, enforcement needs the scheduler

**Chat history retention.** Fit: good-half. The preference syncs through the same PATCH
(validated `forever / 1 year / 30 days / session`), and the backend already has the
`purge_expired_chats` worker keyed off `profiles.retention` — but the worker is unwired
(no scheduler; reported in Phase 5). Wire the preference now; enforcement arrives with
scheduling. Semantic caveat to resolve then: `session`-only retention vs the memory store
(which already dies on reload) — define what "session" deletes before wiring the worker.

## 3. Correctly deferred — do not wire yet

| Setting | Why not now |
|---|---|
| Legal docs (Terms / Privacy / Cookie Notice) | Need real legal content + a publish decision. Badges already say "Publishes at launch" — accurate. |
| Retention enforcement | Needs the nightly scheduler (Phase-5 report). |
| Training-data notice card | Static disclosure, nothing to wire. |
| Email editing (authed) | BetterAuth-owned by design; read-only is correct. |

## 4. Recommended order

1. Follow-up suggestions gate (Tier A — behavior today, minutes).
2. Tier B persistence batch (one pass, same pattern × N — difficulty, proactiveQuiz,
   verbosity, citations, examMonth, weeklyGoal, language, region, timezone).
3. Retention preference sync (Tier C minus enforcement).
4. Everything in §3 rides its own feature (quiz engine, AI send-path, scheduler,
   i18n, legal publish).

## 5. Standing pattern for each wiring (copy-paste contract)

- Optimistic `updateProfile` → `apiUpdateProfile(patch)` → rollback to previous on
  failure + `toUserMessage` toast (the `saveIdentity` shape in `IdentitySection`).
- Validators already mirrored: keep frontend option lists and backend tuples in sync
  when adding values (both sides reject unknown values today).
- Guest path: local-only, no fetch. Authenticated path: server-first.
- Tests: extend the `chat-backing`-style stubbed tests (persist-then-rollback) the way
  Phases 1–5 did — no new harness needed.
