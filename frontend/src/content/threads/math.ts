import type { Thread } from "./types";

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
    {
      from: "user",
      bubbles: [
        { type: "text", text: "How do I find the inverse of a 2x2 matrix fast?" },
      ],
      time: "2026-09-04T07:50:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "markdown",
          md: `### 2x2 inverse: swap, negate, divide

For M = [[a, b], [c, d]] with det = ad − bc (must be non-zero):

| Step | Operation |
|---|---|
| 1 | Swap a and d |
| 2 | Negate b and c |
| 3 | Divide everything by det |`,
        },
        {
          type: "code",
          title: "Worked example",
          language: "text",
          code: `M = [[4, 7], [2, 6]], det = 24 - 14 = 10
M^-1 = (1/10) * [[6, -7], [-2, 4]]
     = [[0.6, -0.7], [-0.2, 0.4]]`,
        },
        {
          type: "quiz",
          md: `### Your turn

Invert [[3, 8], [4, 6]] — and say what a zero determinant means.`,
        },
      ],
      toolCalls: [
        { name: "retrieve", target: "Math Lecture 03.pdf", status: "complete", duration: "37ms" },
      ],
      time: "2026-09-04T07:50:12",
      footer: "PESDac · Math",
    },
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
    { from: "system", text: "Yesterday · Mathematics", variant: "divider" },
    {
      from: "user",
      attachments: [
        { id: "seed-math-1", name: "math-notes-de.pdf", mime: "application/pdf", size: 876544 },
      ],
      bubbles: [
        {
          type: "mention",
          tokens: [{ value: "@math", label: "@Math", variant: "blue" }],
          text: "@math Solve y' + 2xy = x using my notes method.",
        },
      ],
      time: "2026-09-03T12:15:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "markdown",
          md: `### First-order linear: integrating factor

For y' + P(x)y = Q(x), multiply by mu = e^(integral of P dx).
Here P = 2x, so mu = e^(x^2). The left side collapses to a
derivative: d/dx [y · e^(x^2)] = x · e^(x^2). Integrate and
divide through — full steps are in your notes:`,
        },
        {
          type: "pdf",
          title: "Math Notes: Differential Equations",
          subtitle: "Study notes · worked examples",
          file: "/samples/math-notes-de.pdf",
        },
        {
          type: "quiz",
          md: `### Quick check

Why does multiplying by mu turn the left side into exactly one
derivative? Which rule runs in reverse?`,
        },
      ],
      toolCalls: [
        { name: "retrieve", target: "math-notes-de.pdf", status: "complete", duration: "48ms" },
        { name: "search", target: "Math textbook · integrating factor", status: "complete", duration: "56ms" },
      ],
      toolCallsExpanded: true,
      toolCallsAfter: 0,
      time: "2026-09-03T12:15:17",
      footer: "PESDac · Math",
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
    { from: "system", text: "Monday · Mathematics", variant: "divider" },
    {
      from: "user",
      bubbles: [
        { type: "text", text: "Teach me the 68-95-99.7 rule with a picture." },
      ],
      time: "2026-09-01T10:25:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "image",
          src: "/samples/prob-dist.svg",
          alt: "Normal distribution curve with sigma bands",
          label: "Normal curve: sigma rule",
        },
        {
          type: "markdown",
          md: `### Empirical rule (normal data)

- **~68%** within 1 sigma of the mean
- **~95%** within 2 sigma
- **~99.7%** within 3 sigma

So a 2-sigma event happens about 1 time in 20 — rare, not shocking.`,
        },
        {
          type: "quiz",
          md: `### Quick check

Test scores are normal with mean 70, sigma 10. What fraction
scores above 90? Which band is that?`,
        },
      ],
      toolCalls: [
        { name: "retrieve", target: "Math Lecture 07.pdf", status: "complete", duration: "43ms" },
      ],
      time: "2026-09-01T10:25:13",
      footer: "PESDac · Math",
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
    { from: "system", text: "Last week · Mathematics", variant: "divider" },
    {
      from: "user",
      bubbles: [
        { type: "text", text: "Why sines and cosines? Why not some other functions?" },
      ],
      time: "2026-08-25T16:40:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "markdown",
          md: `### Because they are orthogonal

Sines and cosines of different frequencies are **orthogonal**
over a period — their product integrates to zero. That makes
each coefficient independent, exactly like dot products pick
out vector components along perpendicular axes.`,
        },
        {
          type: "code",
          title: "Coefficient formulas",
          language: "text",
          code: `a0 = (1/T) * integral f(t) dt            (average)
an = (2/T) * integral f(t) cos(nwt) dt
bn = (2/T) * integral f(t) sin(nwt) dt`,
        },
      ],
      toolCalls: [
        { name: "search", target: "Math textbook · Fourier", status: "complete", duration: "59ms" },
      ],
      time: "2026-08-25T16:40:15",
      footer: "PESDac · Math",
    },
    {
      from: "assistant",
      bubbles: [
        { type: "text", text: "Collected the formulas plus a square-wave example." },
        { type: "artifactCard", artifactId: "artifact-math-fourier" },
      ],
      time: "2026-08-25T16:41:00",
    },
  ],
  artifact: {
    id: "artifact-math-fourier",
    title: "Math Revision Sheet: Fourier Series",
    subtitle: "Study note · Generated from Textbook",
    markdown: `## Fourier in one page

**Idea** — periodic f(t) = sum of sines/cosines at harmonic
frequencies. Orthogonality isolates each coefficient.

**Square wave** — odd function, so only sine terms survive:
b(n) = 4/(n·pi) for odd n, zero for even n.

**Exam shortcut** — check even/odd first: even kills all b(n),
odd kills a0 and all a(n). Half the work vanishes.`,
  },
};

export const mathThreads: Thread[] = [matrices, diffEq, probability, fourier];
