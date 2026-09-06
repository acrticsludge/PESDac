import type { Thread } from "./types";

// Demo thread shells (2026-09-07): static turns removed — threads open with
// their day divider only and live turns arrive via the session overlay
// (responder + appendBlocks). Registry labels, codes (lib/chat.ts), routes,
// and sidebar structure are unchanged.

const scheduling: Thread = {
  label: "Process Scheduling",
  subject: "OS",
  mode: "ask",
  placeholder: "Ask anything about Operating Systems...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Textbook", description: "PESDac knowledge source" },
  ],
  divider: "Today · Operating Systems",
  blocks: [
    { from: "system", text: "Today · Operating Systems", variant: "divider" },
  ],
};

const deadlocks: Thread = {
  label: "Deadlocks",
  subject: "OS",
  mode: "deep",
  placeholder: "Ask for a deep, step-by-step explanation...",
  composerReferenceItems: [
    { label: "Textbook", description: "PESDac knowledge source" },
  ],
  divider: "Yesterday · Operating Systems",
  blocks: [
    {
      from: "system",
      text: "Yesterday · Operating Systems",
      variant: "divider",
    },
  ],
};

const virtualMemory: Thread = {
  label: "Virtual Memory",
  subject: "OS",
  mode: "ask",
  placeholder: "Ask anything about Operating Systems...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Textbook", description: "PESDac knowledge source" },
    { label: "Lecture Recordings", description: "PESDac knowledge source" },
  ],
  divider: "Monday · Operating Systems",
  blocks: [
    {
      from: "system",
      text: "Monday · Operating Systems",
      variant: "divider",
    },
  ],
};

const fileSystems: Thread = {
  label: "File Systems",
  subject: "OS",
  mode: "ask",
  placeholder: "Ask anything about Operating Systems...",
  composerReferenceItems: [
    { label: "Textbook", description: "PESDac knowledge source" },
  ],
  divider: "Last week · Operating Systems",
  blocks: [
    {
      from: "system",
      text: "Last week · Operating Systems",
      variant: "divider",
    },
  ],
};

export const osThreads: Thread[] = [
  scheduling,
  deadlocks,
  virtualMemory,
  fileSystems,
];
