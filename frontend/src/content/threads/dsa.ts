import type { Thread } from "./types";

// Demo thread shells (2026-09-07): static turns removed — threads open with
// their day divider only and live turns arrive via the session overlay
// (responder + appendBlocks). Registry labels, codes (lib/chat.ts), routes,
// and sidebar structure are unchanged.

const binaryTrees: Thread = {
  label: "Binary Trees",
  subject: "DSA",
  mode: "ask",
  placeholder: "Ask anything about DSA...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Textbook", description: "PESDac knowledge source" },
  ],
  divider: "Today · Data Structures",
  blocks: [
    { from: "system", text: "Today · Data Structures", variant: "divider" },
  ],
};

const graphs: Thread = {
  label: "Graph Algorithms",
  subject: "DSA",
  mode: "deep",
  placeholder: "Ask for a deep, step-by-step explanation...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Textbook", description: "PESDac knowledge source" },
  ],
  divider: "Yesterday · Data Structures",
  blocks: [
    {
      from: "system",
      text: "Yesterday · Data Structures",
      variant: "divider",
    },
  ],
};

const sorting: Thread = {
  label: "Sorting Algorithms",
  subject: "DSA",
  mode: "ask",
  placeholder: "Ask anything about DSA...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
  ],
  divider: "Monday · Data Structures",
  blocks: [
    {
      from: "system",
      text: "Monday · Data Structures",
      variant: "divider",
    },
  ],
};

const dp: Thread = {
  label: "Dynamic Programming",
  subject: "DSA",
  mode: "deep",
  placeholder: "Ask for a deep, step-by-step explanation...",
  composerReferenceItems: [
    { label: "Textbook", description: "PESDac knowledge source" },
    { label: "Lecture Recordings", description: "PESDac knowledge source" },
  ],
  divider: "Last week · Data Structures",
  blocks: [
    {
      from: "system",
      text: "Last week · Data Structures",
      variant: "divider",
    },
  ],
};

export const dsaThreads: Thread[] = [binaryTrees, graphs, sorting, dp];
