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
    const region =
      opts.region !== undefined && KNOWN_REGIONS.has(opts.region)
        ? opts.region
        : DEFAULT_LOCALE_REGION;
    const timeZone =
      (opts.timeZone !== undefined
        ? TIME_ZONE_TO_IANA[opts.timeZone]
        : undefined) ?? TIME_ZONE_TO_IANA[DEFAULT_LOCALE_TIME_ZONE];
    return new Intl.DateTimeFormat(`en-${region}`, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(parsed);
  } catch {
    return isoString;
  }
}
