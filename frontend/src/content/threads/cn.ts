import type { Thread } from "./types";

// Demo thread shells (2026-09-07): static turns removed — threads open with
// their day divider only and live turns arrive via the session overlay
// (responder + appendBlocks). Registry labels, codes (lib/chat.ts), routes,
// and sidebar structure are unchanged.

const tcpVsUdp: Thread = {
  label: "TCP vs UDP",
  subject: "CN",
  mode: "ask",
  placeholder: "Ask anything about Computer Networks...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Textbook", description: "PESDac knowledge source" },
    { label: "Lecture Recordings", description: "PESDac knowledge source" },
  ],
  divider: "Today · Computer Networks",
  blocks: [
    { from: "system", text: "Today · Computer Networks", variant: "divider" },
  ],
};

const osiModel: Thread = {
  label: "OSI Model",
  subject: "CN",
  mode: "ask",
  placeholder: "Ask anything about Computer Networks...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Textbook", description: "PESDac knowledge source" },
  ],
  divider: "Yesterday · Computer Networks",
  blocks: [
    {
      from: "system",
      text: "Yesterday · Computer Networks",
      variant: "divider",
    },
  ],
};

const subnetting: Thread = {
  label: "IP Addressing & Subnetting",
  subject: "CN",
  mode: "deep",
  placeholder: "Ask for a deep, step-by-step explanation...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Textbook", description: "PESDac knowledge source" },
  ],
  divider: "Monday · Computer Networks",
  blocks: [
    {
      from: "system",
      text: "Monday · Computer Networks",
      variant: "divider",
    },
  ],
};

const routing: Thread = {
  label: "Routing Protocols",
  subject: "CN",
  mode: "ask",
  placeholder: "Ask anything about Computer Networks...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Lecture Recordings", description: "PESDac knowledge source" },
  ],
  divider: "Last week · Computer Networks",
  blocks: [
    {
      from: "system",
      text: "Last week · Computer Networks",
      variant: "divider",
    },
  ],
};

export const cnThreads: Thread[] = [tcpVsUdp, osiModel, subnetting, routing];
