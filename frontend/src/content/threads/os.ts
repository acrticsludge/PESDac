import type { Thread } from "./types";

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
    {
      from: "user",
      bubbles: [
        { type: "text", text: "Walk me through Round Robin with a worked example." },
      ],
      time: "2026-09-04T11:02:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "markdown",
          md: `### Round Robin (time quantum = 4ms)

Each process gets a fixed slice, then rejoins the queue.
Fair, no starvation — the default for time-sharing systems.`,
        },
        {
          type: "image",
          src: "/samples/gantt.svg",
          alt: "Gantt chart of Round Robin scheduling",
          label: "Round Robin Gantt chart",
        },
        {
          type: "code",
          title: "Reading the chart",
          language: "text",
          code: `P1 runs 0-4, preempted, resumes 12-16
P2 runs 4-8 and 16-20, then finishes
Avg waiting = (6 + 4 + 7 + 3) / 4 = 5ms`,
        },
        {
          type: "quiz",
          md: `### Quick check

What happens to average waiting time if the quantum drops to 1ms?
What gets worse?`,
        },
      ],
      toolCalls: [
        { name: "retrieve", target: "OS Lecture 04.pdf", status: "complete", duration: "44ms" },
        { name: "search", target: "OS textbook · Round Robin", status: "complete", duration: "58ms" },
      ],
      toolCallsExpanded: true,
      toolCallsAfter: 0,
      time: "2026-09-04T11:02:14",
      footer: "PESDac · OS",
    },
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
    { from: "system", text: "Yesterday · Operating Systems", variant: "divider" },
    {
      from: "user",
      bubbles: [
        { type: "text", text: "What are the 4 Coffman conditions? Give a real example." },
      ],
      time: "2026-09-03T15:40:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "markdown",
          md: `### Coffman conditions (all 4 needed)

1. **Mutual exclusion** — resource can't be shared.
2. **Hold and wait** — process holds one, waits for another.
3. **No preemption** — resources can't be force-taken.
4. **Circular wait** — P1 waits on P2 waits on P1.

Example: two threads, one printer, one scanner — each grabs one
device and waits forever for the other.`,
        },
        {
          type: "code",
          title: "Prevention cheat sheet",
          language: "text",
          code: `Break any ONE condition to prevent deadlock:
- Spool everything      -> breaks mutual exclusion
- Request all upfront   -> breaks hold and wait
- Allow preemption      -> breaks no preemption
- Order all resources   -> breaks circular wait`,
        },
        {
          type: "quiz",
          md: `### Quick check

The Banker's algorithm avoids deadlock. Which condition does it
target, and is it prevention or avoidance?`,
        },
      ],
      time: "2026-09-03T15:40:22",
      footer: "PESDac · OS",
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
    { from: "system", text: "Monday · Operating Systems", variant: "divider" },
    {
      from: "user",
      attachments: [
        { id: "seed-os-1", name: "OS Ch9 Textbook.pdf", mime: "application/pdf", size: 3123200 },
      ],
      bubbles: [
        {
          type: "mention",
          tokens: [{ value: "@os", label: "@OS", variant: "blue" }],
          text: "@os How does paging translate a virtual address? Use this chapter.",
        },
      ],
      time: "2026-09-01T14:00:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "text",
          text: "Paging splits memory into fixed-size pages and frames — no external fragmentation.",
        },
        {
          type: "image",
          src: "/samples/paging.svg",
          alt: "Diagram mapping virtual pages to physical frames",
          label: "Paging address translation",
        },
      ],
      toolCalls: [
        { name: "retrieve", target: "OS Ch9 Textbook.pdf", status: "complete", duration: "51ms" },
        { name: "search", target: "OS textbook · paging", status: "complete", duration: "49ms" },
      ],
      toolCallsExpanded: true,
      toolCallsAfter: 0,
      time: "2026-09-01T14:00:12",
      footer: "PESDac · OS",
    },
    {
      from: "assistant",
      bubbles: [
        { type: "text", text: "Condensed the chapter into a revision sheet." },
        { type: "artifactCard", artifactId: "artifact-os-vm" },
      ],
      time: "2026-09-01T14:01:05",
    },
  ],
  artifact: {
    id: "artifact-os-vm",
    title: "OS Revision Sheet: Virtual Memory",
    subtitle: "Study note · Generated from Textbook Ch. 9",
    markdown: `## Virtual Memory essentials

**Paging** — fixed pages/frames, page table per process, TLB caches
translations, demand paging loads on page fault.

**Page replacement** — FIFO, LRU, Optimal. LRU approximates Optimal
without future knowledge.

**Thrashing** — too little memory per process causes constant paging.
Fix with working-set model or more frames.

### Exam shortcut
Address split: page number + offset. 4KB pages = 12-bit offset.`,
  },
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
    { from: "system", text: "Last week · Operating Systems", variant: "divider" },
    {
      from: "user",
      bubbles: [
        { type: "text", text: "ext4 vs NTFS vs FAT32 — which should I compare for the exam?" },
      ],
      time: "2026-08-27T12:30:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "markdown",
          md: `### File system comparison

| Feature | FAT32 | NTFS | ext4 |
|---|---|---|---|
| Max file | 4 GB | 16 TB | 16 TB |
| Journaling | No | Yes | Yes |
| Permissions | No | ACLs | Unix + ACLs |
| Use case | USB drives | Windows | Linux |`,
        },
        {
          type: "pdf",
          title: "OS Textbook: File Systems",
          subtitle: "Textbook · Chapter 12",
          file: "/samples/os-textbook-vm.pdf",
        },
      ],
      toolCalls: [
        { name: "search", target: "OS textbook · file systems", status: "complete", duration: "57ms" },
      ],
      time: "2026-08-27T12:30:15",
      footer: "PESDac · OS",
    },
  ],
};

export const osThreads: Thread[] = [scheduling, deadlocks, virtualMemory, fileSystems];
