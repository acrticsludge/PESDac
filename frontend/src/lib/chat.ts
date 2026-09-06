// Central chat-route registry — single source of truth for
// /subject/[subject]/[code] URLs (shareable UniqueCode per conversation).
// UI-neutral: no Astryx imports, no styling. Backend will eventually issue
// these codes; until then they are stable constants (NOT random per load).

export const SUBJECTS = ["CN", "OS", "DLCD", "DSA", "Math"] as const;
export type Subject = (typeof SUBJECTS)[number];

export function isSubject(value: string | undefined): value is Subject {
  return (SUBJECTS as readonly string[]).includes(value ?? "");
}

// Display names (match the demo-thread divider/placeholder wording).
export const SUBJECT_NAMES: Record<Subject, string> = {
  CN: "Computer Networks",
  OS: "Operating Systems",
  DLCD: "Digital Logic",
  DSA: "Data Structures",
  Math: "Mathematics",
};

/** Display name for a subject code (unknown codes pass through). */
export function subjectDisplayName(subject: string): string {
  return (
    (SUBJECT_NAMES as Record<string, string>)[subject] ?? subject
  );
}

// Day-divider label: "----- [Day] · [Subject] -----" (divider chrome comes
// from Astryx ChatSystemMessage variant="divider"; this is the text).
export function dayDividerLabel(day: string, subject: string): string {
  return `${day} · ${subjectDisplayName(subject)}`;
}

// Stable 6-char shareable codes, one per demo conversation.
// Do NOT regenerate at runtime — deep links depend on stability.
export const CHAT_CODES: Record<string, string> = {
  "OSI Model": "a3k9m2",
  "TCP vs UDP": "x7k2m9",
  "IP Addressing & Subnetting": "b8l4n1",
  "Routing Protocols": "c9m5p3",
  "Process Scheduling": "d2n6q7",
  Deadlocks: "e4p8r2",
  "Virtual Memory": "f6q1s5",
  "File Systems": "g8r3t9",
  "Boolean Algebra": "h1s5u2",
  "K-Maps": "j3t7v4",
  "Sequential Circuits": "k5u9w6",
  "Flip-Flops": "l7v2x8",
  "Binary Trees": "m9w4y1",
  "Graph Algorithms": "n2x6z3",
  "Sorting Algorithms": "p4y8a5",
  "Dynamic Programming": "q6z1b7",
  Matrices: "r8a3c9",
  "Differential Equations": "s1b5d2",
  Probability: "t3c7e4",
  "Fourier Series": "u5d9f6",
};

export const CHAT_SUBJECTS: Record<string, Subject> = {
  "OSI Model": "CN",
  "TCP vs UDP": "CN",
  "IP Addressing & Subnetting": "CN",
  "Routing Protocols": "CN",
  "Process Scheduling": "OS",
  Deadlocks: "OS",
  "Virtual Memory": "OS",
  "File Systems": "OS",
  "Boolean Algebra": "DLCD",
  "K-Maps": "DLCD",
  "Sequential Circuits": "DLCD",
  "Flip-Flops": "DLCD",
  "Binary Trees": "DSA",
  "Graph Algorithms": "DSA",
  "Sorting Algorithms": "DSA",
  "Dynamic Programming": "DSA",
  Matrices: "Math",
  "Differential Equations": "Math",
  Probability: "Math",
  "Fourier Series": "Math",
};

export type ChatRef = { subject: Subject; label: string; code: string };

const CODE_TO_CHAT: Record<string, ChatRef> = Object.fromEntries(
  Object.entries(CHAT_CODES).map(([label, code]) => [
    code,
    { subject: CHAT_SUBJECTS[label] ?? "CN", label, code },
  ]),
);

export function getChatCode(label: string): string {
  return CHAT_CODES[label] ?? "x7k2m9";
}

export function getChatSubject(label: string): Subject {
  return CHAT_SUBJECTS[label] ?? "CN";
}

export function getChatByCode(code: string | undefined): ChatRef | null {
  if (!code) return null;
  return CODE_TO_CHAT[code] ?? null;
}

export function buildChatPath(subject: Subject, code: string): string {
  return `/subject/${subject}/${code}`;
}

export function getAllChatPaths(): Array<{ subject: Subject; code: string }> {
  return Object.entries(CHAT_CODES).map(([label, code]) => ({
    subject: getChatSubject(label),
    code,
  }));
}
