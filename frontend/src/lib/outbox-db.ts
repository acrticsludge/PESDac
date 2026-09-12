// Durable pending-ops outbox store (Phase 5 T5c).
//
// IndexedDB, never localStorage for payloads: localStorage is a sync API
// with a ~5MB quota and message bodies run to 100KB — it would jank the
// main thread and blow quota. IndexedDB is async, origin-scoped, and
// quota-managed by the browser.
//
// Pending-ops ONLY, never a data mirror: each row is one unsent write
// (chat-create or message-append) with the minimum fields needed to
// replay it. Rows are deleted on ack. No tokens, no session material,
// no user profile — the replay re-mints auth at send time through the
// normal `apiFetch` path, so a stolen disk image yields message drafts
// at worst, never credentials.
//
// Storage tradeoff (documented per spec §5): chat bodies ARE persisted
// here (unlike the counts-only localStorage precedent) because a retry
// after reload is impossible without the body. Mitigations: ops only
// (no history mirror), delete-on-ack, a hard cap with oldest-first
// eviction (see outbox.ts), and strict shape validation on load —
// durable storage is treated as untrusted input (XSS review: malformed
// rows are dropped, never rendered; payloads are only ever POSTed back
// to the server, never innerHTML'd).
//
// Memory fallback: when IndexedDB is unavailable (SSR, node tests, very
// old browsers) the same API runs on a Map — session-scoped instead of
// durable, with identical ordering and validation semantics.

/** Replayable write kinds. `create-chat` always drains before its chat's appends. */
export type OutboxOpKind = "create-chat" | "append-message";

/** One pending write. `payload` is the exact POST body for the replay. */
export type OutboxOp = {
  id: string;
  chatCode: string;
  kind: OutboxOpKind;
  /** Idempotency key replayed verbatim — retries are safe by construction. */
  clientKey: string;
  payload: unknown;
  createdAt: number;
  attempts: number;
};

const DB_NAME = "pesdac-outbox";
const STORE_NAME = "ops";
const DB_VERSION = 1;

/** Strict shape check — durable storage is untrusted input. */
export function isValidOutboxOp(value: unknown): value is OutboxOp {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    v.id !== "" &&
    typeof v.chatCode === "string" &&
    v.chatCode !== "" &&
    (v.kind === "create-chat" || v.kind === "append-message") &&
    typeof v.clientKey === "string" &&
    v.clientKey !== "" &&
    typeof v.createdAt === "number" &&
    typeof v.attempts === "number" &&
    "payload" in v
  );
}

function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB != null;
  } catch {
    return false;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Couldn't open the outbox store."));
  });
}

function runStore<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  task: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const tx = db.transaction(STORE_NAME, mode);
    tx.oncomplete = () => {
      if (!settled) {
        settled = true;
        // Read tasks resolve via the request handler below; a bare
        // complete without a value means a write task finished.
        resolve(undefined as T);
      }
    };
    tx.onerror = () => {
      if (!settled) {
        settled = true;
        reject(tx.error ?? new Error("Outbox store transaction failed."));
      }
    };
    tx.onabort = () => {
      if (!settled) {
        settled = true;
        reject(tx.error ?? new Error("Outbox store transaction aborted."));
      }
    };
    let request: IDBRequest<T>;
    try {
      request = task(tx.objectStore(STORE_NAME));
    } catch (error) {
      reject(error);
      return;
    }
    request.onsuccess = () => {
      if (!settled) {
        settled = true;
        resolve(request.result);
      }
    };
    request.onerror = () => {
      if (!settled) {
        settled = true;
        reject(request.error ?? new Error("Outbox store request failed."));
      }
    };
  });
}

/**
 * Pending-ops store with an in-memory fallback. One instance per module
 * import; `resetForTesting()` drops everything (memory) or all rows.
 */
export class OutboxStore {
  private memory = new Map<string, OutboxOp>();
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  private database(): Promise<IDBDatabase | null> {
    if (!hasIndexedDb()) return Promise.resolve(null);
    if (!this.dbPromise) {
      this.dbPromise = openDatabase().catch(() => null);
    }
    return this.dbPromise;
  }

  async put(op: OutboxOp): Promise<void> {
    if (!isValidOutboxOp(op)) throw new Error("Invalid outbox op.");
    const db = await this.database();
    if (!db) {
      this.memory.set(op.id, { ...op });
      return;
    }
    try {
      // Structured clone carries the payload as-is (JSON-safe by
      // construction — payloads are the same objects apiFetch would
      // JSON.stringify on a live send).
      await runStore(db, "readwrite", (store) => store.put({ ...op }));
    } catch {
      // Quota or transaction failure mid-write: keep the memory copy so
      // the current session can still drain; durability degrades, the
      // send path does not.
      this.memory.set(op.id, { ...op });
    }
  }

  async remove(id: string): Promise<void> {
    const db = await this.database();
    this.memory.delete(id);
    if (!db) return;
    try {
      await runStore(db, "readwrite", (store) => store.delete(id));
    } catch {
      // Best-effort: the memory copy is already gone, so a stale IDB
      // row can at worst replay once more with the same idempotency
      // key — the server dedupes it into a 200.
    }
  }

  /**
   * All ops, oldest first (FIFO). Malformed rows are dropped, never
   * surfaced. Memory entries missing from the IDB rows are unioned in:
   * a `put` that fell back to memory after a transient IDB failure must
   * still drain — otherwise the op would sit invisible to the flush
   * worker (never sent, never evicted). IDB rows win on id collisions
   * (a memory copy alongside an IDB row is stale by construction).
   */
  async list(): Promise<OutboxOp[]> {
    const byCreated = (a: OutboxOp, b: OutboxOp) => a.createdAt - b.createdAt;
    const memory = [...this.memory.values()].filter(isValidOutboxOp);
    const db = await this.database();
    if (!db) {
      return memory.sort(byCreated);
    }
    let rows: unknown[];
    try {
      rows = await runStore<unknown[]>(db, "readonly", (store) =>
        store.getAll(),
      );
    } catch {
      return memory.sort(byCreated);
    }
    const valid = rows.filter(isValidOutboxOp);
    const seen = new Set(valid.map((op) => op.id));
    for (const op of memory) {
      if (!seen.has(op.id)) valid.push(op);
    }
    valid.sort(byCreated);
    return valid;
  }

  async clear(): Promise<void> {
    const db = await this.database();
    this.memory.clear();
    if (!db) return;
    try {
      await runStore(db, "readwrite", (store) => store.clear());
    } catch {
      // Memory is already clear; same replay-safe reasoning as remove().
    }
  }

  resetForTesting(): void {
    this.memory.clear();
    if (this.dbPromise) {
      void this.dbPromise.then((db) => {
        try {
          db?.close();
        } catch {
          // Test-only teardown; ignore.
        }
      });
      this.dbPromise = null;
    }
  }
}

/** Process-wide store (rows are origin-scoped by IndexedDB itself). */
export const outboxStore = new OutboxStore();
