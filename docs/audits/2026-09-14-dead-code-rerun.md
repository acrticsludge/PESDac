# Dead-code re-run — 2026-09-14 (audit §21 item 3)

Re-run of `2026-09-04-dead-code-audit.md` (same method: reference count,
not judgment).

## 09-04 findings: all seven removals stayed removed

Post-removal grep for `WelcomeScreen`, `CNChat`, `data/index`, removed
icon names, `status={chat.status}`: zero hits. Current `LayoutFooter`
matches are live renders (dialog/sidebar footers), not dead imports.

## Hygiene sweep (this run)

- `TODO`/`FIXME`: 2 hits, both stale-completed → resolved (email
  read-only note → plain comment; `auth_user_id` BetterAuth note →
  removed, migration is done). Tree now has zero TODOs.
- `debugger` / `console.log(` in `src`, `backend/app`,
  `backend/scripts`, `lib`: zero hits (`console.error`/`console.warn`
  are intentional: fanout guard, corrupt-signal, unhandled-rejection,
  middleware unknown-session — each covered by policy/tests).
- Cross-user placeholder TODO in `test_chats_contract.py` (restore the
  oracle "once sessions land") → replaced with a pointer: sessions
  have landed, the oracle lives in `test_cross_user_isolation.py`.
- This program's new files all have live importers/consumers
  (`toast-policy`, `settings-scope` additions, `orphans`,
  `check_secrets`, `check-bundle`, e2e specs, `serve.py` referenced by
  README + runbooks). Removed during the program: `test_read_burst.py`
  (sqlite can't thread), `e2e/probe.spec.ts` (debug scaffold).
- Dependencies: no new RUNTIME deps anywhere in §§7–21 (backend zero;
  frontend additions are all `devDependencies`, verified in §16).

## Naming

Lowercase kebab-case files, dated audits, sequential ADRs — conforms.
`docs/reasonix/README.md` (new) declares specs/plans as artifacts.
