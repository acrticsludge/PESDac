# Spec: Answer depth — Ask / Deep / Auto, end to end

## Status: Approved (user-defined semantics 2026-09-06) — executing.

## Definitions (user's, verbatim intent)

- **Ask**: small, low-reasoning answers. One direct hit: the definition +
  one line of application. Single-source retrieval.
- **Deep**: full chapter analysis. Definitions quoted first, full
  numbered-style walkthrough, worked check, common-mistake and exam
  framing. Multi-source retrieval (slides + textbook).
- **Auto** (default): detects from the prompt. Depth-cue phrasing →
  deep shape; everything else → ask shape.

## Auto-detection (`responder.ts`, deterministic mockup rules)

Resolved after the simulate-* and quiz branches (those intents win over
depth). Operates on the token-stripped question, case-insensitive:

```text
DEEP_RE = step by step | walk me through | in detail | more detail |
  in-depth | in depth | full chapter | whole chapter | this chapter |
  chapter analysis | analys* | elaborate | derivation | derive |
  teach me | compare and contrast
```

| Prompt | Resolves to |
|---|---|
| "what is TCP?" | ask |
| "define deadlock" | ask |
| "walk me through subnetting step by step" | deep |
| "full chapter analysis of process scheduling" | deep |
| "quiz me in detail" | quiz branch (depth never consulted) |
| "which chapter is this from?" | deep (accepted misfire — bare-chapter heuristic; backend classifier replaces it) |

Backend contract unchanged: the real classifier returns an explicit
depth per turn; `ResponseMode` already carries all three values.

## Wiring (profile → composer → responder)

1. `ResponseMode = "ask" | "deep" | "auto"` (was ask|deep); default
   `"auto"`.
2. ThreadView `composerMode: ResponseMode`, initialized from
   `getProfile().depth` (validated against the union, fallback auto).
   Seed `thread.mode` now describes authored content voice only; live
   turns follow profile default + toggle (user's global default wins).
3. Depth toggle gains **Auto** (Ask / Auto / Deep Study); button label
   follows; non-deep placeholder stays `thread.placeholder`.
4. Ask template tightened to ~3 lines (definition + one application
   line + walk-through/quiz pointers). Deep template upgraded to chapter
   shape (definitions-first, full walkthrough, worked check, don't-lose-
   marks, quiz pointer). Tool calls unchanged in kind (ask: retrieve;
   deep: retrieve + search).
5. Profile Assistant copy updated: depth applies to new messages;
   verbosity/citations/difficulty remain stored-only.

## Non-goals

Per-prompt explicit override syntax (e.g. "/deep ..."); learning the
default from behavior; touching subject-scope modes; changing seed
content or `thread.mode` values.

## Success criteria

1. Fresh profile (depth auto): "what is X?" → ask shape;
   "explain X chapter in detail" → deep shape (tool calls differ).
2. Profile depth ask/deep forces that shape regardless of phrasing
   (except quiz/simulate branches).
3. Toggle switch mid-thread changes the next turn's shape; survives
   within the session, resets to profile default on remount.
4. Quiz + all three simulate-* phrases behave exactly as before.
5. `TSC-EXIT=0`, 28-page build, no chunk-warning regression.
