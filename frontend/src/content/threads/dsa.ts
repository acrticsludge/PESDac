import type { Thread } from "./types";

const binaryTrees: Thread = {
  label: "Binary Trees",
  subject: "DSA",
  mode: "ask",
  placeholder: "Ask anything about DSA...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Textbook", description: "PESDac knowledge source" },
  ],
  divider: "Today · Data Structures",
  blocks: [
    { from: "system", text: "Today · Data Structures", variant: "divider" },
    {
      from: "user",
      bubbles: [
        { type: "text", text: "Explain inorder traversal with an example tree." },
      ],
      time: "2026-09-04T08:30:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "image",
          src: "/samples/binary-tree.svg",
          alt: "Binary search tree with traversal order labeled",
          label: "Example BST for traversal",
        },
        {
          type: "code",
          title: "Inorder — iterative",
          language: "python",
          code: `def inorder(root):
    stack, out, cur = [], [], root
    while stack or cur:
        while cur:
            stack.append(cur)
            cur = cur.left
        cur = stack.pop()
        out.append(cur.val)
        cur = cur.right
    return out  # [1, 3, 6, 8, 10, 14]`,
        },
        {
          type: "quiz",
          md: `### Quick check

What does the same tree print in **preorder**? Write the sequence.`,
        },
      ],
      toolCalls: [
        { name: "retrieve", target: "DSA Lecture 05.pdf", status: "complete", duration: "39ms" },
        { name: "search", target: "DSA textbook · tree traversal", status: "complete", duration: "53ms" },
      ],
      toolCallsExpanded: true,
      toolCallsAfter: 0,
      time: "2026-09-04T08:30:13",
      footer: "PESDac · DSA",
    },
  ],
};

const graphs: Thread = {
  label: "Graph Algorithms",
  subject: "DSA",
  mode: "deep",
  placeholder: "Ask for a deep, step-by-step explanation...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Textbook", description: "PESDac knowledge source" },
  ],
  divider: "Yesterday · Data Structures",
  blocks: [
    { from: "system", text: "Yesterday · Data Structures", variant: "divider" },
    {
      from: "user",
      bubbles: [
        { type: "text", text: "BFS vs DFS — when is each the right choice?" },
      ],
      time: "2026-09-03T17:12:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "markdown",
          md: `### BFS vs DFS

| Aspect | BFS | DFS |
|---|---|---|
| Structure | Queue | Stack / recursion |
| Finds | Shortest path (unweighted) | Any path, components |
| Memory | Wide graphs hurt | Deep graphs hurt |
| Use | Social distance, routing | Maze, topo sort, SCC |`,
        },
        {
          type: "code",
          title: "BFS skeleton",
          language: "python",
          code: `from collections import deque

def bfs(graph, start):
    seen = {start}
    q = deque([start])
    while q:
        u = q.popleft()
        for v in graph[u]:
            if v not in seen:
                seen.add(v)
                q.append(v)
    return seen`,
        },
      ],
      toolCalls: [
        { name: "search", target: "DSA textbook · BFS DFS", status: "complete", duration: "60ms" },
      ],
      time: "2026-09-03T17:12:18",
      footer: "PESDac · DSA",
    },
  ],
};

const sorting: Thread = {
  label: "Sorting Algorithms",
  subject: "DSA",
  mode: "ask",
  placeholder: "Ask anything about DSA...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
  ],
  divider: "Monday · Data Structures",
  blocks: [
    { from: "system", text: "Monday · Data Structures", variant: "divider" },
    {
      from: "user",
      bubbles: [
        {
          type: "mention",
          tokens: [{ value: "@dsa", label: "@DSA", variant: "blue" }],
          text: "@dsa Give me the sorting comparison I need for interviews.",
        },
      ],
      time: "2026-09-01T19:45:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "markdown",
          md: `### Sorting at a glance

| Algorithm | Best | Avg / Worst | Stable | In-place |
|---|---|---|---|---|
| Merge sort | n log n | n log n | Yes | No |
| Quick sort | n log n | n log n / n^2 | No | Yes |
| Heap sort | n log n | n log n | No | Yes |
| Counting sort | n + k | n + k | Yes | No |`,
        },
      ],
      toolCalls: [
        { name: "retrieve", target: "DSA Lecture 03.pdf", status: "complete", duration: "42ms" },
      ],
      time: "2026-09-01T19:45:11",
      footer: "PESDac · DSA",
    },
    {
      from: "assistant",
      bubbles: [
        { type: "text", text: "Saved the table plus pivot-picking rules as a cheat sheet." },
        { type: "artifactCard", artifactId: "artifact-dsa-sorting" },
      ],
      time: "2026-09-01T19:46:03",
    },
  ],
  artifact: {
    id: "artifact-dsa-sorting",
    title: "DSA Cheat Sheet: Sorting",
    subtitle: "Study note · Generated from Course Slides",
    markdown: `## Sorting cheat sheet

**Need stability?** Merge sort (or Timsort in practice).
**Need in-place?** Quick sort average-case, heap sort guaranteed.
**Small integers?** Counting sort beats n log n.
**Interviews:** know quick sort's partition cold, and why worst
case is sorted input with a naive pivot.`,
  },
};

const dp: Thread = {
  label: "Dynamic Programming",
  subject: "DSA",
  mode: "deep",
  placeholder: "Ask for a deep, step-by-step explanation...",
  composerReferenceItems: [
    { label: "Textbook", description: "PESDac knowledge source" },
    { label: "Lecture Recordings", description: "PESDac knowledge source" },
  ],
  divider: "Last week · Data Structures",
  blocks: [
    { from: "system", text: "Last week · Data Structures", variant: "divider" },
    {
      from: "user",
      bubbles: [
        { type: "text", text: "I keep brute-forcing recursion. How do I spot DP?" },
      ],
      time: "2026-08-26T20:05:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "markdown",
          md: `### Two signals: overlap + optimal substructure

1. **Overlapping subproblems** — naive recursion recomputes the
   same states (Fibonacci recomputes fib(3) many times).
2. **Optimal substructure** — the answer builds from answers to
   smaller inputs (knapsack, edit distance).`,
        },
        {
          type: "code",
          title: "Memoization turns it linear",
          language: "python",
          code: `from functools import lru_cache

@lru_cache(maxsize=None)
def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

# fib(100) instantly: O(n) time, O(n) states`,
        },
      ],
      toolCalls: [
        { name: "retrieve", target: "DSA Lecture 09.pdf", status: "complete", duration: "46ms" },
        { name: "retrieve", target: "DSA lecture recording · DP", status: "complete", duration: "90ms" },
      ],
      toolCallsExpanded: true,
      toolCallsAfter: 0,
      time: "2026-08-26T20:05:16",
      footer: "PESDac · DSA",
    },
  ],
};

export const dsaThreads: Thread[] = [binaryTrees, graphs, sorting, dp];
