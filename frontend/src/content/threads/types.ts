// Typed content model for data-driven demo threads.
// Mirrors the backend message shapes from docs/audits/2026-09-04-monolith-to-backend-audit.md (§3.2).

export type ToolCallName = "retrieve" | "search" | "generate";

export type ToolCall = {
  name: ToolCallName;
  target: string;
  // "error" renders Astryx's failed row (tooltip + icon) natively.
  status: "running" | "complete" | "error";
  duration: string;
  errorMessage?: string;
};

export type Attachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
};

export type MentionToken = {
  value: string;
  label: string;
  variant: "blue";
};

export type TextBubble = { type: "text"; text: string };
export type MarkdownBubble = { type: "markdown"; md: string };
export type CodeBubble = {
  type: "code";
  title: string;
  language: string;
  code: string;
};
export type MentionBubble = {
  type: "mention";
  tokens: MentionToken[];
  text: string;
};
export type ImageBubble = {
  type: "image";
  src: string;
  alt: string;
  label: string;
};
export type PdfBubble = {
  type: "pdf";
  title: string;
  subtitle: string;
  file: string;
};
export type ArtifactBubble = { type: "artifactCard"; artifactId: string };
export type QuizBubble = { type: "quiz"; md: string };

export type Bubble =
  | TextBubble
  | MarkdownBubble
  | CodeBubble
  | MentionBubble
  | ImageBubble
  | PdfBubble
  | ArtifactBubble
  | QuizBubble;

export type UserBlock = {
  from: "user";
  bubbles: Bubble[];
  attachments?: Attachment[];
  time: string;
};

export type AssistantBlock = {
  from: "assistant";
  bubbles: Bubble[];
  toolCalls?: ToolCall[];
  toolCallsExpanded?: boolean;
  /** Bubble index after which tool calls render (default: end). */
  toolCallsAfter?: number;
  /** Footer line under the timestamp (e.g. "PESDac · CN"). Omit for time only. */
  footer?: string;
  /** Follow-up suggestions persisted with a live turn (mockup stage). */
  followUps?: string[];
  /** Failed turn: renders a notice + Retry instead of (or under) content. */
  error?: {
    kind: "failed" | "empty";
    retryText: string;
  };
  time: string;
};

export type SystemBlock = {
  from: "system";
  text: string;
  variant?: "divider";
};

export type Block = UserBlock | AssistantBlock | SystemBlock;

export type Artifact = {
  id: string;
  title: string;
  subtitle: string;
  markdown: string;
};

export type Thread = {
  label: string;
  subject: string;
  mode: "ask" | "deep";
  placeholder: string;
  composerReferenceItems: { label: string; description: string }[];
  divider: string;
  blocks: Block[];
  artifact?: Artifact;
};
