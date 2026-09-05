"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

import {
  Layout,
  LayoutContent,
  VStack,
  HStack,
} from "@astryxdesign/core/Layout";
import { Text, Heading } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { Token } from "@astryxdesign/core/Token";
import { Thumbnail } from "@astryxdesign/core/Thumbnail";
import { Lightbox } from "@astryxdesign/core/Lightbox";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Card } from "@astryxdesign/core/Card";
import { Section } from "@astryxdesign/core/Section";
import { Markdown } from "@astryxdesign/core/Markdown";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Button } from "@astryxdesign/core/Button";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import {
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  ChatSystemMessage,
  ChatTokenizedText,
  ChatToolCalls,
  ChatComposer,
  ChatComposerDrawer,
  ChatComposerInput,
  ChatDictationButton,
  useChatDictation,
  type ChatComposerInputHandle,
  type ChatComposerTrigger,
} from "@astryxdesign/core/Chat";
import {
  createStaticSource,
  TypeaheadItem,
} from "@astryxdesign/core/Typeahead";
import AttachButton from "./AttachButton";
import { useResizable, ResizeHandle } from "@astryxdesign/core/Resizable";

import {
  DocumentTextIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  ShareIcon,
  XMarkIcon,
  ChevronRightIcon,
  AtSymbolIcon,
  ArrowPathIcon,
  EllipsisHorizontalIcon,
} from "@heroicons/react/24/outline";

import type {
  Artifact,
  AssistantBlock,
  Attachment,
  Block,
  Bubble,
  Thread,
  ToolCall,
  UserBlock,
} from "../../content/threads/types";
import { REFERENCE_ITEMS, referenceIdForLabel } from "../../lib/references";
import { dayDividerLabel } from "../../lib/chat";
import {
  stageFiles,
  revokeStaged,
  attachmentLabel,
  type StagedFile,
} from "../../lib/attachments";
import {
  useSessionVersion,
  useMounted,
  useStorageHealth,
  getOverlay,
  appendBlocks,
  removeLastOverlayBlock,
} from "../../lib/session";
import { planResponse } from "../../lib/responder";

/* -------------------------------------------------------------------------- */
/*                     Thread artifact panel styling                           */
/* -------------------------------------------------------------------------- */

const artifactPanelWidthVar = (size: number | string): CSSProperties =>
  ({
    "--cn-artifact-panel-width": typeof size === "number" ? `${size}px` : size,
  }) as CSSProperties;

const THREAD_CSS = `
.pesdac-cn-artifact-panel {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  width: var(--cn-artifact-panel-width);
  flex-shrink: 0;
}
@container pesdac-cn-chat (max-width: 767px) {
  .pesdac-cn-artifact-panel {
    display: none;
  }
  .pesdac-cn-artifact-resize {
    display: none;
  }
}
`;

function StudyNoteCard({
  artifact,
  onOpen,
}: {
  artifact: Artifact;
  onOpen: () => void;
}) {
  return (
    <ClickableCard
      label={`Open ${artifact.title}`}
      onClick={onOpen}
      variant="muted"
      padding={3}
      maxWidth={380}
    >
      <HStack gap={3} vAlign="center" width="100%">
        <Icon icon={DocumentTextIcon} size="md" color="secondary" />
        <VStack gap={0} style={{ flex: 1 }}>
          <Text type="label" weight="semibold">
            {artifact.title}
          </Text>
          <Text type="supporting" color="secondary">
            Study note
          </Text>
        </VStack>
        <Icon icon={ChevronRightIcon} size="sm" color="secondary" />
      </HStack>
    </ClickableCard>
  );
}

function StudyNoteBody({ artifact }: { artifact: Artifact }) {
  return (
    <Section variant="transparent" style={{ flex: 1, overflowY: "auto" }}>
      <VStack gap={2} style={{ maxWidth: 720, marginInline: "auto" }}>
        <Heading level={1}>{artifact.title}</Heading>
        <Markdown>{artifact.markdown}</Markdown>
      </VStack>
    </Section>
  );
}

function StudyNoteActions({
  onCopy,
  onClose,
}: {
  onCopy?: () => void;
  onClose?: () => void;
}) {
  return (
    <>
      <Button
        label="Copy"
        variant="ghost"
        size="sm"
        icon={<Icon icon={ClipboardDocumentIcon} size="sm" />}
        isIconOnly
        onClick={onCopy}
      />
      <Button
        label="Share"
        variant="ghost"
        size="sm"
        icon={<Icon icon={ShareIcon} size="sm" />}
        isIconOnly
      />
      {onClose && (
        <Button
          label="Close study note"
          variant="ghost"
          size="sm"
          icon={<Icon icon={XMarkIcon} size="sm" />}
          isIconOnly
          onClick={onClose}
        />
      )}
    </>
  );
}

function PdfPreviewBody({ file, title }: { file: string; title: string }) {
  return (
    <Section
      variant="transparent"
      style={{ flex: 1, display: "flex", minHeight: 0 }}
    >
      {/* No Astryx PDF renderer exists; a bare embed inside Astryx chrome
          is the documented exception (see demo-threads spec). */}
      <object
        data={file}
        type="application/pdf"
        title={title}
        style={{ flex: 1, width: "100%", minHeight: 0, border: 0 }}
      >
        <Text type="body">
          Preview unavailable. <a href={file}>Open the PDF directly.</a>
        </Text>
      </object>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Thread view                                    */
/* -------------------------------------------------------------------------- */

// Same @ reference menu as the welcome composer (per-thread labels resolve
// to source ids for the responder via referenceIdForLabel).
const threadReferenceTrigger: ChatComposerTrigger = {
  character: "@",

  searchSource: createStaticSource(REFERENCE_ITEMS),

  renderItem: (item) => (
    <TypeaheadItem
      item={item}
      description={(item.auxiliaryData as { type: string })?.type}
    />
  ),

  onSelect: (item) => ({
    value: `@${item.id}`,
    label: item.label,
    variant: "blue",
  }),
};

// Plain-text extraction for retry/regenerate (non-text bubbles contribute
// nothing — attachments travel on the saved user message already).
function userBlockText(block: UserBlock): string {
  return block.bubbles
    .map((b) => {
      switch (b.type) {
        case "text":
          return b.text;
        case "markdown":
        case "quiz":
          return b.md;
        case "code":
          return b.code;
        case "mention":
          return b.text;
        default:
          return "";
      }
    })
    .join("\n")
    .trim();
}

function lastUserText(blocks: Block[]): string {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.from === "user") return userBlockText(b);
  }
  return "";
}

// Best-effort clipboard copy (falls back to execCommand where the async
// API is unavailable); resolves false when nothing worked.
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

// Ghost icon button with brief "copied" feedback.
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <Button
      label={copied ? "Copied" : label}
      variant="ghost"
      size="sm"
      isIconOnly
      // md icon: Heroicons outline is drawn on a 24px grid, so 20px renders
      // markedly crisper than 16px (sm) for these small action buttons.
      icon={<Icon icon={copied ? CheckIcon : ClipboardDocumentIcon} size="md" />}
      onClick={() => {
        void copyText(text).then((ok) => {
          if (!ok) return;
          setCopied(true);
          if (timer.current != null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    />
  );
}

// Assistant turn as copyable markdown (code stays fenced, media degrades
// to a labelled placeholder line).
function assistantBlockText(block: AssistantBlock): string {
  return block.bubbles
    .map((b) => {
      switch (b.type) {
        case "markdown":
        case "quiz":
          return b.md;
        case "text":
          return b.text;
        case "mention":
          return b.text;
        case "code":
          return `\`\`\`${b.language}\n${b.code}\n\`\`\``;
        case "image":
          return `[image: ${b.alt}]`;
        case "pdf":
          return `[PDF: ${b.title}]`;
        case "artifactCard":
          return "";
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

// Ghost icon button shared by both message footers.
function RegenerateButton({ onRegenerate }: { onRegenerate: () => void }) {
  return (
    <Button
      label="Regenerate response"
      variant="ghost"
      size="sm"
      isIconOnly
      // md icon — see CopyButton note on Heroicons crispness.
      icon={<Icon icon={ArrowPathIcon} size="md" />}
      onClick={onRegenerate}
    />
  );
}

// Whole conversation as markdown (for the Copy transcript action).
function buildTranscript(thread: Thread, blocks: Block[]): string {
  const lines = [`# ${thread.label} (${thread.subject})`, ""];
  for (const b of blocks) {
    if (b.from === "system") {
      lines.push(`--- ${b.text} ---`, "");
    } else if (b.from === "user") {
      const atts = (b.attachments ?? []).map((a) => a.name);
      lines.push(`**You:** ${userBlockText(b)}`);
      if (atts.length > 0) lines.push(`_Attached: ${atts.join(", ")}_`);
      lines.push("");
    } else {
      const text = assistantBlockText(b);
      if (text) lines.push(text);
      if (b.toolCalls && b.toolCalls.length > 0) {
        const sources = b.toolCalls
          .map((t) => `${t.target}${t.duration ? ` (${t.duration})` : ""}`)
          .join("; ");
        lines.push(`_Sources: ${sources}_`);
      }
      if (b.error) {
        lines.push(
          b.error.kind === "empty"
            ? "_PESDac returned an empty response._"
            : "_Response interrupted before it finished._",
        );
      }
      lines.push("");
    }
  }
  return lines.join("\n").trim();
}

export default function ThreadView({
  thread,
  sessionKey,
  autoSend,
}: {
  thread: Thread;
  sessionKey: string;
  autoSend?: string | { text: string; attachments?: Attachment[] };
}) {
  const [composerMode, setComposerMode] = useState<"ask" | "deep">(thread.mode);
  const [isArtifactOpen, setIsArtifactOpen] = useState(thread.artifact != null);
  const [isArtifactDialogOpen, setIsArtifactDialogOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(
    null,
  );
  const [pdfOpen, setPdfOpen] = useState<{
    title: string;
    subtitle: string;
    file: string;
  } | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const composerInputRef = useRef<ChatComposerInputHandle>(null);
  const dictation = useChatDictation({
    inputRef: composerInputRef,
  });
  // Staged uploads (metadata persists with the sent message; File handles
  // and preview URLs stay in memory until send/remove).
  const [attachments, setAttachments] = useState<StagedFile[]>([]);
  // Copy-transcript menu feedback.
  const [transcriptCopied, setTranscriptCopied] = useState(false);

  // Session overlay: blocks appended this session (persisted per code).
  // Gated on mount so SSR and first client paint agree (see useMounted).
  useSessionVersion();
  const mounted = useMounted();
  const storageOk = useStorageHealth();
  const overlay = mounted ? getOverlay(sessionKey) : [];
  const blocks = [...thread.blocks, ...overlay];

  // Follow-ups from the latest assistant turn (live turns persist theirs).
  const followUps = (() => {
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b.from === "assistant" && b.followUps && b.followUps.length > 0)
        return b.followUps;
    }
    return null;
  })();

  // Live turn: simulated assistant response (streaming state, not persisted
  // until complete — backend will replace planResponse with SSE).
  const [live, setLive] = useState<null | {
    tools: ToolCall[];
    text: string;
    full: string;
    followUps: string[];
  }>(null);
  // Rate-limit state (mockup: simulated; backend: HTTP 429): the user
  // message is already saved, retry resumes without duplicating it.
  const [sendError, setSendError] = useState<{
    text: string;
    message: string;
  } | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    },
    [],
  );

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const makeErrorBlock = (
    kind: "failed" | "empty",
    retryText: string,
    partial?: string,
  ): AssistantBlock => ({
    from: "assistant",
    bubbles: partial?.trim() ? [{ type: "markdown", md: partial.trim() }] : [],
    error: { kind, retryText },
    time: new Date().toISOString(),
    footer: `PESDac · ${thread.subject}`,
  });

  // Tools settle as complete whenever a turn persists (stop included) — a
  // saved turn must never show a perpetually-"running" chip.
  const settleTools = (tools: ToolCall[]): ToolCall[] =>
    tools.map((t) =>
      t.status === "running"
        ? {
            ...t,
            status: "complete" as const,
            duration: t.duration || "stopped",
          }
        : t,
    );

  const finalizeTurn = (
    tools: ToolCall[],
    text: string,
    followUps: string[],
    retryText?: string,
  ) => {
    const trimmed = text.trim();
    if (trimmed) {
      appendBlocks(sessionKey, [
        {
          from: "assistant",
          bubbles: [{ type: "markdown", md: trimmed }],
          toolCalls: settleTools(tools),
          followUps,
          time: new Date().toISOString(),
          footer: `PESDac · ${thread.subject}`,
        },
      ]);
    } else if (retryText) {
      // Empty model response: say so with a retry, never go silent.
      appendBlocks(sessionKey, [makeErrorBlock("empty", retryText)]);
    }
    setLive(null);
  };

  // Mid-stream abort (mockup: simulated; backend: disconnect/5xx): keep the
  // partial text and offer a retry that resumes without duplicating the
  // user's message.
  const failTurn = (tools: ToolCall[], partial: string, retryText: string) => {
    const block = makeErrorBlock("failed", retryText, partial);
    block.toolCalls = settleTools(tools);
    appendBlocks(sessionKey, [block]);
    setLive(null);
  };

  // Assistant side of a turn: plan, stream, settle. handleSend owns the
  // user message; retry/regenerate re-enter here directly (no duplicate).
  const startTurn = (text: string, opts?: { forceOk?: boolean }) => {
    if (live) return;
    const plan = planResponse(text, thread.subject, composerMode);
    if (plan.error === "rate-limited" && !opts?.forceOk) {
      setSendError({
        text,
        message: "Too many requests — wait a few seconds, then retry.",
      });
      return;
    }
    if (plan.error === "empty" && !opts?.forceOk) {
      appendBlocks(sessionKey, [makeErrorBlock("empty", text)]);
      return;
    }
    const failAt = plan.error === "stream-failed" && !opts?.forceOk;
    const running = plan.toolCalls.map((t) => ({ ...t, status: "running" as const, duration: "" }));
    setLive({ tools: running, text: "", full: plan.answer, followUps: plan.followUps });
    later(700, () => {
      const words = plan.answer.split(/(\s+)/);
      let i = 0;
      const step = () => {
        i += 2;
        const partial = words.slice(0, i).join("");
        if (failAt && i >= Math.max(2, Math.floor(words.length / 2))) {
          failTurn(plan.toolCalls, partial, text);
          return;
        }
        if (i >= words.length) {
          finalizeTurn(plan.toolCalls, plan.answer, plan.followUps, text);
          return;
        }
        setLive({ tools: plan.toolCalls, text: partial, full: plan.answer, followUps: plan.followUps });
        // Demo pacing (slow on purpose so stop is testable; backend
        // streams at its own rate later).
        later(80, step);
      };
      setLive({ tools: plan.toolCalls, text: "", full: plan.answer, followUps: plan.followUps });
      later(150, step);
    });
  };

  const handleSend = (value: string, staged: StagedFile[] = attachments) => {
    const text = value.trim();
    if (!text || live) return;
    setSendError(null);
    // Day break: new messages on a later day than the last one get a
    // "Today · Subject" divider first (mockup label; backend sends real dates).
    let needsDayDivider = false;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b.from === "user" || b.from === "assistant") {
        const t = new Date(b.time).getTime();
        needsDayDivider =
          Number.isNaN(t) ||
          new Date(t).toDateString() !== new Date().toDateString();
        break;
      }
    }
    appendBlocks(sessionKey, [
      ...(needsDayDivider
        ? [
            {
              from: "system",
              text: dayDividerLabel("Today", thread.subject),
              variant: "divider",
            } as const,
          ]
        : []),
      {
        from: "user",
        bubbles: [{ type: "text", text }],
        ...(staged.length > 0
          ? { attachments: staged.map((s) => s.att) }
          : {}),
        time: new Date().toISOString(),
      },
    ]);
    // Staged files travel with this message; clear the drawer either way.
    setAttachments([]);
    revokeStaged(staged);
    startTurn(text);
  };

  // Rate-limit retry: resume the saved prompt, bypassing the simulation.
  const handleRetry = () => {
    if (!sendError || live) return;
    const { text } = sendError;
    setSendError(null);
    startTurn(text, { forceOk: true });
  };

  // Regenerate lives beside the assistant message's copy action, never on
  // the user's own message: re-run the last turn. Session-added assistant
  // turn → pop it and replay the prompt. Static demo tails are immutable,
  // so no regenerate there. (The trailing-user branch below is a fallback
  // for stopped-before-answer turns; it has no button of its own.)
  const isLastSessionTurn = (index: number) =>
    index === blocks.length - 1 && blocks.length > thread.blocks.length;
  const canRegenerateNow = live == null && sendError == null;

  const handleRegenerate = () => {
    if (!canRegenerateNow || live) return;
    if (blocks.length <= thread.blocks.length) return;
    const last = blocks[blocks.length - 1];
    if (last.from === "assistant") {
      const text =
        last.error?.retryText ?? lastUserText(blocks.slice(0, -1));
      if (!text) return;
      if (!removeLastOverlayBlock(sessionKey)) return;
      setSendError(null);
      startTurn(text);
    } else if (last.from === "user") {
      const text = userBlockText(last);
      if (!text) return;
      setSendError(null);
      startTurn(text);
    }
  };

  const handleStop = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    if (live) finalizeTurn(live.tools, live.text, live.followUps);
    else setLive(null);
  };

  // Reference menu → composer (same token shape as welcome).
  const insertReference = (label: string) => {
    const input = composerInputRef.current;

    if (!input) {
      return;
    }

    input.focus();

    input.insertToken({
      value: `@${referenceIdForLabel(label)}`,
      label,
      variant: "blue",
    });

    document.activeElement?.dispatchEvent(
      new Event("input", {
        bubbles: true,
      }),
    );
  };

  // Transcript export (markdown to clipboard; share links are backend's).
  const copyTranscript = () => {
    void copyText(buildTranscript(thread, blocks)).then((ok) => {
      if (!ok) return;
      setTranscriptCopied(true);
      later(1500, () => setTranscriptCopied(false));
    });
  };

  const removeStaged = (id: string) => {
    const target = attachments.find((s) => s.att.id === id);
    if (target) revokeStaged([target]);
    setAttachments((prev) => prev.filter((s) => s.att.id !== id));
  };

  // Files from picker, drop, or paste all land in the drawer.
  const stageIntoDrawer = (files: File[]) => {
    if (files.length === 0) return;
    setAttachments((prev) => [...prev, ...stageFiles(files)]);
  };

  // First message typed on welcome: run it once the thread mounts.
  const autoSendRef = useRef<typeof autoSend>(autoSend);
  useEffect(() => {
    if (autoSendRef.current) {
      const payload = autoSendRef.current;
      autoSendRef.current = undefined;
      const text = typeof payload === "string" ? payload : payload.text;
      const staged: StagedFile[] =
        typeof payload === "string"
          ? []
          : (payload.attachments ?? []).map((att) => ({ att }));
      const t = window.setTimeout(() => handleSend(text, staged), 350);
      return () => window.clearTimeout(t);
    }
  }, []);

  const artifactResize = useResizable({
    defaultSize: 520,
    minSizePx: 420,
    maxSizePx: 760,
    autoSaveId: `pesdac-study-note-${thread.label}`,
  });

  const openStudyNote = () => {
    if ((rootRef.current?.offsetWidth ?? Infinity) <= 767) {
      setIsArtifactDialogOpen(true);
    } else {
      setIsArtifactOpen(true);
    }
  };

  const renderBubble = (bubble: Bubble, key: number) => {
    switch (bubble.type) {
      case "text":
        return <Text key={key}>{bubble.text}</Text>;
      case "markdown":
        return (
          <Markdown key={key} density="compact">
            {bubble.md}
          </Markdown>
        );
      case "quiz":
        return (
          <Markdown key={key} density="compact">
            {bubble.md}
          </Markdown>
        );
      case "code":
        return (
          <CodeBlock
            key={key}
            title={bubble.title}
            language={bubble.language}
            code={bubble.code}
          />
        );
      case "mention":
        return (
          <ChatTokenizedText key={key} tokens={bubble.tokens}>
            {bubble.text}
          </ChatTokenizedText>
        );
      case "image":
        return (
          <Thumbnail
            key={key}
            src={bubble.src}
            alt={bubble.alt}
            label={bubble.label}
            onClick={() =>
              setLightbox({ src: bubble.src, alt: bubble.alt })
            }
          />
        );
      case "pdf":
        return (
          <ClickableCard
            key={key}
            label={`Open ${bubble.title}`}
            onClick={() =>
              setPdfOpen({
                title: bubble.title,
                subtitle: bubble.subtitle,
                file: bubble.file,
              })
            }
            variant="muted"
            padding={3}
            maxWidth={380}
          >
            <HStack gap={3} vAlign="center" width="100%">
              <Icon icon={DocumentTextIcon} size="md" color="secondary" />
              <VStack gap={0} style={{ flex: 1 }}>
                <Text type="label" weight="semibold">
                  {bubble.title}
                </Text>
                <Text type="supporting" color="secondary">
                  {bubble.subtitle}
                </Text>
              </VStack>
              <Icon icon={ChevronRightIcon} size="sm" color="secondary" />
            </HStack>
          </ClickableCard>
        );
      case "artifactCard": {
        const artifact =
          thread.artifact?.id === bubble.artifactId ? thread.artifact : null;
        if (!artifact) return null;
        return (
          <StudyNoteCard key={key} artifact={artifact} onOpen={openStudyNote} />
        );
      }
    }
  };

  const renderUserBlock = (block: UserBlock, key: number) => (
    <ChatMessage key={key} sender="user">
      {block.attachments && block.attachments.length > 0 && (
        <HStack gap={1} wrap="wrap">
          {block.attachments.map((att) => (
            <Token key={att.id} label={attachmentLabel(att)} />
          ))}
        </HStack>
      )}
      {block.bubbles.map((bubble, i) => {
        const isFirst = i === 0;
        const isLast = i === block.bubbles.length - 1;
        const group =
          block.bubbles.length > 1
            ? isFirst
              ? "first"
              : isLast
                ? "last"
                : "middle"
            : undefined;
        return (
          <ChatMessageBubble
            key={i}
            group={group}
            metadata={
              isLast ? (
                <ChatMessageMetadata
                  timestamp={
                    <Timestamp value={block.time} format="time" />
                  }
                />
              ) : undefined
            }
          >
            {renderBubble(bubble, i)}
          </ChatMessageBubble>
        );
      })}
    </ChatMessage>
  );

  const renderAssistantBlock = (
    block: AssistantBlock,
    key: number,
    showRegenerate: boolean,
  ) => {
    const after = block.toolCallsAfter ?? block.bubbles.length - 1;
    const error = block.error;
    const toolCalls =
      block.toolCalls && block.toolCalls.length > 0 ? (
        <ChatToolCalls
          key="tools"
          defaultIsExpanded={block.toolCallsExpanded}
          calls={block.toolCalls}
        />
      ) : null;
    return (
      <ChatMessage
        key={key}
        sender="assistant"
        avatar={<Avatar name="PESDac" size="md" />}
      >
        {block.bubbles.flatMap((bubble, i) => {
          const nodes = [
            bubble.type === "artifactCard" ? (
              <ChatMessageBubble key={`b${i}`} variant="ghost" width="100%">
                {renderBubble(bubble, i)}
              </ChatMessageBubble>
            ) : (
              <ChatMessageBubble key={`b${i}`} variant="ghost">
                {renderBubble(bubble, i)}
              </ChatMessageBubble>
            ),
          ];
          if (i === after && toolCalls) nodes.push(toolCalls);
          return nodes;
        })}
        {/* Empty-bubble error turns still show their tool calls. */}
        {after >= block.bubbles.length || block.bubbles.length === 0
          ? toolCalls
          : null}
        {error && (
          <ChatMessageBubble variant="ghost">
            <HStack gap={2} vAlign="center">
              <Text type="supporting" color="secondary">
                {error.kind === "empty"
                  ? "PESDac returned an empty response."
                  : "This response was interrupted before it finished."}
              </Text>
              <Button
                label="Retry"
                variant="ghost"
                size="sm"
                onClick={() => startTurn(error.retryText, { forceOk: true })}
              />
            </HStack>
          </ChatMessageBubble>
        )}
        <ChatMessageMetadata
          timestamp={<Timestamp value={block.time} format="time" />}
          footer={
            <HStack gap={1} vAlign="center">
              {block.footer ? (
                <Text type="supporting" color="secondary">
                  {block.footer}
                </Text>
              ) : null}
              <CopyButton
                text={assistantBlockText(block)}
                label="Copy response"
              />
              {showRegenerate && canRegenerateNow && (
                <RegenerateButton onRegenerate={handleRegenerate} />
              )}
            </HStack>
          }
        />
      </ChatMessage>
    );
  };

  return (
    <VStack
      ref={rootRef}
      height="100%"
      style={{
        containerType: "inline-size",
        containerName: "pesdac-cn-chat",
      }}
    >
      <style>{THREAD_CSS}</style>

      <Layout
        height="fill"
        content={
          <LayoutContent padding={0}>
            <HStack height="100%">
              <VStack style={{ flex: 1, minWidth: 0, height: "100%" }}>
                <ChatLayout
                  density="spacious"
                  style={{ flex: 1, minHeight: 0 }}
                  composer={
                    <VStack gap={2}>
                      {live == null && (followUps || sendError) && (
                          <HStack gap={2} wrap="wrap" vAlign="center">
                            {sendError ? (
                              <Button
                                label="Retry"
                                variant="ghost"
                                size="sm"
                                icon={
                                  <Icon icon={ArrowPathIcon} size="sm" />
                                }
                                onClick={handleRetry}
                              />
                            ) : (
                              followUps?.map((suggestion) => (
                                <Button
                                  key={suggestion}
                                  label={suggestion}
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleSend(suggestion)}
                                />
                              ))
                            )}
                          </HStack>
                        )}
                      <ChatComposer
                      onSubmit={handleSend}
                      onStop={handleStop}
                      isStopShown={live != null}
                      status={
                        sendError
                          ? { type: "warning", message: sendError.message }
                          : !storageOk
                            ? {
                                type: "warning",
                                message:
                                  "History isn't saving in this browser — new messages will be lost on reload.",
                              }
                            : undefined
                      }
                      placeholder={
                        composerMode === "ask"
                          ? thread.placeholder
                          : "Ask for a deep, step-by-step explanation..."
                      }
                      input={
                        <ChatComposerInput
                          handleRef={composerInputRef}
                          triggers={[threadReferenceTrigger]}
                          onFiles={stageIntoDrawer}
                        />
                      }
                      drawer={
                        attachments.length > 0 ? (
                          <ChatComposerDrawer
                            count={attachments.length}
                            label="Files"
                          >
                            {attachments.map((staged) =>
                              staged.previewUrl ? (
                                <Thumbnail
                                  key={staged.att.id}
                                  src={staged.previewUrl}
                                  alt={staged.att.name}
                                  label={attachmentLabel(staged.att)}
                                  onRemove={() => removeStaged(staged.att.id)}
                                />
                              ) : (
                                <Token
                                  key={staged.att.id}
                                  label={attachmentLabel(staged.att)}
                                  onRemove={() => removeStaged(staged.att.id)}
                                />
                              ),
                            )}
                          </ChatComposerDrawer>
                        ) : undefined
                      }
                      headerActions={
                        <>
                          <AttachButton onFiles={stageIntoDrawer} />
                          <DropdownMenu
                            button={{
                              label: "Reference",
                              variant: "ghost",
                              size: "sm",
                              icon: <Icon icon={AtSymbolIcon} size="sm" />,
                              isIconOnly: true,
                            }}
                            hasChevron={false}
                            menuWidth={240}
                            items={thread.composerReferenceItems.map((item) => ({
                              label: item.label,
                              description: item.description,
                              onClick: () => insertReference(item.label),
                            }))}
                          />
                          <DropdownMenu
                            button={{
                              label: "Conversation actions",
                              variant: "ghost",
                              size: "sm",
                              icon: (
                                <Icon icon={EllipsisHorizontalIcon} size="sm" />
                              ),
                              isIconOnly: true,
                            }}
                            hasChevron={false}
                            menuWidth={240}
                            items={[
                              {
                                label: transcriptCopied
                                  ? "Copied!"
                                  : "Copy transcript",
                                onClick: copyTranscript,
                              },
                            ]}
                          />
                        </>
                      }
                      footerActions={
                        <DropdownMenu
                          button={{
                            label:
                              composerMode === "ask" ? "Ask" : "Deep Study",
                            variant: "ghost",
                            size: "sm",
                          }}
                          items={[
                            {
                              label: "Ask",
                              onClick: () => setComposerMode("ask"),
                            },
                            {
                              label: "Deep Study",
                              onClick: () => setComposerMode("deep"),
                            },
                          ]}
                        />
                      }
                      sendActions={
                        <ChatDictationButton dictation={dictation} />
                      }
                      />
                    </VStack>
                  }
                >
                  <ChatMessageList isStreaming={live != null}>
                    {blocks.map((block, i) => {
                      if (block.from === "system") {
                        return (
                          <ChatSystemMessage
                            key={i}
                            variant={
                              block.variant === "divider"
                                ? "divider"
                                : undefined
                            }
                          >
                            {block.text}
                          </ChatSystemMessage>
                        );
                      }
                      if (block.from === "user") {
                        return renderUserBlock(block, i);
                      }
                      return renderAssistantBlock(
                        block,
                        i,
                        isLastSessionTurn(i),
                      );
                    })}
                    {live && (
                      <ChatMessage
                        sender="assistant"
                        avatar={<Avatar name="PESDac" size="md" />}
                      >
                      <ChatMessageBubble variant="ghost">
                        <Markdown density="compact">
                          {live.text + "▍"}
                        </Markdown>
                      </ChatMessageBubble>
                      <ChatToolCalls calls={live.tools} />
                      </ChatMessage>
                    )}
                  </ChatMessageList>
                </ChatLayout>
              </VStack>

              {thread.artifact && isArtifactOpen && (
                <>
                  <ResizeHandle
                    direction="horizontal"
                    resizable={artifactResize.props}
                    isReversed
                    pillPlacement="start"
                    hasDivider
                    label="Resize study note"
                    className="pesdac-cn-artifact-resize"
                  />

                  <Card
                    variant="transparent"
                    height="100%"
                    className="pesdac-cn-artifact-panel"
                    style={artifactPanelWidthVar(artifactResize.size)}
                  >
                    <Toolbar
                      label="Study note actions"
                      dividers={["bottom"]}
                      startContent={
                        <HStack gap={3} vAlign="center">
                          <Icon
                            icon={DocumentTextIcon}
                            size="sm"
                            color="secondary"
                          />
                          <VStack gap={0}>
                            <Text type="label" weight="semibold">
                              {thread.artifact.title}
                            </Text>
                            <Text type="supporting" color="secondary">
                              {thread.artifact.subtitle}
                            </Text>
                          </VStack>
                        </HStack>
                      }
                      endContent={
                        <StudyNoteActions
                          onCopy={() => {
                            if (thread.artifact)
                              void copyText(thread.artifact.markdown);
                          }}
                          onClose={() => setIsArtifactOpen(false)}
                        />
                      }
                    />

                    <StudyNoteBody artifact={thread.artifact} />
                  </Card>
                </>
              )}
            </HStack>
          </LayoutContent>
        }
      />

      <Dialog
        isOpen={isArtifactDialogOpen}
        onOpenChange={setIsArtifactDialogOpen}
        purpose="info"
        variant="fullscreen"
      >
        {thread.artifact && (
          <Layout
            header={
              <DialogHeader
                title={thread.artifact.title}
                subtitle={thread.artifact.subtitle}
                hasDivider
                onOpenChange={setIsArtifactDialogOpen}
              />
            }
            content={
              <LayoutContent padding={0}>
                <StudyNoteBody artifact={thread.artifact} />
              </LayoutContent>
            }
          />
        )}
      </Dialog>

      <Lightbox
        isOpen={lightbox != null}
        onOpenChange={(open) => {
          if (!open) setLightbox(null);
        }}
        media={
          lightbox ? [{ src: lightbox.src, alt: lightbox.alt }] : []
        }
        hasZoom
      />

      <Dialog
        isOpen={pdfOpen != null}
        onOpenChange={(open) => {
          if (!open) setPdfOpen(null);
        }}
        purpose="info"
        variant="fullscreen"
      >
        {pdfOpen && (
          <Layout
            header={
              <DialogHeader
                title={pdfOpen.title}
                subtitle={pdfOpen.subtitle}
                hasDivider
                onOpenChange={(open) => {
                  if (!open) setPdfOpen(null);
                }}
              />
            }
            content={
              <LayoutContent padding={0}>
                <PdfPreviewBody file={pdfOpen.file} title={pdfOpen.title} />
              </LayoutContent>
            }
          />
        )}
      </Dialog>
    </VStack>
  );
}
