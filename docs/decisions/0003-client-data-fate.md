# ADR 0003: Per-key fate of client-side data on backend contact

## Status
Accepted (2026-09-14).

## Date
2026-09-14

## Context
The backend-readiness audit (§1.3–§1.4) left two decisions open: anonymous device id vs real auth for scoping, and export-or-drop per localStorage key (with only drafts and votes pre-cleared as safe to drop). Auth is now resolved (ADR 0002: BetterAuth user id is the sole scope). The key inventory in `frontend/src/lib/session.ts`:
- `pesdac-custom-chats-v1` (custom chat containers, `:52`), `pesdac-overlays-v1` (message overlays, `:53`), `pesdac-demo-overrides-v1` (demo overrides, `:291`), `pesdac-pins-v1` (`:329`), `pesdac-archived-v1` (`:330`), skeleton last-known counts `pesdac:lastKnown*` (`:336-339`), feedback/votes `pesdac-feedback-v1` (`:469`), drafts `pesdac-drafts-v1` (`:491`), profile `pesdac-profile-v1` (`:509`).
- Infrastructure keys: `pesdac:logout-ping` (`lib/cache-revalidation.ts:32`), `pesdac:outbox-flush-lease` (`lib/outbox.ts:62`).
- Durable outbox in IndexedDB (`lib/outbox-db.ts:1-26`): pending-ops only (one replayable write per row: chat-create or message-append with `clientKey`), delete-on-ack, hard cap with oldest-first eviction, no tokens/session/profile material, strict shape validation on load. Chat bodies are persisted there by exception — a retry after reload is impossible without the body.

## Decision
On first authenticated backend contact, per key:
- **Migrate** (server is the new source of truth, local copy becomes cache): customs → `POST /chats`; overlays → the messages append path (server-side extension point per arch §8); pins/archive → `PATCH /chats/{code}`; demo overrides → `PUT /demo-state/{label}`; profile → `PATCH /profiles/me`.
- **Drop** (never migrated, safe by construction): drafts (`DRAFTS_KEY` — arch D6: drafts never leave the tab's memory, reaffirmed); feedback/votes (local-only until the messages-phase vote endpoint lands, then keyed by `messages.id`); skeleton last-known counts (recomputable from `GET /chats`); `logout-ping` and `outbox-flush-lease` (ephemeral coordination, not data).
- The IndexedDB outbox stays a **client-only transport**, never a data mirror: drain-then-delete on ack; replay re-mints auth at send time through `apiFetch`. Its body-persistence exception stands, with the documented mitigations (ops-only, delete-on-ack, cap + eviction, load validation, never rendered).
- Conflicts resolve server-wins with local rollback + toast (the `saveIdentity` pattern); no silent overwrite in either direction.

## Alternatives Considered

### Anonymous device id with lazy migration on first contact
- Pros: zero-friction guest history.
- Cons: identity-linking attacks on merge, orphan accounting across devices, and a second scoping model every ownership check must understand.
- Rejected: ADR 0002 gives one scope (BetterAuth user id); guests stay memory-only, zero fetches.

### Migrate everything, including drafts and votes
- Pros: nothing ever lost.
- Cons: drafts are keystroke-adjacent ephemeral state (per-keystroke server sync is cost without value); votes have no server key yet (their key migrates to `messages.id` with the messages phase).
- Rejected: migrate what has a server home today; drop the rest explicitly.

## Consequences
- The sync/outbox implementation (§10 of the non-LLM audit) inherits this table as its contract: which keys get adapters, which get deletion, which stay local forever.
- `localStorage` still needs versioning, quota guards, and the corrupt-JSON one-time warning (gap-audit §4b.4/§4b.5) — this ADR decides fate, not robustness.
- Any new client key added later must land in one of the three buckets (migrate / drop / transport) with a line in this ADR's inventory, or it defaults to drop.
