// Follow-up suggestions pill anchor (settings S1).
//
// Visibility is the profile global alone (My Profile → Assistant →
// Follow-up suggestions); the thread's "..." menu carries no per-chat
// override. This module owns only the pure anchor: which turn's
// suggestions the bottom pill row shows.

/** Minimal block shape the pill anchor reads (system dividers carry no time). */
export type FollowUpsBlock = {
  from: "user" | "assistant" | "system";
  followUps?: readonly string[];
};

/**
 * Pills for the bottom row: the latest assistant turn's suggestions —
 * but only while no newer user message supersedes them. A sent prompt
 * whose response hasn't landed yet (user block appended, assistant turn
 * not yet persisted) yields null, so stale pills never flash before the
 * response is done. System dividers are skipped, never anchors; assistant
 * turns without suggestions (e.g. error rows) are skipped the same way.
 */
export function latestFollowUps(
  blocks: readonly FollowUpsBlock[],
): readonly string[] | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.from === "user") return null;
    if (b.from === "assistant" && b.followUps && b.followUps.length > 0)
      return b.followUps;
  }
  return null;
}
