# Spec: Section C findings (B19–B23) — honest attachments + composer

## ASSUMPTIONS I'M MAKING

1. Mockup stage, no backend uploads yet — validation is client-side staging policy; server will re-validate on real uploads.
2. Existing Section C suite (26 tests, green) pins unlimited staging as *actual*; hostile pins (I9a/I9b/I9c/I14/I16-partial, I11, I10-drop-half) will be updated to the new policy — this is an intended contract change, not a regression.
3. `notify` toast bridge is the rejection-copy channel (one toast per staging action, deduped by existing toast policy); no new UI components (AGENTS.md: Astryx mandatory, smallest change).
4. B22 (abuse guard) and B23 (linkify) are backend-phase / product decisions — document-only in this run, zero app-code change, existing pins (I12a/I12b echo, I17 no-anchors) stay green.
5. "Typesafe" = strict TypeScript: no `any`, discriminated rejection unions, pure validation function unit-tested via `node --test`.

→ Correct any of these now or I proceed with them.

## Decision update (2026-09-17, product call)

**No upload caps at mockup stage.** The B19 validation policy was
implemented, unit-tested, and e2e-verified, then fully reverted on
this call — staging accepts everything; limits arrive with real
backend uploads. This spec's B19 sections are superseded; B20/B21
stand as implemented. Recover the policy from git history if needed.

## Objective

Resolve the Section C audit (`docs/audits/2026-09-15-section-c-findings-audit.md`) app bugs with the smallest honest changes:

- **B19 (release-blocker):** staging accepts everything (50 MB, `.exe`, 20-at-once, 0-byte). Enforce a client staging policy with honest rejection copy.
- **B21 (polish):** attachment-only send is a silent no-op. Blocked WITH
  copy (vendor `ChatComposer` trim-gates empty submits in `handleSubmit`
  AND `canSend` before our `onSubmit` ever fires — "allow" would need a
  custom sendButton + Enter interception, i.e. fighting the Astryx
  component; deferred). Copy = composer status hint (lowest priority)
  while files are staged and text is empty, in thread + welcome.
- **B20 (polish):** OS file DROP onto the composer is silently ignored (vendor `ChatComposerInput` wires `onPaste` only). Add a thin own dropzone around both composers; keep paste + picker paths unchanged.
- **B22/B23:** document as decided-deferred (backend guard / keep-plain), no code.

Success = hostile inputs are either accepted with a working path or rejected with copy; nothing fails silently; Section C suite green on the new contract.

## Tech Stack

- Astro + React 19 + Astryx 0.5.2 + StyleX (`frontend/`)
- Existing libs: `frontend/src/lib/attachments.ts`, `frontend/src/components/chat/ThreadView.tsx`, `frontend/src/components/Pesdac.tsx`, `frontend/src/components/chat/AttachButton.tsx`
- Tests: `node --test` unit (`frontend/tests/*.test.ts`) + Playwright e2e (`frontend/e2e/section-c.spec.ts`)

## Commands

```powershell
# Unit (focused then full)
npx.cmd tsc --noEmit
npm test -- --coverage   # from frontend/
# E2E (single file, single worker — multi-stream tests are timeout-sensitive per T26/O6)
npx.cmd playwright test e2e/section-c.spec.ts --reporter=line
```

Build: `npm run build` (from `frontend/`). Dev: `npm run dev`.

## Project Structure

```text
frontend/src/lib/attachments.ts        → staging policy (pure, unit-tested)
frontend/src/components/chat/ThreadView.tsx → thread composer (send gate, dropzone, drawer)
frontend/src/components/Pesdac.tsx     → welcome composer (send gate, dropzone, drawer)
frontend/src/components/chat/AttachButton.tsx → picker (unchanged in v1, no accept filter)
frontend/tests/attachments-policy.test.ts → new unit tests (RED first)
frontend/e2e/section-c.spec.ts         → updated pins (I9a/I9b/I9c/I14/I11/I10/I16)
tasks/spec-section-c.md                → this file
tasks/plan.md                          → vertical slices
tasks/todo.md                          → task checklist
```

## Code Style

Typesafe, minimal, additive. Example of the intended shape:

```typescript
// attachments.ts — pure policy, no DOM, no side effects except ID gen
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB per file
export const MAX_ATTACHMENTS = 10; // per drawer/message

export type AttachmentRejectionReason =
  | "too-large"
  | "empty"
  | "too-many"
  | "blocked-type";

export type AttachmentRejection = {
  fileName: string;
  reason: AttachmentRejectionReason;
};

export function validateFiles(
  files: readonly File[],
  existingCount: number,
): { accepted: File[]; rejected: AttachmentRejection[] } { /* pure */ }

export function rejectionCopy(r: AttachmentRejection): string { /* one line per reason */ }
```

Conventions: named constants (no magic numbers), `readonly` inputs, discriminated unions, no `any`, early returns, existing `stageFiles`/`revokeStaged` signatures preserved.

## Testing Strategy

- **TDD (Prove-It):** unit test for `validateFiles` written first (RED: import fails), then implementation (GREEN), then refactor.
- **Unit** (`frontend/tests/attachments-policy.test.ts`): per-file cap boundary (10 MB in / 10 MB+1 out), 0-byte reject, `.exe` denylist, count cap overflow, honest names preserved, pure (input untouched).
- **E2E** (update existing pins, no new files): I9a → 50 MB rejected with copy + drawer empty; I9b → `.exe` rejected with copy; I9c → 20 files → 10 stage + copy; I14 → 0-byte rejected with copy; I16 trio (1/5/10 MB) still stages (boundary proof); I11 → attachment-only now posts (1 user article, attachments visible, stream settles); I10 → drop stages (dropzone), paste unchanged.
- **Untouched pins stay green:** I1/I2 (empty gates), I9d (re-pick), I9e (token/thumbnail), I9f (remove-then-send), I12a/b (echo), I13 (SVG inert), I15 (hostile names), I17 (no linkify), I18/I19/I20.
- Framework: Playwright, one router per test, counters asserted after, `expectCleanEnv(errors, true)`.

## Boundaries

- Always: run `tsc --noEmit` + focused unit + section-c e2e before declaring done; keep Astryx components (`ChatComposer`, `Token`, `Thumbnail`, `Button`); preserve existing component hierarchy/layout; smallest diff.
- Ask first: changing `MAX_*` numbers after this spec; adding an `accept` filter to the picker; touching `responder.ts` (B22) or linkify (B23); any backend contract change.
- Never: redesign the composer/drawer UI; replace Astryx with custom HTML/CSS; add Tailwind/global CSS; edit `PESDacMockupTheme.ts`; edit `node_modules/@astryxdesign`; commit secrets or seed cookies; delete a pin without replacing it with the new-contract assertion.

## Success Criteria

- [ ] `validateFiles` unit suite green (boundary + denylist + count + empty + purity).
- [ ] `tsc --noEmit` clean.
- [ ] Section C e2e green on the new contract (I9a/b/c, I14 reject with copy; I16 trio stages; I11 attachment-only posts; I10 drop stages).
- [ ] No silent path remains: every rejection surfaces one toast/status copy; attachment-only either posts or (never) silently drops.
- [ ] B22/B23 documented in spec header + audit follow-up note; zero code change to `responder.ts` / markdown pipeline.
- [ ] Diff touches ≤ 5 files of app code (+ tests/spec).

## Open Questions

1. Are 10 MB/file + 10 files/message + executable-denylist the right v1 numbers (backend will set real upload limits later)?
2. Should the picker gain an `accept` hint in v1, or stay open with code-side validation only (chosen: code-side only, to avoid breaking honest `.bin` flows)?
3. B22/B23 deferred to backend phase — confirmed?
