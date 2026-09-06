import type { Thread } from "./types";

// Demo thread shells (2026-09-07): static turns removed — threads open with
// their day divider only and live turns arrive via the session overlay
// (responder + appendBlocks). Registry labels, codes (lib/chat.ts), routes,
// and sidebar structure are unchanged.

const booleanAlgebra: Thread = {
  label: "Boolean Algebra",
  subject: "DLCD",
  mode: "ask",
  placeholder: "Ask anything about Digital Logic...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Textbook", description: "PESDac knowledge source" },
  ],
  divider: "Today · Digital Logic",
  blocks: [
    { from: "system", text: "Today · Digital Logic", variant: "divider" },
  ],
};

const kmaps: Thread = {
  label: "K-Maps",
  subject: "DLCD",
  mode: "deep",
  placeholder: "Ask for a deep, step-by-step explanation...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Textbook", description: "PESDac knowledge source" },
  ],
  divider: "Yesterday · Digital Logic",
  blocks: [
    {
      from: "system",
      text: "Yesterday · Digital Logic",
      variant: "divider",
    },
  ],
};

const sequential: Thread = {
  label: "Sequential Circuits",
  subject: "DLCD",
  mode: "ask",
  placeholder: "Ask anything about Digital Logic...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Lecture Recordings", description: "PESDac knowledge source" },
  ],
  divider: "Monday · Digital Logic",
  blocks: [
    {
      from: "system",
      text: "Monday · Digital Logic",
      variant: "divider",
    },
  ],
};

const flipflops: Thread = {
  label: "Flip-Flops",
  subject: "DLCD",
  mode: "ask",
  placeholder: "Ask anything about Digital Logic...",
  composerReferenceItems: [
    { label: "Textbook", description: "PESDac knowledge source" },
  ],
  divider: "Last week · Digital Logic",
  blocks: [
    {
      from: "system",
      text: "Last week · Digital Logic",
      variant: "divider",
    },
  ],
};

export const dlcdThreads: Thread[] = [
  booleanAlgebra,
  kmaps,
  sequential,
  flipflops,
];
