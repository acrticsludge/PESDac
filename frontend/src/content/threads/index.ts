import type { Thread } from "./types";
import { cnThreads } from "./cn";
import { osThreads } from "./os";
import { dlcdThreads } from "./dlcd";
import { dsaThreads } from "./dsa";
import { mathThreads } from "./math";

const byLabel: Record<string, Thread> = Object.fromEntries(
  [...cnThreads, ...osThreads, ...dlcdThreads, ...dsaThreads, ...mathThreads].map(
    (thread) => [thread.label, thread],
  ),
);

export function getThread(label: string): Thread | null {
  return byLabel[label] ?? null;
}

export type { Thread };
