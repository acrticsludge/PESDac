// Optimistic durable outbox facade (Phase 5 T5c + T5d).
//
// Flow: `enqueueAppend()` persists a pending op (IndexedDB via
// outbox-db.ts, memory fallback) and kicks a paced flush. The flush
// replays ops FIFO per chat — chat-create ops drain before their chat's
// appends — deletes each op on ack, and reports into the in-memory
// queue (outbox-queue.ts) so the UI's existing pending/sent/failed
// states stay the single source of truth.
//
// Retry taxonomy: failures classify through `classifyOutboxError`
// (the `auth.ts` policy: 429/5xx + offline/timeout/mint-outage retry,
// 4xx-refusals and 401s do not). `apiFetch` already performs the one
// bounded chat-write 429 retry honoring `Retry-After` (capped at 5s);
// when a 429 still surfaces, the flush backs the whole round off for
// `RATE_BACKOFF_MS` (same 5s cap) instead of hammering the limiter.
// Attempts per op are bounded (`MAX_ATTEMPTS`) — an op that keeps
// failing becomes `failed-fatal` (visible, user-retryable, never
// silently dropped).
//
// Flush triggers: `online` / `focus` / `visibilitychange` / 30s
// interval, registered once via `startOutboxSchedulers()` (SSR-safe
// no-op without `window`).
//
// Cross-tab single-flusher (T5d): `navigator.locks` when available,
// else a `localStorage` lease (timestamp + TTL — payloads never touch
// localStorage, only the lease). No locks API and no storage (private
// mode / node) → run inline: correctness holds because every replay
// carries its idempotency key and the server dedupes into a 200.
//
// Cap + eviction (T5d): `MAX_OPS` pending ops; beyond that the oldest
// op is evicted (dropped with a visible `evicted` count — bounded disk
// use beats unbounded growth). Acked ops never count.

import { useEffect, useState } from "react";

import { apiAppendMessage, apiCreateChat } from "./chat-sync.ts";
import { isValidOutboxOp, outboxStore, type OutboxOp } from "./outbox-db.ts";
import {
  classifyOutboxError,
  newClientKey,
  outboxQueue,
} from "./outbox-queue.ts";

/** Re-exported so components import the whole outbox surface from one module. */
export { newClientKey, outboxQueue };

/** Hard cap on pending ops (eviction is oldest-first, globally). */
export const MAX_OUTBOX_OPS = 200;

/** Attempts per op before it settles `failed-fatal` (visible, kept). */
export const MAX_OUTBOX_ATTEMPTS = 5;

/** Whole-round backoff after a surfaced 429 (same 5s cap as apiFetch). */
export const OUTBOX_RATE_BACKOFF_MS = 5000;

/** Scheduler interval between opportunistic flushes. */
export const OUTBOX_FLUSH_INTERVAL_MS = 30000;

/** localStorage lease key (timestamp only — never payloads). */
export const OUTBOX_FLUSH_LEASE_KEY = "pesdac:outbox-flush-lease";

/** Lease TTL: a crashed tab's lease expires instead of wedging flush. */
export const OUTBOX_LEASE_TTL_MS = 15000;

/** BroadcastChannel name for flush announcements (best-effort). */
export const OUTBOX_FLUSH_CHANNEL = "pesdac-outbox-flush";

/** Send surface, injectable in tests (defaults hit `chat-sync.ts`). */
export type OutboxSenders = {
  appendMessage: (
    chatCode: string,
    body: { role: "user" | "assistant" | "system"; content: unknown },
    clientKey: string,
  ) => Promise<unknown>;
  createChat: (
    subject: string,
    title: string,
    clientKey: string,
  ) => Promise<{ code: string }>;
};

const defaultSenders: OutboxSenders = {
  appendMessage: (chatCode, body, clientKey) =>
    apiAppendMessage(chatCode, body, { clientMsgKey: clientKey }),
  createChat: (subject, title, clientKey) =>
    apiCreateChat(subject, title, {
      clientAdoptKey: clientKey,
    }).then((chat) => ({ code: chat.code })),
};

/** Visible sync snapshot (the "N unsynced" indicator reads this). */
export type OutboxSnapshot = {
  total: number;
  pending: number;
  failedRetryable: number;
  failedFatal: number;
  evicted: number;
};

const EMPTY_SNAPSHOT: OutboxSnapshot = {
  total: 0,
  pending: 0,
  failedRetryable: 0,
  failedFatal: 0,
  evicted: 0,
};

let evictedCount = 0;
let snapshot: OutboxSnapshot = { ...EMPTY_SNAPSHOT };
const snapshotListeners = new Set<() => void>();

function setSnapshot(next: OutboxSnapshot): void {
  snapshot = next;
  snapshotListeners.forEach((notify) => {
    try {
      notify();
    } catch {
      // A stale listener must not break the rest.
    }
  });
}

/** Current sync snapshot (render-direct read, reactive via the hook). */
export function getOutboxSnapshot(): OutboxSnapshot {
  return { ...snapshot };
}

function subscribeOutboxSnapshot(listener: () => void): () => void {
  snapshotListeners.add(listener);
  return () => {
    snapshotListeners.delete(listener);
  };
}

/** Reactive sync snapshot for the "N unsynced" indicator. */
export function useOutboxUnsynced(): OutboxSnapshot {
  const [current, setCurrent] = useState<OutboxSnapshot>(() =>
    getOutboxSnapshot(),
  );
  useEffect(() => subscribeOutboxSnapshot(() => setCurrent(getOutboxSnapshot())), []);
  return current;
}

async function refreshSnapshot(): Promise<void> {
  const ops = await outboxStore.list();
  let pending = 0;
  let failedRetryable = 0;
  let failedFatal = 0;
  for (const op of ops) {
    const record = outboxQueue.get(op.id);
    const status = record?.status ?? "pending";
    if (status === "failed-fatal") failedFatal += 1;
    else if (status === "failed-retryable") failedRetryable += 1;
    else pending += 1;
  }
  setSnapshot({
    total: ops.length,
    pending,
    failedRetryable,
    failedFatal,
    evicted: evictedCount,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readLease(): number {
  try {
    if (typeof localStorage === "undefined") return 0;
    return Number(localStorage.getItem(OUTBOX_FLUSH_LEASE_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function writeLease(now: number): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    localStorage.setItem(OUTBOX_FLUSH_LEASE_KEY, String(now));
    return true;
  } catch {
    return true;
  }
}

/**
 * Single-flusher lease. `navigator.locks` (exclusive) when available;
 * otherwise a timestamp lease — stale after the TTL so a crashed tab
 * cannot wedge flushing. Resolves true when this tab may flush.
 */
async function acquireFlushLease(): Promise<boolean> {
  if (
    typeof navigator !== "undefined" &&
    "locks" in navigator &&
    navigator.locks != null
  ) {
    try {
      const held = await navigator.locks.query();
      if ((held.held ?? []).some((l) => l.name === OUTBOX_FLUSH_CHANNEL)) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  }
  const now = Date.now();
  if (now - readLease() < OUTBOX_LEASE_TTL_MS) return false;
  return writeLease(now);
}

let flushInFlight = false;
let flushQueued = false;
let schedulersStarted = false;

/** FIFO per chat with creates before their chat's appends. */
export function orderOutboxOps(ops: OutboxOp[]): OutboxOp[] {
  return [...ops].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    if (a.kind !== b.kind) return a.kind === "create-chat" ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

async function sendOp(op: OutboxOp, senders: OutboxSenders): Promise<void> {
  if (op.kind === "create-chat") {
    const payload = op.payload as { subject?: unknown; title?: unknown };
    if (typeof payload.subject !== "string" || typeof payload.title !== "string") {
      throw new Error("Invalid create-chat op payload.");
    }
    await senders.createChat(payload.subject, payload.title, op.clientKey);
    return;
  }
  const payload = op.payload as { role?: unknown; content?: unknown };
  if (
    payload.role !== "user" &&
    payload.role !== "assistant" &&
    payload.role !== "system"
  ) {
    throw new Error("Invalid append-message op payload.");
  }
  await senders.appendMessage(
    op.chatCode,
    { role: payload.role, content: payload.content },
    op.clientKey,
  );
}

/**
 * Drain pending ops once (single-flusher guarded). Deletes on ack,
 * keeps retryable failures for the next trigger, marks exhausted ops
 * failed-fatal. Aborts the round on 401 (the global re-login owns it).
 */
export async function flushOutbox(
  senders: OutboxSenders = defaultSenders,
): Promise<{ sent: number; kept: number }> {
  if (flushInFlight) {
    flushQueued = true;
    return { sent: 0, kept: 0 };
  }
  flushInFlight = true;
  try {
    if (!(await acquireFlushLease())) {
      return { sent: 0, kept: (await outboxStore.list()).length };
    }
    announceFlush();
    let sent = 0;
    for (;;) {
      const ops = orderOutboxOps(await outboxStore.list());
      if (ops.length === 0) break;
      let progressed = false;
      for (const op of ops) {
        const record = outboxQueue.get(op.id);
        // Already settled fatal this session: visible, user-retryable,
        // never auto-retried by the worker.
        if (record?.status === "failed-fatal") continue;
        try {
          await sendOp(op, senders);
          await outboxStore.remove(op.id);
          outboxQueue.markSent(op.id);
          sent += 1;
          progressed = true;
        } catch (error) {
          const failure = classifyOutboxError(error);
          const attempts = op.attempts + 1;
          if (isAuthFailure(error)) {
            // Session dead — stop the round, keep everything queued.
            await refreshSnapshot();
            return { sent, kept: (await outboxStore.list()).length };
          }
          if (failure === "failed-fatal" || attempts > MAX_OUTBOX_ATTEMPTS) {
            // Authoritative refusal or exhausted: visible, kept for an
            // explicit user retry (never silently dropped). Forced fatal —
            // `markFailed` would re-classify an exhausted 500 as
            // retryable and the worker would retry forever.
            outboxQueue.track(op.id);
            outboxQueue.markFatal(op.id, error);
            await outboxStore.put({ ...op, attempts });
          } else {
            outboxQueue.track(op.id);
            outboxQueue.markFailed(op.id, error);
            await outboxStore.put({ ...op, attempts });
            if (isRateLimited(error)) {
              // Honor the limiter before the next op (apiFetch already
              // spent its one bounded Retry-After retry inside the send).
              await sleep(OUTBOX_RATE_BACKOFF_MS);
            }
          }
          progressed = true;
        }
      }
      if (!progressed) break;
      // Re-list: a trigger may have enqueued mid-round; loop until empty.
      if (flushQueued) {
        flushQueued = false;
        continue;
      }
      break;
    }
    await refreshSnapshot();
    return { sent, kept: (await outboxStore.list()).length };
  } finally {
    flushInFlight = false;
  }
}

function isAuthFailure(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const record = error as { name?: unknown; status?: unknown };
    if (record.name === "AuthRequiredError") return true;
    if (record.status === 401) return true;
  }
  return false;
}

function isRateLimited(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const status = (error as { status?: unknown }).status;
    if (status === 429) return true;
  }
  return false;
}

function announceFlush(): void {
  try {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(OUTBOX_FLUSH_CHANNEL);
    channel.postMessage({ type: "flush", at: Date.now() });
    channel.close();
  } catch {
    // Best-effort announcement; the lease is the real guard.
  }
}

/** Fire-and-forget flush kick (scheduler + enqueue paths). */
export function requestOutboxFlush(): void {
  void flushOutbox().catch(() => {
    // Flush failures are recorded per-op + in the snapshot; the kick
    // itself never rejects to callers (event handlers, intervals).
  });
}

async function enforceCap(): Promise<void> {
  for (;;) {
    const ops = await outboxStore.list();
    if (ops.length <= MAX_OUTBOX_OPS) return;
    const oldest = orderOutboxOps(ops)[0];
    await outboxStore.remove(oldest.id);
    outboxQueue.forget(oldest.id);
    evictedCount += 1;
  }
}

/** Queue a message append for paced, durable, idempotent replay. */
export async function enqueueAppend(
  chatCode: string,
  message: { role: "user" | "assistant" | "system"; content: unknown },
  opts?: { clientKey?: string; kick?: boolean },
): Promise<OutboxOp> {
  const op: OutboxOp = {
    id: opts?.clientKey ?? newClientKey(),
    chatCode,
    kind: "append-message",
    clientKey: opts?.clientKey ?? "",
    payload: { role: message.role, content: message.content },
    createdAt: Date.now(),
    attempts: 0,
  };
  if (!op.clientKey) op.clientKey = op.id;
  if (!isValidOutboxOp(op)) throw new Error("Invalid append op.");
  outboxQueue.track(op.id);
  await outboxStore.put(op);
  await enforceCap();
  await refreshSnapshot();
  if (opts?.kick !== false) requestOutboxFlush();
  return op;
}

/** Queue a chat create (drains before its chat's appends). */
export async function enqueueCreate(
  subject: string,
  title: string,
  opts?: { clientKey?: string; chatCode?: string; kick?: boolean },
): Promise<OutboxOp> {
  const key = opts?.clientKey ?? newClientKey();
  const op: OutboxOp = {
    id: key,
    chatCode: opts?.chatCode ?? key,
    kind: "create-chat",
    clientKey: key,
    payload: { subject, title },
    createdAt: Date.now(),
    attempts: 0,
  };
  if (!isValidOutboxOp(op)) throw new Error("Invalid create op.");
  outboxQueue.track(op.id);
  await outboxStore.put(op);
  await enforceCap();
  await refreshSnapshot();
  if (opts?.kick !== false) requestOutboxFlush();
  return op;
}

/** Drop one op explicitly (user-discarded draft). */
export async function discardOp(id: string): Promise<void> {
  await outboxStore.remove(id);
  outboxQueue.forget(id);
  await refreshSnapshot();
}

/**
 * Register `online` / `focus` / `visibilitychange` / interval flush
 * triggers. Idempotent; SSR-safe no-op without `window`.
 */
export function startOutboxSchedulers(): () => void {
  if (typeof window === "undefined") return () => {};
  if (schedulersStarted) return () => {};
  schedulersStarted = true;
  const kick = () => requestOutboxFlush();
  window.addEventListener("online", kick);
  window.addEventListener("focus", kick);
  document.addEventListener("visibilitychange", kick);
  const timer = window.setInterval(kick, OUTBOX_FLUSH_INTERVAL_MS);
  // Opening state may already be backlogged (reload recovery): flush once.
  void refreshSnapshot().then(kick);
  return () => {
    window.removeEventListener("online", kick);
    window.removeEventListener("focus", kick);
    document.removeEventListener("visibilitychange", kick);
    window.clearInterval(timer);
    schedulersStarted = false;
  };
}

/** Test seam: reset snapshot + eviction counters (store/queue reset separately). */
export function __resetOutboxForTesting(): void {
  evictedCount = 0;
  flushInFlight = false;
  flushQueued = false;
  schedulersStarted = false;
  snapshot = { ...EMPTY_SNAPSHOT };
  outboxStore.resetForTesting();
  outboxQueue.resetForTesting();
}
