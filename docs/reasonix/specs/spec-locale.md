# SPEC: Locale — language + region + time zone, persisted globals

Status: **proposed, not implemented.** No code touched.
Rule: UI uses existing Astryx components only; no dialog redesign (`AGENTS.md` holds).
Footnote today: "Stored, not applied." This spec splits that into two shippable halves:
**persist now** (roaming), **apply in layers** (cheap formatting first, full i18n later).

## 1. Goal

Language (18 options), region (18), and time zone (22) currently persist per-device and
affect nothing. Make them roam with the account now; bind them to rendering
incrementally, cheapest layer first.

## 2. Scope model

Global only — deliberately no per-chat/per-subject tiers. Locale is a property of the
person reading the screen, not of the thread or subject. (A future per-chat "explain
in Hindi" is a *request* attribute for the AI phase, not a locale override — it must
not reuse these fields.)

## 3. UI (Astryx only, existing patterns)

- ProfileDialog → Language & region rows unchanged (`Selector`s with search) — they
  start persisting via `PATCH /profiles/me` (columns + validators already mirror the
  frontend lists 1:1, verified).
- No per-chat or per-subject surface. No new components.

## 4. Data model

- Existing columns (`language`, `region`, `timezone`) — persist now, nothing else.
- No override storage, no migration, no new contract.

## 5. Application layers (in order — each shippable alone)

1. **Timestamps (small):** format every rendered timestamp with
   `Intl.DateTimeFormat` keyed off region + time zone ("Used for scheduling and every
   timestamp you see" — the row copy already promises this). Pure helper,
   unit-testable, zero backend.
2. **Numbers/currency (small):** `Intl.NumberFormat` off region, wherever counts
   render (message counts, quotas, streaks later).
3. **UI language (large, separate project):** full i18n infra (string catalog,
   `lang` attribute, RTL readiness for Arabic). Persisting the preference now
   doesn't block or prejudge it — the value will be waiting.

## 6. Behavior rules

- Unknown/unsupported values fail closed to built-ins (`en-US`, `IN`, `IST`) — never
  a crash, never a blank (mirror the `isCampus` read-guard pattern in `getProfile`).
- Guests: memory-only. Changing locale never refetches chats.

## 7. Acceptance criteria

- Locale triple survives logout/login (PATCH round-trip test).
- Layer 1: fixed timestamp renders differently under `IN/IST` vs `US/ET`
  (pure-helper test with explicit `timeZone` — deterministic, no clock dependence).
- UI copy language unchanged (layer 3 explicitly not started).

## 8. Out of scope

i18n string catalog, RTL layout, per-chat explanation language (AI-phase request
attribute), currency conversion (formatting only).
