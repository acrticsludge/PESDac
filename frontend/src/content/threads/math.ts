import type { Thread } from "./types";

// Demo thread shells (2026-09-07): static turns removed — threads open with
// their day divider only and live turns arrive via the session overlay
// (responder + appendBlocks). Registry labels, codes (lib/chat.ts), routes,
// and sidebar structure are unchanged.

const matrices: Thread = {
  label: "Matrices",
  subject: "Math",
  mode: "ask",
  placeholder: "Ask anything about Mathematics...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Textbook", description: "PESDac knowledge source" },
  ],
  divider: "Today · Mathematics",
  blocks: [
    { from: "system", text: "Today · Mathematics", variant: "divider" },
  ],
};

const diffEq: Thread = {
  label: "Differential Equations",
  subject: "Math",
  mode: "deep",
  placeholder: "Ask for a deep, step-by-step explanation...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Textbook", description: "PESDac knowledge source" },
  ],
  divider: "Yesterday · Mathematics",
  blocks: [
    {
      from: "system",
      text: "Yesterday · Mathematics",
      variant: "divider",
    },
  ],
};

const probability: Thread = {
  label: "Probability",
  subject: "Math",
  mode: "ask",
  placeholder: "Ask anything about Mathematics...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Lecture Recordings", description: "PESDac knowledge source" },
  ],
  divider: "Monday · Mathematics",
  blocks: [
    {
      from: "system",
      text: "Monday · Mathematics",
      variant: "divider",
    },
  ],
};

const fourier: Thread = {
  label: "Fourier Series",
  subject: "Math",
  mode: "deep",
  placeholder: "Ask for a deep, step-by-step explanation...",
  composerReferenceItems: [
    { label: "Textbook", description: "PESDac knowledge source" },
  ],
  divider: "Last week · Mathematics",
  blocks: [
    {
      from: "system",
      text: "Last week · Mathematics",
      variant: "divider",
    },
  ],
};

export const mathThreads: Thread[] = [matrices, diffEq, probability, fourier];
