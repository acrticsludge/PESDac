# Interactive bubbles — MCQ quiz + step-by-step cards

Two component bubbles (not markdown walls): an interactive multiple-choice
quiz and a stepper card for multi-step instructions (per the Wireshark
screenshot: title, current-step body, numbered dots, "View all steps",
Next). Demo seeds in the CN "TCP vs UDP" thread (`x7k2m9`), which already
ends on a quiz exchange.

## 1. Types (`content/threads/types.ts`)

```ts
export type McqOption = { label: string; detail?: string };
export type McqBubble = {
  type: "mcq";
  question: string;
  options: McqOption[]; // 3+
  answerIndex: number;
  explanation: string; // shown after first pick, win or lose
};
export type StepItem = { heading: string; body: string };
export type StepsBubble = {
  type: "steps";
  title: string;
  intro?: string; // one-line setup shown under the title
  steps: StepItem[];
};
```

Both join the `Bubble` union. Answers live in content, so checking works
fully client-side — no backend needed for the demo. Backend contract
unchanged: SSE will carry these payloads as structured blocks later
(`error-states.md` event model already allows block payloads).

## 2. Renderers (`ThreadView.tsx`, beside `StudyNoteCard`)

Astryx-only, zero custom CSS:

- `McqCard({ bubble })`: `Card variant="muted" padding={3} width="100%"
  maxWidth={560}`. Question as `Text weight="semibold"`; options as
  full-width `Button variant="secondary"` stacked in a `VStack`. Local
  `picked: number | null`. After first pick the verdict line appears
  ("Correct — …" / "Not quite — …" + `explanation`); the picked option
  flips to `primary` (correct) or `destructive` (wrong), the true answer
  flips to `primary` when the pick was wrong. Buttons stay enabled so a
  wrong pick can be retried by tapping another option. Progress line:
  "Question 1 of 1 · 4 options" is overkill — verdict line only.
- `StepsCard({ bubble })`: same Card shell. Title semibold + optional
  intro (supporting, secondary). Current step: "Step N of M" eyebrow,
  heading semibold, body. Dots row: `Button size="sm" isIconOnly`
  `label={`Go to step ${n}`}` children `{n}`, current =
  `variant="secondary"`, rest `ghost`. "View all steps" ghost button
  toggles the full list (each heading + body; current step's heading in
  accent). Footer row: Back (ghost, disabled at 0) + Next (`primary`,
  disabled on last step).
- `renderBubble` gains `mcq` / `steps` cases. State is local `useState`
  (resets on thread remount — same tradeoff as drafts-free zones;
  persisting quiz progress is backend-phase work).

## 3. Demo seed (`cn.ts`, TCP vs UDP tail)

After the existing markdown quiz turn:

- user `13:46`: "UDP, because retransmission delays would hurt a live call — the app handles ordering and loss concealment itself."
- assistant `13:46:20` (`retrieve` complete): short text ("Correct — now try one the exam way, then measure it yourself."), an `mcq`
  ("A page holds index.html + 9 images over **non-persistent** HTTP. How
  many TCP connections?" — 4 options, answer = 10 total, explanation =
  fresh connection per object), and a `steps` ("Record start/end
  timestamps for Non-Persistent", intro = the screenshot's description,
  5 steps: filter → first packet → last packet → subtract →
  sanity-check).

## 4. Corpus text (`assistantBlockText`)

- `mcq`: question + `1. label` lines + `Answer: label` + explanation.
- `steps`: title + intro + `Step n — heading: body` lines.
  (Find, copy-transcript, and retry all ride on this; nothing else
  changes. `userBlockText` untouched — users never send these.)

## 5. Explicitly out of scope

- Live "quiz me" still returns markdown (threading component payloads
  through the streaming pipeline touches `live` state + `finalizeTurn`;
  backend SSE will carry blocks natively — do it there, not twice).
- Quiz score persistence, timers, multi-question decks.
