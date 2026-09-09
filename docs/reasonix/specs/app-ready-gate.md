# Spec: app readiness gate — no dead clicks while user data loads

Status: Proposed
Stack: Astro + React 19 + Astryx 0.5.2 (frontend-only; no backend, no new deps).

Context: the app shell renders fully interactive while the session is still
resolving. `useAuth()` can sit at `loading` (unknown-tag windows, slow
session check), `useProfile()` at `loading`, and the server→local profile
seed in flight (`getProfileSeedPending()`), yet the sidebar, the `/new`
welcome composer, and open threads all accept input. Clicks in that window
are dead or worse: they act on a half-known identity (wrong greetings,
guest customs created seconds before an adopt-hydrate, navigations that the
post-login re-seed then visibly rewrites). Chat persistence (stream C)
added a second axis: `hydrateChats()` per identity (`getChatHydratedKey()`),
plus per-chat turn loads (`getChatMessagesStatus()`). The two axes resolve
independently — user data may lag chat data and vice versa.

This spec freezes the readiness model for one implementation stream (see
`docs/reasonix/plans/app-ready-gate-plan.md`). No renegotiation mid-stream;
defects become reports, never unilateral redesigns.

## 1. Goals

1. While user data is loading, the page is visibly loading AND
   non-interactive: no dead clicks on the `/new` welcome composer, the
   chat list, sidebar nav, or open threads.
2. Chat rows skeleton independently of user readiness: user-not-ready +
   chat-ready still shows chat skeletons (never a live list painted over
   an unproven identity). User-ready + chat-loading shows only the chat
   skeleton; everything else is live.
3. The `/new` welcome composer renders a skeleton loading state (fixed
   height, no reflow) until user data is ready — it cannot accept input
   before then.
4. Astryx-only surfaces. No custom overlay divs, no global CSS, no theme
   edits, no new dependencies. Guest fast path stays fast (gate lifts the
   moment the guest proof lands).

## 2. Non-goals

- No change to what loads or in what order (session check, `/auth/me`,
  profile seed, chat hydrate all keep today's triggers and timing).
- No change to AuthGate/OnboardingDialog behavior (required-purpose flows
  keep owning their windows; the gate already blocks guests when open).
- No offline/empty/error-state redesign: error settles the gate (fail
  open, §3.3) and existing error UI owns recovery.
- No AlertDialog/fullscreen-dialog repositioning (they expose no Astryx
  position prop). No toast changes (already top-left).
- No demo-thread content changes; demos are gated by the same matrix
  (§4) but their static content is untouched.

## 3. Readiness model (frozen)

### 3.1 Signals (existing, reused as-is)

- `authStatus`: `useAuth()` → `"loading" | "guest" | "authenticated"`.
- `profileStatus`: `useProfile()` → `"loading" | "guest" | "ready" | "error"`.
- `seedPending`: `getProfileSeedPending()` (reactive via
  `useSessionVersion()`).
- `chatKey`: `getChatHydratedKey()` vs the current
  `identitySeedKey(userId, epoch)` (null when not authenticated).

### 3.2 `userReady` predicate (pure, unit-tested)

```ts
userReady = authStatus !== "loading"
  && profileStatus !== "loading"
  && !seedPending;
```

- Guests: `useProfile()` resolves `guest` without fetching, seed never
  pends → ready the moment the guest proof lands (instant-guest path
  unaffected; typically one frame).
- Authenticated: ready only after `/auth/me` settles AND the profile seed
  lands. Slow networks gate longer — that is the point.
- `profileStatus === "error"` counts as settled (fail open): the gate
  must never lock the user out permanently; the existing profile-error
  UI owns recovery. Rationale: pending means "answer not yet known"
  (block); error means "answer known-bad" (release + recover).

### 3.3 `chatReady` predicate (pure, unit-tested)

```ts
chatReady = auth == null || chatKey === identityKey;
```

Guests have no server chats (`hydrateChats(null)` is a no-op) → always
ready. Authenticated → ready only for the current identity key; stale
keys (post-logout, pre-hydrate) are not ready. Per-open-chat turn state
(`getChatMessagesStatus()`) is unchanged and composes underneath: the
chat skeleton shows while `!chatReady` OR the open chat's own load is
`loading` with an empty overlay.

### 3.4 Reactivity (no new subscription mechanism)

All four signals already emit through existing channels (`useAuth` /
`useProfile` state, `useSessionVersion()` for seed + hydrate key). The
gate reads them during render next to the existing `listCustomChats()`
reads in `Pesdac.tsx`; no new context, bus, or effect chain.

## 4. Per-surface matrix (frozen)

`U` = `userReady`, `C` = `chatReady`. "Skeleton" = Astryx `Skeleton`
rows/blocks at fixed sizes (no reflow on swap). "Disabled" = the
primitive's native disabled prop where one exists (`ChatComposer.
isDisabled`, `SideNavItem.isDisabled`, menu/button disabled props);
where a primitive exposes none, the existing click handler early-returns
(the control renders identically, clicks are provably inert — verified
by code inspection, not new tests).

| Surface | `!U` (either `C`) | `U && !C` | `U && C` |
|---|---|---|---|
| Sidebar custom/pinned/archived rows | skeleton rows | skeleton rows | live (today) |
| Sidebar demo rows | disabled (no nav) | live | live |
| Sidebar nav (New chat, Search, Settings, My Profile) | disabled | live | live |
| Account row | existing loading skeleton (unchanged) | live | live |
| `/new` welcome composer | skeleton block (composer height) + subject toggles, suggestion cards, reference/attach/mode menus disabled | live | live |
| Thread message list | skeleton (existing history-skeleton branch) | existing history-load behavior (unchanged) | live |
| Thread composer + its menus | `isDisabled` | live | live |

Notes:

- Chat rows skeleton on `!U` even when `C` is true (the user's explicit
  rule): a live list over an unproven identity invites exactly the
  adopt/hydrate rewrites this gate exists to hide.
- `U && !C` changes nothing except the chat rows (the user's "just keep
  chat one" rule): every other surface behaves exactly as today.
- Fullscreen dialogs (study note, PDF), AlertDialogs, Lightbox, and
  toasts are out of scope (§2).
- Composer drafts are preserved across the gate: disabling never clears
  `welcomeText` / per-thread drafts; the skeleton swap is paint-only.

## 5. Astryx mapping

| Situation | Implementation |
|---|---|
| Chat rows loading | `Skeleton` rows in the existing `SideNavSection` rhythm (fixed widths, `aria-busy`) |
| Welcome composer loading | `Skeleton` block at composer height in place of `ChatComposer` |
| Thread loading | existing skeleton branch (reuse, extend condition) |
| Non-interactive control | native `isDisabled` / `isDisabled`-equivalent prop |
| Primitive without disabled prop | early-return click guard (no visual change) |

## 6. Acceptance (whole feature)

- [ ] `!U`: every surface in the matrix is skeleton or disabled; scripted
      click-through (New chat, chat row, composer send, search, settings)
      produces zero state changes and zero fetches beyond the in-flight
      loads.
- [ ] `!U && C`: chat rows still skeleton (regression test at predicate
      level + code inspection at component level).
- [ ] `U && !C`: only chat rows skeleton; composer send, nav, and demo
      rows work exactly as today.
- [ ] No reflow: skeleton→live swaps hold layout (fixed heights/widths).
- [ ] Drafts survive the gate in both directions.
- [ ] Guest cold load: gate lifts within the instant-guest frame (no
      perceptible block); authed slow-3G load: gate holds until seed.
- [ ] Frontend tests green (existing unmodified + new predicate/state
      tests); `astro check` + `build` + `git diff --check` clean.
