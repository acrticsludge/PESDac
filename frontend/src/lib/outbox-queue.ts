// In-memory optimistic send queue (Phase 5 T5b).
//
// Per-item send states for chat writes: `pending → sent |
// failed-retryable | failed-fatal`. The queue is memory-only — it drives
// inline retry affordances and toasts for the current session; durable
// survival across reloads is the IndexedDB outbox's job (outbox-db.ts).
//
// Error taxonomy mirrors the `auth.ts` retry policy structurally (no
// import — session.ts documents the same auth→session cycle hazard, and
// this module stays dependency-free so unit tests load it standalone):
// - 401 / AuthRequiredError → failed-fatal (the global re-login flow
//   owns 401s; the queue never auto-retries them).
// - 429 / 5xx / 409 → failed-retryable (transient or safe-to-retry
//   with an idempotency key; 409 is the append seq race).
// - 400 / 403 / 404 / 422 → failed-fatal (the server answered
//   authoritatively; retrying repeats the same refusal).
// - AuthServiceError (token-mint outage) / TypeError / AbortError
//   (never reached the server) → failed-retryable.
// - Anything else → failed-retryable (transient until proven otherwise;
//   bounded by the flush worker's attempt cap, never infinite).

/** Terminal send states for one optimistic write. */
export type OutboxSendStatus =
  | "pending"
  | "sent"
  | "failed-retryable"
  | "failed-fatal";

/** One tracked send: created pending, settled exactly once. */
export type OutboxRecord = {
  id: string;
  status: OutboxSendStatus;
  attempts: number;
  updatedAt: number;
  lastError?: string;
};

/** Retryable half of the taxonomy (the fatal half is its complement). */
export type OutboxFailure = "failed-retryable" | "failed-fatal";

function errorName(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

function errorStatus(error: unknown): number | null {
  if (typeof error === "object" && error !== null) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return null;
}

function isAbortError(error: unknown): boolean {
  if (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "AbortError"
  ) {
    return true;
  }
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Pure failure classification for one failed send. Structural (name +
 * status) so callers never import the error classes — the taxonomy
 * cannot drift from `auth.ts` silently because the matrix is pinned
 * by `outbox-queue.test.ts`.
 */
export function classifyOutboxError(error: unknown): OutboxFailure {
  // Terminal first: 401s belong to the re-login flow, never to retry.
  if (errorName(error) === "AuthRequiredError") return "failed-fatal";
  const status = errorStatus(error);
  if (status === 401) return "failed-fatal";
  // Token-mint outage: the session is alive, the mint side is down.
  if (errorName(error) === "AuthServiceError") return "failed-retryable";
  // Never reached the server (DNS/refused/offline) or timed out.
  if (error instanceof TypeError || isAbortError(error)) {
    return "failed-retryable";
  }
  if (status != null) {
    if (status === 429 || status === 409 || status >= 500) {
      return "failed-retryable";
    }
    // 400/403/404/422 and friends: authoritative refusal.
    return "failed-fatal";
  }
  return "failed-retryable";
}

/** One idempotency key per send (`crypto.randomUUID()` when available). */
export function newClientKey(): string {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch {
    // Non-secure contexts (plain HTTP test hosts) fall through below.
  }
  return `xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx`.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  );
}

type OutboxListener = () => void;

/**
 * Minimal in-memory queue: `track()` a pending send, settle it with
 * `markSent()` / `markFailed()`. Records are keyed by caller-supplied
 * id (the send's idempotency key doubles as the id — one record per
 * send by construction). Finished records stay readable (the UI paints
 * from them) until `forget()`d; `resetForTesting()` clears everything.
 */
export class OutboxQueue {
  private records = new Map<string, OutboxRecord>();
  private listeners = new Set<OutboxListener>();

  track(id: string): OutboxRecord {
    const record: OutboxRecord = {
      id,
      status: "pending",
      attempts: 1,
      updatedAt: Date.now(),
    };
    this.records.set(id, record);
    this.emit();
    return record;
  }

  markSent(id: string): OutboxRecord | null {
    const record = this.records.get(id);
    if (!record) return null;
    record.status = "sent";
    record.updatedAt = Date.now();
    delete record.lastError;
    this.emit();
    return record;
  }

  markFailed(id: string, error: unknown): OutboxRecord | null {
    const record = this.records.get(id);
    if (!record) return null;
    record.status = classifyOutboxError(error);
    record.updatedAt = Date.now();
    record.lastError =
      error instanceof Error && error.message ? error.message : "Failed.";
    this.emit();
    return record;
  }

  /**
   * Force `failed-fatal` regardless of the error taxonomy — for
   * authoritative refusals the worker already classified, and for
   * retryables that exhausted the attempt cap (`markFailed` would
   * re-classify a 500 as retryable and the worker would retry forever).
   */
  markFatal(id: string, error: unknown): OutboxRecord | null {
    const record = this.records.get(id);
    if (!record) return null;
    record.status = "failed-fatal";
    record.updatedAt = Date.now();
    record.lastError =
      error instanceof Error && error.message ? error.message : "Failed.";
    this.emit();
    return record;
  }

  get(id: string): OutboxRecord | null {
    return this.records.get(id) ?? null;
  }

  list(): OutboxRecord[] {
    return [...this.records.values()];
  }

  /** Unsent records (pending + both failed states) — the badge count. */
  unsent(): OutboxRecord[] {
    return this.list().filter((r) => r.status !== "sent");
  }

  forget(id: string): void {
    if (this.records.delete(id)) this.emit();
  }

  subscribe(listener: OutboxListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  resetForTesting(): void {
    this.records.clear();
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((notify) => {
      try {
        notify();
      } catch {
        // A stale listener must not break the rest.
      }
    });
  }
}

/** Session-scoped singleton (durable state lives in outbox-db.ts). */
export const outboxQueue = new OutboxQueue();
