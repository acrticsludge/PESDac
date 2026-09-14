# docs/reasonix — execution artifacts, not sources of truth (audit §21)

`specs/` and `plans/` are the frozen record of how features were
reasoned about and built (many predate the v5→v6 BetterAuth tear-out).
They are history: read them to understand WHY, never to learn what the
system DOES today.

Canonical sources (update these in the same task that changes
behaviour — PRD → spec → architecture → plan → feature doc → tests →
audits → migrations → operations per the docs lifecycle):

- What exists: `docs/architecture/`, `docs/design/`, `docs/API.md`
- Decisions: `docs/decisions/` (sequential ADRs)
- How to run it: `docs/operations/`, repo `README.md`
- What was checked: `docs/audits/` (append-only, dated)

Status labels (Proposed / In Progress / Implemented / Deprecated /
Superseded) live on canonical docs. Per-file labeling of all 80+
specs/plans is a tracked follow-up, not this note: when a spec is
known-superseded, mark its top line (like the arch §11 BetterAuth
note) instead of rewriting history.
