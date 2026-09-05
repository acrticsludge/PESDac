// Shared @ reference sources (knowledge scopes an answer can cite).
// Single home for the items both composers offer; the mock responder maps
// @id tokens in the question to a retrieval target, the backend will parse
// the same tokens server-side.

import type { SearchableItem } from "@astryxdesign/core/Typeahead";

export const REFERENCE_ITEMS: SearchableItem<{ type: string }>[] = [
  {
    id: "slides",
    label: "Course Slides",
    auxiliaryData: {
      type: "PESDac course material",
    },
  },

  {
    id: "textbook",
    label: "Textbook",
    auxiliaryData: {
      type: "PESDac knowledge source",
    },
  },

  {
    id: "lectures",
    label: "Lecture Recordings",
    auxiliaryData: {
      type: "PESDac knowledge source",
    },
  },
];

/** Retrieval target phrasing per source id + subject. */
export function sourceTarget(sourceId: string, subject: string): string {
  switch (sourceId) {
    case "textbook":
      return `${subject} textbook`;
    case "lectures":
      return `${subject} lecture recordings`;
    case "slides":
    default:
      return `${subject} course slides`;
  }
}

/** id for a display label (thread items carry labels only). */
export function referenceIdForLabel(label: string): string {
  const found = REFERENCE_ITEMS.find((i) => i.label === label);
  if (found) return String(found.id);
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Ordered @id tokens found in raw composer text (e.g. ["textbook"]). */
const TOKEN_RE = /@([a-z0-9-]+)/gi;
export function parseReferenceIds(text: string): string[] {
  const ids: string[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) != null) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

/** Composer text with @id tokens removed (for echoes, titles). */
export function stripReferenceTokens(text: string): string {
  return text
    .replace(TOKEN_RE, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
