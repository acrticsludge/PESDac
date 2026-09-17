# Todo: Section C findings (B19–B23)

## Task 1: Attachment policy — pure + unit-tested (B19)

**Description:** Add `MAX_ATTACHMENT_BYTES` (10 MB), `MAX_ATTACHMENTS` (10), executable denylist, `validateFiles`, `rejectionCopy` to `frontend/src/lib/attachments.ts`; create `frontend/tests/attachments-policy.test.ts` TDD.

**Acceptance criteria:**
- [ ] 10 MB file accepted, 10 MB + 1 byte rejected (`too-large`)
- [ ] 0-byte rejected (`empty`)
- [ ] `.exe`/`.bat`/`.ps1`/etc. rejected (`blocked-type`) by extension + mime
- [ ] Overflow beyond 10 (existing + incoming) rejected (`too-many`), earlier files win
- [ ] Pure: input array untouched; honest names preserved

**Verification:**
- [ ] `npm test` (frontend) green for new file
- [ ] `npx tsc --noEmit` clean

**Dependencies:** None. **Files:** `src/lib/attachments.ts`, `tests/attachments-policy.test.ts`. **Scope:** S.

## Task 2: Wire policy into both drawers with copy (B19 UX)

**Description:** `stageIntoDrawer` in `ThreadView.tsx` + `Pesdac.tsx` validates, stages accepted, toasts aggregated rejection copy once via `notify`/`notifyChat`.

**Acceptance criteria:**
- [ ] Accepted files still stage (drawer count grows)
- [ ] Rejected files never stage; exactly one toast per action listing reasons
- [ ] All-accepted action → no toast

**Verification:**
- [ ] Unit green; manual e2e probe (I9a-style) shows toast + empty drawer
- [ ] `tsc` clean

**Dependencies:** Task 1. **Files:** `ThreadView.tsx`, `Pesdac.tsx`. **Scope:** S.

## Task 3: Attachment-only blocked WITH copy (B21)

**Description:** Vendor trim-gate makes "allow" a vendor fight — instead add a lowest-priority composer status hint (`ThreadView.tsx`, `Pesdac.tsx`) while files are staged and text is empty.

**Acceptance criteria:**
- [ ] Empty text + staged files → no post, drawer keeps files, hint visible
- [ ] Hint yields to every real error/status (lowest priority)
- [ ] Zero posts unchanged for empty + no files

**Verification:**
- [ ] I11-style e2e passes; `tsc` clean

**Dependencies:** Tasks 1–2. **Files:** `ThreadView.tsx`, `Pesdac.tsx`. **Scope:** M.

## Task 4: Dropzone around both composers (B20)

**Description:** Additive drop wrapper (`onDragOver` preventDefault + `onDrop` → `stageIntoDrawer`) around thread + welcome `ChatComposer`; paste/picker unchanged.

**Acceptance criteria:**
- [ ] OS-style drop of a valid file stages it (drawer count grows)
- [ ] Drop of rejected file → rejection toast, drawer unchanged
- [ ] No layout/visual change (wrapper is unstyled)

**Verification:**
- [ ] I10-style e2e passes; `tsc` clean

**Dependencies:** Task 2. **Files:** `ThreadView.tsx`, `Pesdac.tsx`. **Scope:** S.

## Task 5: E2E pin updates to new contract

**Description:** Rewrite I9a/I9b/I9c/I14 (reject + copy), keep I16 trio (stages), I11 (posts), I10 (drop stages); update header D17/D18/D19.

**Acceptance criteria:**
- [ ] Each updated test asserts the new contract (reject copy visible OR drawer counts)
- [ ] Untouched pins (I1–I8, I9d–f, I12–13, I15, I17–20) unmodified and green

**Verification:**
- [ ] `playwright test e2e/section-c.spec.ts` green single-worker

**Dependencies:** Tasks 1–4. **Files:** `e2e/section-c.spec.ts`. **Scope:** M.

## Task 6: Docs + full verify

**Description:** Audit follow-up note (B19/B21/B20 fixed, B22/B23 deferred with rationale); run typecheck + unit + section-c e2e.

**Acceptance criteria:**
- [ ] All spec success criteria checked
- [ ] Diff ≤ 5 app files

**Verification:**
- [ ] `tsc`, `npm test`, section-c e2e all green

**Dependencies:** Task 5. **Files:** audit note, `tasks/*`. **Scope:** XS.
