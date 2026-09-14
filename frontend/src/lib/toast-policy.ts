// Toast safety policy for the app-level host (audit §11 item 4).
//
// Two jobs the Astryx Toast primitive doesn't own:
// - Repeat dedupe: an unhandled-rejection storm (one throwaway per
//   failed flush, per timer tick) must surface once, not stack.
// - Log redaction: rejection reasons can carry tokens/keys in their
//   message — the devtools line keeps the shape, never the secret.

/** Identical bodies inside this window collapse to the first toast. */
export const TOAST_REPEAT_WINDOW_MS = 3000;

let lastBody: string | null = null;
let lastAtMs = 0;

/**
 * True when this exact body already surfaced inside the repeat window
 * (caller skips both the toast AND the log line — the first instance
 * is already recorded). Pure except for the one-entry memory.
 */
export function isRepeatToast(body: string, nowMs: number = Date.now()): boolean {
  if (body === lastBody && nowMs - lastAtMs < TOAST_REPEAT_WINDOW_MS) {
    return true;
  }
  lastBody = body;
  lastAtMs = nowMs;
  return false;
}

/** Test seam: forget the last surfaced body. */
export function __resetToastPolicyForTesting(): void {
  lastBody = null;
  lastAtMs = 0;
}

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9-_]{8,}/g,
  /ghp_[A-Za-z0-9_]{8,}/g,
  /xox[bpas]-[A-Za-z0-9-]+/g,
  /AIza[A-Za-z0-9-_]{10,}/g,
  /Bearer\s+[A-Za-z0-9\-._~+/=]+/g,
  /password\s*[:=]\s*\S+/gi,
];

/**
 * Render an unknown rejection reason log-safe: error name + message
 * (or a JSON snapshot for objects), secret-shaped substrings
 * redacted, capped at 500 chars. Never throws, never returns the raw
 * object.
 */
export function redactForLog(reason: unknown): string {
  let text: string;
  if (reason instanceof Error) {
    text = `${reason.name}: ${reason.message}`;
  } else if (typeof reason === "string") {
    text = reason;
  } else {
    try {
      text = JSON.stringify(reason) ?? typeof reason;
    } catch {
      text = typeof reason;
    }
  }
  let out = text.slice(0, 500);
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, "[redacted]");
  }
  return out;
}
