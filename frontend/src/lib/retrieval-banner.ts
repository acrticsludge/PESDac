// Retrieval banner dismissal store + copy selection (spec §4.4, §5).
//
// Device-local like drafts — never server state, never cross-identity.
// Cleared on identity transition and on search success (flap = new
// incident). Clock is injectable via nowMs (tests stub it, zero sleeps).

export const RETRIEVAL_BANNER_KEY = "pesdac:retrieval-banner";

/** Quiet window after dismissal before the same code may re-show (1 h). */
export const RETRIEVAL_BANNER_QUIET_MS = 3600000;

export type RetrievalIncidentCode =
  | "EMBED_UNREACHABLE"
  | "EMBED_MISCONFIGURED"
  | "EMBED_SPACE_MISMATCH";

export type BannerStatus = "error" | "warning";

export type RetrievalDismissal = {
  code: string;
  dismissedAt: number;
};

export type RetrievalCopy = {
  title: string;
  message: string;
  status: BannerStatus;
};

const COPY_TABLE: Record<RetrievalIncidentCode, { title: string; status: BannerStatus }> = {
  EMBED_UNREACHABLE: {
    title: "Search is temporarily unavailable",
    status: "error",
  },
  EMBED_MISCONFIGURED: {
    title: "Search isn't available right now",
    status: "warning",
  },
  EMBED_SPACE_MISMATCH: {
    title: "Search index needs a refresh. Let your instructor know.",
    status: "warning",
  },
};

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Newest dismissal, or null when absent/corrupt/unavailable. */
export function readRetrievalBannerDismissal(): RetrievalDismissal | null {
  const store = storage();
  if (store == null) return null;
  try {
    const raw = store.getItem(RETRIEVAL_BANNER_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as Partial<RetrievalDismissal>;
    if (typeof parsed.code !== "string" || typeof parsed.dismissedAt !== "number") {
      return null;
    }
    return { code: parsed.code, dismissedAt: parsed.dismissedAt };
  } catch {
    return null;
  }
}

/** Record a dismissal for the incident class. Never throws. */
export function recordRetrievalBannerDismissal(
  code: RetrievalIncidentCode,
  nowMs: number = Date.now(),
): void {
  const store = storage();
  if (store == null) return;
  try {
    store.setItem(RETRIEVAL_BANNER_KEY, JSON.stringify({ code, dismissedAt: nowMs }));
  } catch {
    // Storage denied (private mode) — the bar simply re-shows.
  }
}

/**
 * Clear the stored dismissal: call on search success (flap = new
 * incident) and on identity transition (never cross-identity).
 */
export function clearRetrievalBannerDismissal(): void {
  const store = storage();
  if (store == null) return;
  try {
    store.removeItem(RETRIEVAL_BANNER_KEY);
  } catch {
    // Storage denied — nothing to clear.
  }
}

/**
 * True when the downtime bar may mount for `code`:
 * - nothing dismissed, or
 * - a different code arrived (502 → 503 or reverse), or
 * - the 1 h quiet window elapsed since dismissal.
 * Same code inside the window stays hidden.
 */
export function shouldShowRetrievalBanner(
  code: RetrievalIncidentCode,
  nowMs: number = Date.now(),
): boolean {
  const stored = readRetrievalBannerDismissal();
  if (stored == null) return true;
  if (stored.code !== code) return true;
  return nowMs - stored.dismissedAt >= RETRIEVAL_BANNER_QUIET_MS;
}

/** 502 is always error; 503 starts warning, error when persistent. */
export function bannerStatusForCode(
  code: RetrievalIncidentCode,
  isPersistent = false,
): BannerStatus {
  if (code === "EMBED_UNREACHABLE") return "error";
  if (isPersistent) return "error";
  return COPY_TABLE[code]?.status ?? "warning";
}

/**
 * Copy rule (§3): the envelope error.message wins when present;
 * §5 titles are fallbacks for unreadable bodies (network failure).
 */
export function selectRetrievalCopy(args: {
  code: RetrievalIncidentCode;
  envelopeMessage?: string | null;
}): RetrievalCopy {
  const fallback = COPY_TABLE[args.code] ?? {
    title: "Search is temporarily unavailable",
    status: "error" as const,
  };
  const envelope = args.envelopeMessage?.trim();
  return {
    title: fallback.title,
    message: envelope ? envelope : fallback.title,
    status: fallback.status,
  };
}
