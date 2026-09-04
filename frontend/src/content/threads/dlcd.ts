import type { Thread } from "./types";

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
    {
      from: "user",
      bubbles: [
        { type: "text", text: "Simplify A + AB using Boolean laws, step by step." },
      ],
      time: "2026-09-04T09:15:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "markdown",
          md: `### A + AB = A (absorption law)

1. Factor A: **A(1 + B)**
2. Annulment: 1 + B = 1
3. Identity: **A · 1 = A**`,
        },
        {
          type: "code",
          title: "Laws used",
          language: "text",
          code: `Distributive: A + AB = A(1 + B)
Annulment:    1 + B = 1
Identity:     A . 1 = A`,
        },
        {
          type: "quiz",
          md: `### Your turn

Simplify (A + B)(A + B̅) and name each law you use.`,
        },
      ],
      toolCalls: [
        { name: "retrieve", target: "DLCD Lecture 02.pdf", status: "complete", duration: "36ms" },
      ],
      time: "2026-09-04T09:15:10",
      footer: "PESDac · DLCD",
    },
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
    { from: "system", text: "Yesterday · Digital Logic", variant: "divider" },
    {
      from: "user",
      bubbles: [
        { type: "text", text: "Show me how to group this 4-variable K-map." },
      ],
      time: "2026-09-03T16:22:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "image",
          src: "/samples/kmap.svg",
          alt: "4-variable Karnaugh map with a group of four ones",
          label: "K-map grouping example",
        },
        {
          type: "markdown",
          md: `### Grouping rules

1. Groups hold 1, 2, 4, or 8 cells (powers of two).
2. Groups can wrap around edges.
3. Cover every 1; overlap is allowed.
4. Bigger groups kill more variables.

Here the group of 4 keeps only the literals that never change:
**A · B̅ · C**.`,
        },
        {
          type: "quiz",
          md: `### Quick check

Why must groups be powers of two? What breaks with a group of 3?`,
        },
      ],
      toolCalls: [
        { name: "search", target: "DLCD textbook · K-maps", status: "complete", duration: "52ms" },
      ],
      time: "2026-09-03T16:22:16",
      footer: "PESDac · DLCD",
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
    { from: "system", text: "Monday · Digital Logic", variant: "divider" },
    {
      from: "user",
      bubbles: [
        { type: "text", text: "Combinational vs sequential — what's the one-line difference?" },
      ],
      time: "2026-09-01T11:45:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "markdown",
          md: `### The difference is memory

| Aspect | Combinational | Sequential |
|---|---|---|
| Output depends on | Present inputs only | Inputs + past state |
| Memory | None | Flip-flops/registers |
| Clock | Not needed | Required (sync) |
| Examples | MUX, adder, decoder | Counter, register, FSM |`,
        },
        {
          type: "image",
          src: "/samples/seq-circuit.svg",
          alt: "Block diagram of a synchronous sequential circuit",
          label: "Sequential circuit structure",
        },
      ],
      toolCalls: [
        { name: "retrieve", target: "DLCD Lecture 06.pdf", status: "complete", duration: "41ms" },
        { name: "retrieve", target: "DLCD lecture recording · FSM", status: "complete", duration: "83ms" },
      ],
      toolCallsExpanded: true,
      toolCallsAfter: 0,
      time: "2026-09-01T11:45:12",
      footer: "PESDac · DLCD",
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
    { from: "system", text: "Last week · Digital Logic", variant: "divider" },
    {
      from: "user",
      bubbles: [
        {
          type: "mention",
          tokens: [{ value: "@dlcd", label: "@DLCD", variant: "blue" }],
          text: "@dlcd SR vs JK vs D vs T — when do I use each?",
        },
      ],
      time: "2026-08-29T13:10:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "image",
          src: "/samples/flipflop.svg",
          alt: "JK flip-flop symbol and behavior summary",
          label: "JK flip-flop reference",
        },
        {
          type: "markdown",
          md: `### Pick the right flip-flop

| Type | Use it when |
|---|---|
| SR | Teaching basics (avoid S=R=1) |
| JK | Universal — builds counters, any behavior |
| D | Data storage, shift registers, pipelines |
| T | Toggle dividers, binary counters |`,
        },
      ],
      toolCalls: [
        { name: "search", target: "DLCD textbook · flip-flops", status: "complete", duration: "55ms" },
      ],
      time: "2026-08-29T13:10:14",
      footer: "PESDac · DLCD",
    },
    {
      from: "assistant",
      bubbles: [
        { type: "text", text: "Made you a one-page flip-flop reference." },
        { type: "artifactCard", artifactId: "artifact-dlcd-ff" },
      ],
      time: "2026-08-29T13:11:02",
    },
  ],
  artifact: {
    id: "artifact-dlcd-ff",
    title: "DLCD Revision Sheet: Flip-Flops",
    subtitle: "Study note · Generated from Textbook",
    markdown: `## SR, JK, D, T in one page

**SR** — S sets, R resets. S=R=1 is forbidden (race).
**JK** — J/K behave like S/R, but J=K=1 toggles. Universal.
**D** — Q follows D on clock edge. One input, no invalid state.
**T** — T=1 toggles, T=0 holds. Divide frequency by 2 per stage.

### Exam shortcut
Characteristic equations:
Q(next) = J·Q̅ + K̅·Q (JK) · Q(next) = D (D) · Q(next) = T⊕Q (T)`,
  },
};

export const dlcdThreads: Thread[] = [booleanAlgebra, kmaps, sequential, flipflops];
