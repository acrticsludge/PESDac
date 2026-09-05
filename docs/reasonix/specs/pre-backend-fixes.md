# Pre-backend fixes — @-tokens, quiz copy, corrupt signal, dead controls, bundle

Implements backend-readiness audit §2 (minus timestamps: no change, backend
sends real dates) and §3. Markdown sanitization (§2.1) verified safe — no
code change (see §1).

## 1. Markdown safety verdict (verified, no change)

Astryx 0.5.2 `Markdown` (`node_modules/@astryxdesign/core/src/Markdown/`):

- Custom parser → closed AST (`InlineNode` has no `html` node:
  text/bold/italic/strikethrough/code/link/image/citation/break only).
  Raw `<script>` / `<img onerror>` in markdown source degrades to text or
  autolink — never an element.
- No `dangerouslySetInnerHTML` in the Markdown path; AST renders React
  components.
- URL hardening at two layers: parser `isSafeUrl` rejects `javascript:` /
  `vbscript:` / `data:text/html` (control-char stripping first), renderer
  `sanitizeUrl` re-checks before `href`/`src` (covered by
  `Markdown.test.tsx` XSS cases).
- User bubbles render Astryx `Text` (React text nodes — inherently safe).

Residual rule (carries to backend): never interpolate raw user text into a
markdown string server-side; @-tokens stay structured (§3 of this spec).

## 2. Quiz copy (responder.ts)

`planResponse` "quiz me" answer ends "Reply with your answers and I will
check them step by step." Interactive checking is backend-gated; the mock
overpromises. New closing: "Reply with your answers, then pick **Show me
the answers** below to compare step by step." — points at the existing
"Show me the answers" follow-up instead of promising live grading.

## 3. @-tokens render in user bubbles

Live sends store plain `text` bubbles (`@textbook explain X`), so the
token is invisible in the sent message while demo threads show badges via
`mention` bubbles. Fix at render, not storage (raw text stays the source
of truth for retry/regenerate/find):

- New `renderUserText(text, key)` in `ThreadView.tsx`: `parseReferenceIds`
  → keep ids present in `REFERENCE_ITEMS` (case-insensitive; unknown
  `@words` stay plain text, no fabricated labels) → tokens
  `{ value: "@id", label, variant: "blue" }` (same shape as `cn.ts:27`)
  through `ChatTokenizedText` ("token patterns replaced by inline Badge
  components"); no known tokens → plain `Text` as today.
- Applies to the `text` case of `renderBubble` (user + assistant; assistant
  text never contains tokens so behavior is unchanged there).

## 4. Corrupt-overlay signal (session.ts)

`readJSON` catch currently swallows with silent fallback. New behavior:

- `console.error("[pesdac] corrupt storage key, using fallback", key)`.
- Record key in a module `corruptKeys` set + `emit()` (subscribers
  re-render into the notice state; same pattern as `writeJSON` quota path).
- `listCorruptKeys()` + `useCorruptKeys()` (mirrors `useStorageHealth`:
  `useSessionVersion` + mount gate, SSR-safe empty).
- Surface alongside the existing storage warning: `ChatComposer status`
  in `ThreadView.tsx` (`!storageOk` branch) and the welcome composer in
  `Pesdac.tsx:1193` gain a corrupt-keys message ("Saved data looked
  damaged, so this chat started fresh — history may be incomplete.").
  Send-error keeps priority over both.

## 5. Bundle chunk config (astro.config.mjs)

`vite.build.chunkSizeWarningLimit` raised with a comment citing the
Astryx+React single-island baseline; actual size recorded from the
verification build below. No code splitting yet (route-split is backend-
phase work once islands diverge).

- Verification build chunk (2026-09-06): `AppLayout.<hash>.js` = 630 kB
  (Astryx + React + app, single island); `client.<hash>.js` = 178 kB.

## 6. Dead controls — restored, do not touch (user direction 2026-09-06)

These were cut, then restored on the user's instruction not to remove any
items unprompted. They stay exactly as they are until the user says
otherwise — several are silent no-ops, tracked here, not fixed:

- Sidebar "Study Library" item (`Pesdac.tsx`).
- Sidebar Account footer: "Settings" + "My Profile" (`href="#"`).
- Welcome composer "Settings" `DropdownMenu` (all three items are
  `onClick: () => {}`).
- Study-note Share button (no handler — share links stay backend-gated).

Kept throughout (functional despite `href="#"` + `preventDefault`):
conversation items, New chat, Search conversations (all real `onClick`
navigation); `SideNavHeading headingHref` (branding, not a control).
Read-aloud: no matches in `src` — absent, nothing to do.
