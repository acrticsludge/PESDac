// Answer-style resolver (settings stream S3).
//
// `resolveAnswerStyle({ chatCode })` reads verbosity + citations through
// the Step-0 kernel (`resolveTiered`): per-chat override > global default
// > built-in default (`balanced`, `on request` — today's defaults,
// unchanged). Pure and unit-testable; the backend/AI phase binds the
// resolved values into the request — never raw profile fields — so scoping
// works the moment binding lands, with zero rework.
//
// No per-subject tier in v1 (reserved, not built). Setting an override
// changes no current behavior: nothing consumes these fields yet.

import { resolveTiered } from "./settings-scope.ts";

export const BUILTIN_VERBOSITY = "balanced";
export const BUILTIN_CITATIONS = "on request";

export type AnswerStyle = {
  verbosity: string;
  citations: string;
};

/**
 * Resolve the effective answer style for one chat (or the globals when
 * `chatCode` is null). First set wins per field: per-chat override, then
 * the global profile value, then the built-in default.
 */
export function resolveAnswerStyle(args: { chatCode: string | null }): AnswerStyle {
  return {
    verbosity: resolveTiered("verbosity", args.chatCode, BUILTIN_VERBOSITY),
    citations: resolveTiered("citations", args.chatCode, BUILTIN_CITATIONS),
  };
}
