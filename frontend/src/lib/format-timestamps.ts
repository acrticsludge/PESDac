// Locale layer 1: pure timestamp formatter (settings S4).
//
// Signature (frozen): `(isoString, { region, timeZone }) => string`.
// Pure: no reads, no fetches, no UI surface. Never throws — any failure
// (unknown values, unparseable input, an `Intl` error) returns the input
// unchanged so a timestamp row can never crash or blank.
//
// Contract mirrors the Profile dialog lists in
// `components/profile/sections.tsx` 1:1 (REGIONS × TIMEZONES): unknown or
// unsupported values fail closed to the built-ins (`IN` / `IST`, locale
// `en-IN`) — the same read-guard pattern `getProfile` applies to the campus
// field. UI-copy language binding is layer 3 and explicitly not started, so
// the locale is keyed off region only (`en-<region>`).

/** Built-in region: used when `region` is missing or not a known code. */
export const DEFAULT_LOCALE_REGION = "IN";

/** Built-in time zone abbreviation: used when `timeZone` is unknown. */
export const DEFAULT_LOCALE_TIME_ZONE = "IST";

/**
 * Known region codes — mirrors REGIONS in the Profile dialog (18 options).
 * Anything outside this set is treated as unknown and falls back.
 */
const KNOWN_REGIONS: ReadonlySet<string> = new Set([
  "IN",
  "US",
  "GB",
  "DE",
  "FR",
  "JP",
  "CN",
  "CA",
  "AU",
  "AE",
  "SG",
  "BR",
  "ES",
  "IT",
  "NL",
  "KR",
  "ZA",
  "SA",
]);

/**
 * Dialog time-zone abbreviations → IANA zones — mirrors TIMEZONES in the
 * Profile dialog (22 options). `Intl` needs an IANA zone; the dialog codes
 * are display abbreviations, so the mapping lives here, next to the read.
 */
const TIME_ZONE_TO_IANA: Readonly<Record<string, string>> = {
  PT: "America/Los_Angeles",
  MT: "America/Denver",
  CT: "America/Chicago",
  ET: "America/New_York",
  AT: "America/Halifax",
  ART: "America/Argentina/Buenos_Aires",
  HST: "Pacific/Honolulu",
  AKT: "America/Anchorage",
  UTC: "UTC",
  CET: "Europe/Paris",
  EET: "Europe/Athens",
  SAST: "Africa/Johannesburg",
  MSK: "Europe/Moscow",
  GST: "Asia/Dubai",
  IST: "Asia/Kolkata",
  NPT: "Asia/Kathmandu",
  BDT: "Asia/Dhaka",
  ICT: "Asia/Bangkok",
  CST: "Asia/Singapore",
  JST: "Asia/Tokyo",
  AET: "Australia/Sydney",
  NZT: "Pacific/Auckland",
};

export type FormatTimestampOpts = {
  /** Dialog region code (e.g. `"IN"`). Unknown → built-in `"IN"`. */
  region?: string;
  /** Dialog time-zone abbreviation (e.g. `"IST"`). Unknown → built-in. */
  timeZone?: string;
};

function resolveRegion(region?: string): string {
  return region !== undefined && KNOWN_REGIONS.has(region)
    ? region
    : DEFAULT_LOCALE_REGION;
}

function resolveTimeZone(timeZone?: string): string {
  return (
    (timeZone !== undefined ? TIME_ZONE_TO_IANA[timeZone] : undefined) ??
    TIME_ZONE_TO_IANA[DEFAULT_LOCALE_TIME_ZONE]
  );
}

/**
 * Format an ISO timestamp for display under the given locale settings.
 * Callers pass explicit zones; output never depends on the machine zone.
 */
export function formatTimestamp(
  isoString: string,
  opts: FormatTimestampOpts = {},
): string {
  try {
    const parsed = new Date(isoString);
    if (Number.isNaN(parsed.getTime())) return isoString;
    const region = resolveRegion(opts.region);
    const timeZone = resolveTimeZone(opts.timeZone);
    return new Intl.DateTimeFormat(`en-${region}`, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(parsed);
  } catch {
    return isoString;
  }
}

/**
 * Time-only sibling of `formatTimestamp` for chat metadata rows.
 * Same region → `en-<region>` locale and abbreviation → IANA zone
 * resolution, same fail-closed built-ins, same never-throw contract —
 * only the shape differs (time, no date) to preserve the existing
 * `Timestamp format="time"` paint ("2:51 PM").
 */
export function formatTime(
  isoString: string,
  opts: FormatTimestampOpts = {},
): string {
  try {
    const parsed = new Date(isoString);
    if (Number.isNaN(parsed.getTime())) return isoString;
    const region = resolveRegion(opts.region);
    const timeZone = resolveTimeZone(opts.timeZone);
    return new Intl.DateTimeFormat(`en-${region}`, {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(parsed);
  } catch {
    return isoString;
  }
}

// Day-divider helpers: a divider's stored text freezes the day word at
// creation ("Today · …"), so render must recompute the day prefix from the
// messages under it. Day boundaries are evaluated in the viewer's selected
// time zone (same abbreviation → IANA map as above), never the machine
// zone — otherwise changing the zone (or opening the chat days later)
// leaves a stale "Today".

export type DayLabelOpts = FormatTimestampOpts & {
  /** Reference instant ("now"). Defaults to the current time. */
  now?: string | number | Date;
};

/** Calendar-day key (`YYYY-MM-DD`) of an instant in the resolved zone. */
function toDayKey(date: Date, timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).format(date);
  } catch {
    return null;
  }
}

/**
 * Relative day word for an ISO timestamp ("Today", "Yesterday", weekday
 * for the rest of the week, medium date beyond that). Returns `null`
 * for unparseable input so callers can keep the stored prefix —
 * a divider row must never crash or blank.
 */
export function formatDayLabel(
  isoString: string,
  opts: DayLabelOpts = {},
): string | null {
  try {
    const parsed = new Date(isoString);
    if (Number.isNaN(parsed.getTime())) return null;
    const rawNow = opts.now === undefined ? new Date() : new Date(opts.now);
    if (Number.isNaN(rawNow.getTime())) return null;
    const region = resolveRegion(opts.region);
    const timeZone = resolveTimeZone(opts.timeZone);
    const anchorKey = toDayKey(parsed, timeZone);
    const nowKey = toDayKey(rawNow, timeZone);
    if (anchorKey == null || nowKey == null) return null;
    const diffDays = Math.round(
      (Date.parse(`${nowKey}T00:00:00Z`) - Date.parse(`${anchorKey}T00:00:00Z`)) /
        86400000,
    );
    // Future skew (or a scheduled instant) reads as today — dividers
    // name elapsed days, never upcoming ones.
    if (diffDays <= 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays <= 6) {
      return new Intl.DateTimeFormat(`en-${region}`, {
        weekday: "long",
        timeZone,
      }).format(parsed);
    }
    return new Intl.DateTimeFormat(`en-${region}`, {
      dateStyle: "medium",
      timeZone,
    }).format(parsed);
  } catch {
    return null;
  }
}

const DIVIDER_SEP = " · ";

/**
 * Recompute a stored divider's day prefix (`"Today · Subject"` →
 * `"Yesterday · Subject"`) from the anchor instant below it (first
 * message time, else chat creation). Unknown anchors or unparseable
 * input return the stored text unchanged — static demo shells
 * ("Last week · …") keep their curated paint.
 */
export function resolveDividerText(
  stored: string,
  anchorISO: string | undefined,
  opts: DayLabelOpts = {},
): string {
  const sep = stored.indexOf(DIVIDER_SEP);
  if (sep < 0 || anchorISO === undefined) return stored;
  const label = formatDayLabel(anchorISO, opts);
  if (label == null) return stored;
  return `${label}${DIVIDER_SEP}${stored.slice(sep + DIVIDER_SEP.length)}`;
}

/**
 * Zone-aware calendar-day equality for the day-break check on send.
 * Invalid input returns `false` (fail safe: insert a divider), mirroring
 * the previous `NaN → divider` behavior.
 */
export function isSameCalendarDay(
  aISO: string,
  bISO: string | number | Date,
  opts: FormatTimestampOpts = {},
): boolean {
  try {
    const a = new Date(aISO);
    const b = new Date(bISO);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
    const timeZone = resolveTimeZone(opts.timeZone);
    const aKey = toDayKey(a, timeZone);
    const bKey = toDayKey(b, timeZone);
    return aKey != null && aKey === bKey;
  } catch {
    return false;
  }
}
