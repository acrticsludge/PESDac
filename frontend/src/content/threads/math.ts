import type { Thread } from "./types";

// Demo thread shells (2026-09-07): static turns removed — threads open with
// their day divider only and live turns arrive via the session overlay
// (responder + appendBlocks). Registry labels, codes (lib/chat.ts), routes,
// and sidebar structure are unchanged.

const matrices: Thread = {
  label: "Matrices",
  subject: "MFADS",
  mode: "ask",
  placeholder: "Ask anything about Maths for AI and Data Science...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Textbook", description: "PESDac knowledge source" },
  ],
  divider: "Today · Maths for AI and Data Science",
  blocks: [
    { from: "system", text: "Today · Maths for AI and Data Science", variant: "divider" },
  ],
};

const diffEq: Thread = {
  label: "Differential Equations",
  subject: "MFADS",
  mode: "deep",
  placeholder: "Ask for a deep, step-by-step explanation...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Textbook", description: "PESDac knowledge source" },
  ],
  divider: "Yesterday · Maths for AI and Data Science",
  blocks: [
    {
      from: "system",
      text: "Yesterday · Maths for AI and Data Science",
      variant: "divider",
    },
  ],
};

const probability: Thread = {
  label: "Probability",
  subject: "MFADS",
  mode: "ask",
  placeholder: "Ask anything about Maths for AI and Data Science...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Lecture Recordings", description: "PESDac knowledge source" },
  ],
  divider: "Monday · Maths for AI and Data Science",
  blocks: [
    {
      from: "system",
      text: "Monday · Maths for AI and Data Science",
      variant: "divider",
    },
  ],
};

const fourier: Thread = {
  label: "Fourier Series",
  subject: "MFADS",
  mode: "deep",
  placeholder: "Ask for a deep, step-by-step explanation...",
  composerReferenceItems: [
    { label: "Textbook", description: "PESDac knowledge source" },
  ],
  divider: "Last week · Maths for AI and Data Science",
  blocks: [
    {
      from: "system",
      text: "Last week · Maths for AI and Data Science",
      variant: "divider",
    },
  ],
};

export const mathThreads: Thread[] = [matrices, diffEq, probability, fourier];
