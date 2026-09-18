"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

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
import { Divider } from "@astryxdesign/core/Divider";
import { Card } from "@astryxdesign/core/Card";
import { Section } from "@astryxdesign/core/Section";
import { Markdown } from "@astryxdesign/core/Markdown";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Button } from "@astryxdesign/core/Button";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Toolbar } from "@astryxdesign/core/Toolbar";
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
  XMarkIcon,
  ChevronRightIcon,
  AtSymbolIcon,
  ArrowPathIcon,
  EllipsisHorizontalIcon,
  PencilIcon,
  HandThumbUpIcon,
  HandThumbDownIcon,
  MagnifyingGlassIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";

import { ThreadHistoryLoader } from "./ThreadHistoryLoader";

import { useToast } from "@astryxdesign/core/Toast";

import type {
  Artifact,
  AssistantBlock,
  Attachment,
  Block,
  Bubble,
  McqBubble,
  StepsBubble,
  Thread,
  ToolCall,
  UserBlock,
} from "../../content/threads/types";
import {
  REFERENCE_ITEMS,
  referenceIdForLabel,
  parseReferenceIds,
} from "../../lib/references";
import { dayDividerLabel } from "../../lib/chat";
import {
  stageFiles,
  revokeStaged,
  attachmentLabel,
  type StagedFile,
} from "../../lib/attachments";
import {
  useSessionVersion,
  useStorageHealth,
  useCorruptKeys,
  getProfile,
  getComposerDepth,
  setComposerDepth,
  getOverlay,
  setOverlay,
  appendBlocks,
  removeLastOverlayBlock,
  truncateOverlay,
  readDraft,
  writeDraft,
  getFeedback,
  setFeedback,
  feedbackKey,
  type FeedbackVote,
  type ChatAuth,
  identitySeedKey,
  isServerChat,
  loadChatMessages,
  invalidateChatMessages,
  getChatMessagesStatus,
  getChatSyncError,
  getHydrateSyncError,
  getChatHydrateFailed,
  clearChatSyncError,
  hydrateChats,
  persistAppendedBlock,
  persistTruncate,
  shouldShowThreadSkeleton,
  listCustomChats,
  CANCEL_EVENT,
  FOCUS_COMPOSER_EVENT,
  OPEN_FIND_EVENT,
  setFindAvailable,
} from "../../lib/session";
import { useAuth, useAuthEpoch } from "../../lib/auth";
import { useLlmStatus } from "../../lib/llm";
import { latestFollowUps } from "../../lib/setting-followups";
import {
  formatTime,
  resolveDividerText,
  isSameCalendarDay,
} from "../../lib/format-timestamps";
import { planResponse, type ResponseMode } from "../../lib/responder";
import {
  newClientKey,
  outboxQueue,
  startOutboxSchedulers,
  useOutboxUnsynced,
} from "../../lib/outbox";

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
/* In-thread find: matching text lights up like a browser find. */
::highlight(pesdac-find) {
  background-color: var(--color-accent);
  color: var(--color-on-accent);
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

// Interactive multiple-choice quiz (answers live in content, so checking
// is client-side). Wrong picks can be retried by tapping another option.
const MCQ_LETTERS = ["A", "B", "C", "D", "E", "F"];
function McqCard({ bubble }: { bubble: McqBubble }) {
  const [picked, setPicked] = useState<number | null>(null);
  // Fail closed on a malformed payload (no options): a card row must never
  // take down the thread — same doctrine as unparseable timestamps.
  if (bubble.options.length === 0) return null;
  const correct = picked != null && picked === bubble.answerIndex;
  return (
    <Card variant="muted" padding={5} width="100%" maxWidth={560}>
      <VStack gap={4}>
        <VStack gap={1}>
          <Text type="supporting" color="secondary">
            Quiz — choose the best answer
          </Text>
          <Text type="body" size="lg" weight="semibold">
            {bubble.question}
          </Text>
        </VStack>
        <VStack gap={2}>
          {bubble.options.map((option, i) => {
            const isAnswer = i === bubble.answerIndex;
            const isPicked = i === picked;
            return (
              <Button
                key={i}
                label={`Option ${MCQ_LETTERS[i] ?? i + 1}: ${option.label}`}
                variant={
                  picked == null
                    ? "secondary"
                    : isAnswer
                      ? "primary"
                      : isPicked
                        ? "destructive"
                        : "secondary"
                }
                size="lg"
                width="100%"
                onClick={() => setPicked(i)}
              >
                <HStack gap={2} vAlign="center" width="100%">
                  <Avatar
                    name={MCQ_LETTERS[i] ?? String(i + 1)}
                    size="sm"
                    shape="circle"
                  />
                  <span style={{ textAlign: "start", flex: 1 }}>
                    {option.detail
                      ? `${option.label} — ${option.detail}`
                      : option.label}
                  </span>
                </HStack>
              </Button>
            );
          })}
        </VStack>
        {picked != null && (
          <Text
            type="body"
            weight="semibold"
            color={correct ? "accent" : "secondary"}
          >
            {correct ? "Correct. " : "Not quite — try another option. "}
            {bubble.explanation}
          </Text>
        )}
      </VStack>
    </Card>
  );
}

// Step-by-step instructions as a stepper card (title, current step,
// numbered dots, view-all toggle, back/next) instead of a step wall.
function StepsCard({ bubble }: { bubble: StepsBubble }) {
  const [at, setAt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  // Fail closed on a malformed payload (no steps): `steps[0].heading`
  // would throw below and unmount the whole thread.
  if (bubble.steps.length === 0) return null;
  const step = bubble.steps[at];
  return (
    <Card variant="muted" padding={5} width="100%" maxWidth={560}>
      <VStack gap={4}>
        <VStack gap={1}>
          <Text type="supporting" color="secondary">
            Step-by-step
          </Text>
          <Text type="body" size="lg" weight="semibold">
            {bubble.title}
          </Text>
          {bubble.intro && (
            <Text type="body" color="secondary">
              {bubble.intro}
            </Text>
          )}
        </VStack>
        <Divider />
        {!expanded && (
          <VStack gap={2}>
            <Text type="supporting" color="secondary">
              Step {at + 1} of {bubble.steps.length}
            </Text>
            <Text type="body" size="lg" weight="semibold">
              {step.heading}
            </Text>
            <Text type="body">{step.body}</Text>
          </VStack>
        )}
        {expanded && (
          <VStack gap={3}>
            {bubble.steps.map((s, i) => (
              <VStack key={i} gap={1}>
                <Text
                  type="body"
                  weight="semibold"
                  color={i === at ? "accent" : undefined}
                >
                  Step {i + 1} — {s.heading}
                </Text>
                <Text type="body" color="secondary">
                  {s.body}
                </Text>
              </VStack>
            ))}
          </VStack>
        )}
        <HStack gap={1} vAlign="center">
          {bubble.steps.map((s, i) => (
            <Button
              key={i}
              label={`Go to step ${i + 1}: ${s.heading}`}
              variant={i === at ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                setAt(i);
                setExpanded(false);
              }}
            >
              {i + 1}
            </Button>
          ))}
        </HStack>
        <HStack gap={2} vAlign="center" width="100%">
          <Button
            label="Previous step"
            variant="ghost"
            isDisabled={at === 0}
            onClick={() => setAt((v) => Math.max(0, v - 1))}
          >
            Back
          </Button>
          <Button
            label={expanded ? "Hide all steps" : "View all steps"}
            variant="ghost"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Hide steps" : "View all steps"}
          </Button>
          <Button
            label="Next step"
            variant="primary"
            isDisabled={at === bubble.steps.length - 1}
            style={{ marginLeft: "auto" }}
            onClick={() =>
              setAt((v) => Math.min(bubble.steps.length - 1, v + 1))
            }
          >
            Next
          </Button>
        </HStack>
      </VStack>
    </Card>
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

// Sent text with @-tokens shown as badges (same shape as stored `mention`
// bubbles). Render-only: raw text stays the source of truth for retry,
// regenerate, and find. Unknown @words stay plain text.
function renderUserText(text: string, key: number) {
  const ids = parseReferenceIds(text).filter((id) =>
    REFERENCE_ITEMS.some((item) => String(item.id) === id.toLowerCase()),
  );
  if (ids.length === 0) return <Text key={key}>{text}</Text>;
  return (
    <ChatTokenizedText
      key={key}
      tokens={ids.map((id) => {
        const item = REFERENCE_ITEMS.find(
          (i) => String(i.id) === id.toLowerCase(),
        )!;
        return { value: `@${id}`, label: item.label, variant: "blue" as const };
      })}
    >
      {text}
    </ChatTokenizedText>
  );
}

// Searchable text per block for in-thread find.
function blockCorpusText(block: Block): string {
  if (block.from === "user") return userBlockText(block);
  if (block.from === "assistant") return assistantBlockText(block);
  return block.text;
}

// Custom-highlight name for in-thread find matches.
const FIND_HIGHLIGHT = "pesdac-find";

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
  const [isCopying, setIsCopying] = useState(false);
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
      isLoading={isCopying}
      isDisabled={isCopying}
      // sm icon to match the supporting-size timestamp beside it.
      icon={<Icon icon={copied ? CheckIcon : ClipboardDocumentIcon} size="sm" />}
      clickAction={() => {
        if (isCopying) return;
        setIsCopying(true);
        void copyText(text).then((ok) => {
          setIsCopying(false);
          if (!ok) return;
          setCopied(true);
          if (timer.current != null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    />
  );
}

// Thumbs feedback beside copy (toggle; clicking the active vote clears
// it). Votes live in a side map so static demo turns can be rated too.
function VoteButtons({ voteKey }: { voteKey: string }) {
  useSessionVersion();
  const vote = getFeedback(voteKey);
  const cast = (v: FeedbackVote) =>
    setFeedback(voteKey, vote === v ? null : v);
  const thumb = (
    v: FeedbackVote,
    label: string,
    icon: typeof HandThumbUpIcon,
  ) => (
    <Button
      label={label}
      variant="ghost"
      size="sm"
      isIconOnly
      icon={
        <Icon
          icon={icon}
          size="sm"
          color={vote === v ? "accent" : undefined}
        />
      }
      onClick={() => cast(v)}
    />
  );
  return (
    <>
      {thumb("up", "Good response", HandThumbUpIcon)}
      {thumb("down", "Bad response", HandThumbDownIcon)}
    </>
  );
}

// Chat timestamp in the viewer's selected time zone (Profile → Language).
// Same Astryx Text tokens the Timestamp row used (supporting/secondary),
// but the wall time comes from profile region + timezone via `formatTime`
// instead of the browser zone — so changing the setting repaints every
// open message (reactive via useSessionVersion, same as the parent).
function ChatTimestamp({ value }: { value: string }) {
  useSessionVersion();
  const profile = getProfile();
  const text = formatTime(value, {
    region: profile.region,
    timeZone: profile.timezone,
  });
  let iso = value;
  try {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) iso = parsed.toISOString();
  } catch {
    // Keep the raw value for dateTime — text already failed closed.
  }
  return (
    <Text type="supporting" color="secondary">
      <time dateTime={iso}>{text}</time>
    </Text>
  );
}

// Day-divider text for render: the stored text freezes the day word at
// creation, so recompute its prefix from the first message below the
// divider (else the chat's creation date for still-empty drafts).
// No anchor (static demo shells) keeps the stored text verbatim.
function dividerTextFor(
  stored: string,
  blocks: Block[],
  index: number,
  sessionKey: string,
  region: string,
  timeZone: string,
): string {
  for (let j = index + 1; j < blocks.length; j++) {
    const next = blocks[j];
    if (next.from === "user" || next.from === "assistant") {
      return resolveDividerText(stored, next.time, { region, timeZone });
    }
  }
  const createdAt = listCustomChats().find((c) => c.code === sessionKey)
    ?.createdAt;
  return resolveDividerText(stored, createdAt, { region, timeZone });
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
        case "mcq":
          return [
            b.question,
            ...b.options.map(
              (o, i) => `${i + 1}. ${o.detail ? `${o.label} — ${o.detail}` : o.label}`,
            ),
            `Answer: ${b.options[b.answerIndex]?.label ?? ""}`,
            b.explanation,
          ].join("\n");
        case "steps":
          return [
            b.title,
            ...(b.intro ? [b.intro] : []),
            ...b.steps.map((s, i) => `Step ${i + 1} — ${s.heading}: ${s.body}`),
          ].join("\n");
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
      // sm icon to match the supporting-size timestamp beside it.
      icon={<Icon icon={ArrowPathIcon} size="sm" />}
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
  isHistoryLoading,
  notify,
  isAppReady = true,
  isModalOpen,
}: {
  thread: Thread;
  sessionKey: string;
  autoSend?: string | { text: string; attachments?: Attachment[] };
  /**
   * Server history fetch in flight (persistence stream-C drives this).
   * Renders skeleton turns in the real message shells instead of blocks;
   * composer stays live. Defaults false — zero behavior change until a
   * caller passes true.
   */
  isHistoryLoading?: boolean;
  /** Error surfacing for server write-through (one toast per failure). */
  notify?: (body: string) => void;
  /**
   * App readiness gate (spec §4, driven by Pesdac): false while user data
   * loads — the message list skeletons (existing history-skeleton branch)
   * and the composer + its menus disable. Defaults true so any other
   * caller sees today's behavior unchanged.
   */
  isAppReady?: boolean;
  /**
   * True while any app modal is open (driven by Pesdac's isAnyModalOpen).
   * Assistant-avatar name tooltips ("PESDac") behind an open modal have no
   * mouseleave while the dialog covers them — streaming autoscroll and
   * modal open/close layout shifts can also fire spurious mouseenters
   * under a stationary pointer — so a showing or delay-pending tooltip
   * sticks above the backdrop with no way to dismiss. `false` unmounts
   * the tooltip layer (clearing pending timers); undefined preserves
   * today's behavior exactly.
   */
  isModalOpen?: boolean;
}) {
  // Answer depth (answer-depth spec): profile default wins over the seed
  // voice; the toggle overrides per thread for the session. Seed
  // thread.mode now describes authored content only.
  const [composerMode, setComposerMode] = useState<ResponseMode>(() => {
    // B13: a previously persisted toggle choice wins over the profile
    // default — reload keeps the last choice instead of resetting.
    const saved = getComposerDepth();
    if (saved != null) return saved;
    const depth = getProfile().depth;
    return depth === "ask" || depth === "deep" || depth === "auto"
      ? depth
      : "auto";
  });
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
    // B18: the vendor surfaces recognition errors here — denial gets a
    // signal instead of the old honest-but-silent no-op.
    onError: (error) => {
      const denied =
        error.error === "not-allowed" || error.error === "service-not-allowed";
      notify?.(
        denied
          ? "Microphone is blocked — allow access in your browser to use dictation."
          : "Dictation failed — try again.",
      );
    },
  });
  // Staged uploads (metadata persists with the sent message; File handles
  // and preview URLs stay in memory until send/remove).
  const [attachments, setAttachments] = useState<StagedFile[]>([]);
  // Copy-transcript menu feedback.
  const [transcriptCopied, setTranscriptCopied] = useState(false);
  // B15: info toast confirms the copy (the menu closes on select, so
  // the inline flip alone is invisible).
  const toast = useToast();

  // Session overlay: blocks appended this session (persisted per code).
  // Read directly (see Pesdac.tsx note) so sent messages and renames show
  // on first paint instead of jumping in after mount.
  useSessionVersion();
  const storageOk = useStorageHealth();
  const corruptKeys = useCorruptKeys();
  // Outbox (Phase 5): opportunistic flush triggers ride with the thread
  // (registration is idempotent process-wide); the snapshot below feeds
  // the composer's "N unsynced" status — no new UI, existing status slot.
  useEffect(() => startOutboxSchedulers(), []);
  const outboxSnapshot = useOutboxUnsynced();
  // B26: a reconnect flush that delivers while this thread shows a sync
  // error repaints it — force a messages reload so delivered turns
  // appear without a manual reload. Fires once per failure (the error
  // gate): the successful load clears the error itself. No deps:
  // re-evaluated each render for fresh closures, like the shortcuts
  // effect below.
  const prevUnsyncedRef = useRef(outboxSnapshot.total);
  useEffect(() => {
    const prev = prevUnsyncedRef.current;
    prevUnsyncedRef.current = outboxSnapshot.total;
    if (outboxSnapshot.total >= prev) return;
    if (chatAuth == null) return;
    if (getChatSyncError(sessionKey) == null) return;
    invalidateChatMessages(sessionKey);
    void loadChatMessages(sessionKey, chatAuth, { notify });
  });
  const overlay = getOverlay(sessionKey);
  const blocks = [...thread.blocks, ...overlay];

  // Server backing (spec §5): authenticated custom chats persist every
  // leg; guests, demos, and guest-era customs stay memory-only (the
  // persist helpers no-op before any fetch there — no behavior change).
  const authState = useAuth();
  const authEpoch = useAuthEpoch();
  const chatAuth: ChatAuth =
    authState.status === "authenticated"
      ? {
          userId: authState.user.id,
          identityKey: identitySeedKey(authState.user.id, authEpoch),
        }
      : null;
  const isBacked = chatAuth != null && isServerChat(sessionKey);
  // LLM gate (spec llm-byok-settings §5.3): keyless authenticated sends
  // stop in handleSend with the composer status showing — no optimistic
  // paint (a user bubble with no possible reply is a lie). Drafts stay
  // in the input. Guests/loading/degraded behave exactly as today.
  const llm = useLlmStatus();
  const llmBlocked =
    authState.status === "authenticated" &&
    (llm.state === "unconfigured" || llm.state === "invalid");
  const llmStatusMessage = !llmBlocked
    ? null
    : llm.state === "invalid"
      ? "Your saved key was rejected — save a new one in Settings."
      : "Connect your OpenRouter key in Settings to start chatting.";

  // Open-chat message load (spec §5): server turns load once per opened
  // custom chat — skeleton while loading, memory paint + one toast on
  // failure. Fresh server-created chats (autoSend) skip the list leg:
  // their turns are provably empty at mount.
  const historyStatus = isBacked ? getChatMessagesStatus(sessionKey) : "idle";
  // Gate: !isAppReady forces the skeleton branch even when chat data is
  // ready (never a live thread over an unproven identity). U && !C keeps
  // the existing history-load behavior below unchanged.
  const showHistorySkeleton =
    !isAppReady ||
    isHistoryLoading === true ||
    shouldShowThreadSkeleton(isBacked, historyStatus, overlay.length);
  // Persistent sync-error surface (chat-error-display spec §4): per-chat
  // history/persist failures win; any authenticated thread otherwise falls
  // back to the hydrate error — a failed hydrate means the list leg never
  // landed, so no backed chat can exist and every visible composer should
  // say so (demo threads included: their turns still send memory-only).
  // 401s record neither (global re-login owns them); guests stay null
  // (chatAuth null → zero fetches on the guest path).
  const chatSyncError = getChatSyncError(sessionKey);
  const isProvisionalHistory =
    !isBacked &&
    chatAuth != null &&
    overlay.length === 0 &&
    thread.blocks.length === 0 &&
    getChatHydrateFailed();
  const syncErrorMessage =
    chatSyncError ?? (chatAuth != null ? getHydrateSyncError() : null);
  // Loader suppression: a recorded sync error unmounts the loader and the
  // memory paint shows. Retry clears the signal first, so the spinner
  // honestly returns only for the new fetch.
  const showHistoryLoader = showHistorySkeleton && syncErrorMessage == null;
  const showHistoryRetry =
    !showHistoryLoader &&
    (isProvisionalHistory ||
      (historyStatus === "failed" && chatSyncError != null));
  const autoSendRef = useRef<typeof autoSend>(autoSend);
  useEffect(() => {
    if (!isBacked) return;
    if (autoSendRef.current) return;
    void loadChatMessages(sessionKey, chatAuth, { notify });
    // Load once per opened chat (remounts per sessionKey). chatAuth is
    // identity-scoped inside the loader; notify is a stable bridge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, isBacked]);

  // Follow-ups for the bottom pill row: the latest assistant turn's
  // suggestions, but only while no newer user message supersedes them —
  // a sent prompt hides stale pills until its response lands and persists
  // them (the `live == null` gate below stays as the streaming layer).
  const followUps = latestFollowUps(blocks);

  // Follow-ups visibility gate: the profile default (My Profile →
  // Assistant → Follow-up suggestions). Render-only — the server keeps
  // sending suggestions; this decides display. Reactive via the
  // useSessionVersion() subscription above, so flipping the profile
  // switch repaints open chats with no refetch.
  const showFollowUps = getProfile().followUps;

  // In-thread find: substring match over the block corpus, current hit
  // scrolled into view with an accent outline.
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findAt, setFindAt] = useState(0);
  const findMatches =
    findQuery.trim() === ""
      ? []
      : blocks
          .map((b, i) => ({
            i,
            hit: blockCorpusText(b)
              .toLowerCase()
              .includes(findQuery.trim().toLowerCase()),
          }))
          .filter((m) => m.hit)
          .map((m) => m.i);
  const currentMatch =
    findMatches.length === 0
      ? -1
      : findMatches[Math.min(findAt, findMatches.length - 1)];

  // Matching text lights up via the CSS Custom Highlight API — no
  // React-tree surgery inside Astryx Markdown. data-block anchors are
  // scroll targets only. Unsupported browsers still scroll, unhighlighted.
  useEffect(() => {
    const registry =
      typeof CSS !== "undefined" && "highlights" in CSS
        ? (
            CSS as unknown as {
              highlights: {
                set(n: string, h: unknown): void;
                delete(n: string): void;
              };
            }
          ).highlights
        : null;
    const HighlightCtor = (
      globalThis as unknown as {
        Highlight?: new (...r: Range[]) => unknown;
      }
    ).Highlight;
    registry?.delete(FIND_HIGHLIGHT);
    if (!findOpen || currentMatch < 0 || !registry || !HighlightCtor)
      return;
    const el = rootRef.current?.querySelector(
      `[data-block="${currentMatch}"]`,
    );
    el?.scrollIntoView({ block: "center" });
    const q = findQuery.trim().toLowerCase();
    if (!el || !q) return;
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = (node.textContent ?? "").toLowerCase();
      let from = 0;
      for (;;) {
        const at = text.indexOf(q, from);
        if (at < 0) break;
        const r = document.createRange();
        r.setStart(node, at);
        r.setEnd(node, at + q.length);
        ranges.push(r);
        from = at + q.length;
      }
      node = walker.nextNode();
    }
    if (ranges.length > 0)
      registry.set(FIND_HIGHLIGHT, new HighlightCtor(...ranges));
    return () => {
      registry.delete(FIND_HIGHLIGHT);
    };
  });

  const stepFind = (dir: 1 | -1) => () => {
    if (findMatches.length === 0) return;
    setFindAt((a) => (a + dir + findMatches.length) % findMatches.length);
  };

  const openFind = () => {
    setFindQuery("");
    setFindAt(0);
    setFindOpen(true);
  };

  // B14: Esc restores focus to the composer so keyboard users keep
  // their place (was: focus dropped to the page).
  const closeFind = () => {
    setFindOpen(false);
    composerInputRef.current?.focus();
  };

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
  // Message edit (index into blocks): prefill the composer; send replaces
  // the turn, Esc cancels. Session-added user turns only.
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  // Controlled composer text (draft persistence + edit prefill).
  const [composerText, setComposerText] = useState(() => readDraft(sessionKey));

  // Unsent text survives reloads (debounced; send clears it via handleSend).
  useEffect(() => {
    const t = window.setTimeout(() => writeDraft(sessionKey, composerText), 400);
    return () => window.clearTimeout(t);
  }, [composerText, sessionKey]);
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

  // Assistant-side persist (spec §5): the block paints optimistically,
  // then the server leg lands at stream completion (stop persists the
  // partial — same path). Failure rolls back ONLY the assistant block +
  // one toast; the user message is preserved (slice-12). Guests/demos
  // no-op inside the helper (memory-only, no fetch). The live send is
  // tracked in the outbox queue (pending → sent / failed) under one
  // idempotency key; persistAppendedBlock settles the record and
  // enqueues a durable replay on retryable failure.
  const appendAndPersist = (block: Block) => {
    if (!isBacked) {
      appendBlocks(sessionKey, [block]);
      return;
    }
    const snapshot = getOverlay(sessionKey);
    appendBlocks(sessionKey, [block]);
    // One idempotency key per send: the live send and any durable outbox
    // replay share it, so retries converge instead of duplicating.
    // persistAppendedBlock owns settling the queue record (sent / failed
    // + durable enqueue); this site only rolls back the optimistic paint.
    const sendId = newClientKey();
    outboxQueue.track(sendId);
    void persistAppendedBlock(sessionKey, block, chatAuth, {
      notify,
      clientMsgKey: sendId,
    }).then((ok) => {
      if (!ok) {
        setOverlay(sessionKey, snapshot);
      }
    });
  };

  const finalizeTurn = (
    tools: ToolCall[],
    text: string,
    followUps: string[],
    retryText?: string,
  ) => {
    const trimmed = text.trim();
    if (trimmed) {
      appendAndPersist({
        from: "assistant",
        bubbles: [{ type: "markdown", md: trimmed }],
        toolCalls: settleTools(tools),
        followUps,
        time: new Date().toISOString(),
        footer: `PESDac · ${thread.subject}`,
      });
    } else if (retryText) {
      // Empty model response: say so with a retry, never go silent.
      appendAndPersist(makeErrorBlock("empty", retryText));
    }
    setLive(null);
  };

  // Mid-stream abort (mockup: simulated; backend: disconnect/5xx): keep the
  // partial text and offer a retry that resumes without duplicating the
  // user's message.
  const failTurn = (tools: ToolCall[], partial: string, retryText: string) => {
    const block = makeErrorBlock("failed", retryText, partial);
    block.toolCalls = settleTools(tools);
    appendAndPersist(block);
    setLive(null);
  };

  // Assistant side of a turn: plan, stream, settle. handleSend owns the
  // user message; retry/regenerate re-enter here directly (no duplicate).
  const startTurn = (text: string, opts?: { forceOk?: boolean }) => {
    if (live) return;
    // B10: forced retries (rate-pill, error-bubble) plan the real answer
    // for contentless simulations instead of replaying the empty outcome.
    const plan = planResponse(text, thread.subject, composerMode, {
      ignoreSimulation: opts?.forceOk,
    });
    if (plan.error === "rate-limited" && !opts?.forceOk) {
      setSendError({
        text,
        message: "Too many requests — wait a few seconds, then retry.",
      });
      return;
    }
    if (plan.error === "empty" && !opts?.forceOk) {
      appendAndPersist(makeErrorBlock("empty", text));
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
    // Gate: the composer is disabled while user data loads; this guard
    // covers any programmatic send path. Drafts are preserved (no clear).
    if (!isAppReady) return;
    if (llmBlocked) {
      // ChatComposer clears via onChange AFTER onSubmit returns — defer
      // the restore past the composer's own clear.
      queueMicrotask(() => setComposerText(value));
      return;
    }
    setSendError(null);
    // Edited resend: drop the edited user turn and everything after it;
    // the normal path below appends the replacement and streams again.
    // Backed chats persist the truncate first (edit = truncate-from-index
    // + resend): the replacement appends only after the server leg lands,
    // since seq order is append-order. Failure restores the exact prior
    // paint + one toast and keeps the edit open to retry.
    if (editingIndex != null) {
      const keep = Math.max(0, editingIndex - thread.blocks.length);
      if (isBacked) {
        const snapshot = getOverlay(sessionKey);
        truncateOverlay(sessionKey, keep);
        setEditingIndex(null);
        void persistTruncate(sessionKey, keep, chatAuth, { notify }).then(
          (ok) => {
            if (!ok) {
              setOverlay(sessionKey, snapshot);
              return;
            }
            appendAndStream(text, staged);
          },
        );
        return;
      }
      truncateOverlay(sessionKey, keep);
      setEditingIndex(null);
    }
    appendAndStream(text, staged);
  };

  // User-side of a turn: optimistic paint, then (backed chats) one persist
  // per appended block in order; failure rolls back to the exact prior
  // paint + one toast and the assistant never starts.
  const appendAndStream = (text: string, staged: StagedFile[]) => {
    // Send clears the composer via ChatComposer's own onChange.
    // Day break: new messages on a later calendar day (in the selected
    // time zone) than the last one get a "Today · Subject" divider first.
    // The divider text is re-resolved at render, so it ages on revisit.
    const profile = getProfile();
    let needsDayDivider = false;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b.from === "user" || b.from === "assistant") {
        needsDayDivider = !isSameCalendarDay(b.time, new Date(), {
          region: profile.region,
          timeZone: profile.timezone,
        });
        break;
      }
    }
    const divider: Block | null = needsDayDivider
      ? {
          from: "system",
          text: dayDividerLabel("Today", thread.subject),
          variant: "divider",
        }
      : null;
    const userBlock: Block = {
      from: "user",
      bubbles: [{ type: "text", text }],
      ...(staged.length > 0
        ? { attachments: staged.map((s) => s.att) }
        : {}),
      time: new Date().toISOString(),
    };
    const fresh: Block[] = divider ? [divider, userBlock] : [userBlock];
    if (!isBacked) {
      appendBlocks(sessionKey, fresh);
      // Staged files travel with this message; clear the drawer either way.
      setAttachments([]);
      revokeStaged(staged);
      startTurn(text);
      return;
    }
    const snapshot = getOverlay(sessionKey);
    appendBlocks(sessionKey, fresh);
    // Staged files travel with this message; clear the drawer either way.
    setAttachments([]);
    revokeStaged(staged);
    // One queue record + idempotency key PER BLOCK: every persisted block
    // is its own server message, and sharing a key across blocks would
    // dedupe the later ones away. persistAppendedBlock settles each
    // record (sent / failed + durable enqueue); this site only rolls
    // back the optimistic paint and gates the assistant turn.
    void (async () => {
      for (const block of fresh) {
        const blockSendId = newClientKey();
        outboxQueue.track(blockSendId);
        const ok = await persistAppendedBlock(sessionKey, block, chatAuth, {
          notify,
          clientMsgKey: blockSendId,
        });
        if (!ok) {
          setOverlay(sessionKey, snapshot);
          return;
        }
      }
      startTurn(text);
    })();
  };

  // Edit a session-added user turn via the composer (static demo tails
  // are immutable). The overlay is only truncated on send, so cancelling
  // loses nothing.
  const startEdit = (index: number) => {
    const target = blocks[index];
    if (live || target?.from !== "user") return;
    setComposerText(userBlockText(target));
    setEditingIndex(index);
    composerInputRef.current?.focus();
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setComposerText("");
  };

  // Rate-limit retry: resume the saved prompt, bypassing the simulation.
  const handleRetry = () => {
    if (!sendError || live) return;
    const { text } = sendError;
    setSendError(null);
    startTurn(text, { forceOk: true });
  };

  // History Retry (user-initiated only — no timers, no effect loops):
  // re-calls loadChatMessages with the same { notify }. The per-chat
  // signal clears first so the loader honestly returns for the new fetch
  // (re-set + one toast on failure). Provisional deep links re-run the
  // list leg first — loadChatMessages alone is a no-op for a code the
  // store never saw.
  const handleHistoryRetry = () => {
    if (chatAuth == null) return;
    if (isProvisionalHistory) {
      void hydrateChats(chatAuth, { notify }).then((result) => {
        if (result.status !== "kept-memory") {
          clearChatSyncError(sessionKey);
          void loadChatMessages(sessionKey, chatAuth, { notify });
        }
      });
      return;
    }
    clearChatSyncError(sessionKey);
    void loadChatMessages(sessionKey, chatAuth, { notify });
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
      // Regenerate = delete-last + rerun: the overlay index maps to the
      // server seq (append-order, dense). Failure restores the exact
      // prior paint + one toast and the rerun never starts.
      if (isBacked) {
        const snapshot = getOverlay(sessionKey);
        if (!removeLastOverlayBlock(sessionKey)) return;
        const fromSeq = getOverlay(sessionKey).length;
        void persistTruncate(sessionKey, fromSeq, chatAuth, { notify }).then(
          (ok) => {
            if (!ok) {
              setOverlay(sessionKey, snapshot);
              return;
            }
            setSendError(null);
            startTurn(text);
          },
        );
        return;
      }
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
    // B11/B24: ANY stop persists an INTERRUPTED turn (failed error block
    // with Retry), never a normal turn and never nothing — reuses the
    // existing simulate-error render path ("This response was interrupted
    // before it finished."). Stopping before any words flowed persists
    // the marker with zero bubbles, so the stranded Q keeps its Retry
    // recovery instead of hanging answerless.
    if (live) failTurn(live.tools, live.text, lastUserText(blocks));
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
      // B15: the menu closes on select so the inline flip is invisible —
      // an info toast is the actual confirmation.
      toast({ body: "Transcript copied to clipboard.", type: "info" });
      later(1500, () => setTranscriptCopied(false));
    });
  };

  const removeStaged = (id: string) => {
    const target = attachments.find((s) => s.att.id === id);
    if (target) revokeStaged([target]);
    setAttachments((prev) => prev.filter((s) => s.att.id !== id));
  };

  // Files from picker, drop, or paste all land in the drawer. Gated:
  // staging new files while user data loads is dropped (no state change;
  // the picker itself is native). Removing staged files stays live.
  // (No upload caps at mockup stage — limits arrive with real uploads.)
  const stageIntoDrawer = (files: File[]) => {
    if (!isAppReady) return;
    if (files.length === 0) return;
    setAttachments((prev) => [...prev, ...stageFiles(files)]);
  };

  // First message typed on welcome: run it once the thread mounts.
  // (autoSendRef is declared with the backing block above: the history
  // load consults it to skip the list leg on fresh chats.)

  // Find availability for the global Ctrl/⌘+F shortcut: published while
  // this thread is mounted so Pesdac only hijacks browser find where the
  // custom finder exists.
  useEffect(() => {
    setFindAvailable(true);
    return () => setFindAvailable(false);
  }, []);

  // Global shortcuts (no deps: re-subscribe each render for fresh state).
  useEffect(() => {
    const onCancel = () => {
      if (live) handleStop();
      else if (editingIndex != null) cancelEdit();
      else if (findOpen) closeFind();
    };
    const onFocus = () => composerInputRef.current?.focus();
    const onOpenFind = () => {
      if (!getProfile().shortcutFind) return;
      if (findOpen) {
        // Already open: move focus back to the find box instead of
        // wiping the query.
        rootRef.current
          ?.querySelector<HTMLInputElement>("[data-find-panel] input")
          ?.focus();
        return;
      }
      openFind();
    };
    window.addEventListener(CANCEL_EVENT, onCancel);
    window.addEventListener(FOCUS_COMPOSER_EVENT, onFocus);
    window.addEventListener(OPEN_FIND_EVENT, onOpenFind);
    return () => {
      window.removeEventListener(CANCEL_EVENT, onCancel);
      window.removeEventListener(FOCUS_COMPOSER_EVENT, onFocus);
      window.removeEventListener(OPEN_FIND_EVENT, onOpenFind);
    };
  });

  // First message typed on welcome: run it once the thread mounts — gated
  // on settled identity, not on mount. This component's useAuth() starts
  // in its first-render "loading" window (per-instance hydration latch),
  // so a mount-frozen timer would capture chatAuth=null and persist the
  // whole turn memory-only, never POSTing it. Waiting for a settled
  // (authenticated OR guest) state delivers with a fresh, backed closure
  // and keeps the history skip above honest (the payload is still present
  // when the load effect re-runs on backing).
  const autoSendReady =
    autoSendRef.current != null &&
    authState.status !== "loading" &&
    isAppReady;
  useEffect(() => {
    if (!autoSendReady) return;
    const payload = autoSendRef.current;
    autoSendRef.current = undefined;
    if (payload == null) return;
    const text = typeof payload === "string" ? payload : payload.text;
    const staged: StagedFile[] =
      typeof payload === "string"
        ? []
        : (payload.attachments ?? []).map((att) => ({ att }));
    // Component-lifetime timer (the timers registry, cancelled only on
    // unmount): a later readiness flip re-runs this effect with no payload
    // and must NOT cancel the pending send.
    later(350, () => handleSend(text, staged));
    // Runs once per false→true transition; the frozen handleSend is the
    // ready render's closure by construction, not the mount's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSendReady]);

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
        return renderUserText(bubble.text, key);
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
      case "mcq":
        return <McqCard key={key} bubble={bubble} />;
      case "steps":
        return <StepsCard key={key} bubble={bubble} />;
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

  // Find wrapper: unstyled div carrying the scroll anchor only. The
  // matching *text* is highlighted by the effect below, not the row.
  const findRow = (i: number, row: ReactNode) => (
    <div key={i} data-block={i}>
      {row}
    </div>
  );

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
        // Session-added turns are editable (static demo tails are not);
        // the pencil lives in the metadata footer, mirroring copy on
        // assistant turns.
        const canEdit = isLast && key >= thread.blocks.length && live == null;
        return (
          <ChatMessageBubble
            key={i}
            group={group}
            metadata={
              isLast ? (
                <ChatMessageMetadata
                  timestamp={
                    <ChatTimestamp value={block.time} />
                  }
                  footer={
                    canEdit ? (
                      <Button
                        label="Edit message"
                        variant="ghost"
                        size="sm"
                        isIconOnly
                        icon={<Icon icon={PencilIcon} size="sm" />}
                        onClick={() => startEdit(key)}
                      />
                    ) : undefined
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
    // Reload recompute (FR1): stripped rows regain their footer
    // (`PESDac · subject`, same as live turns) and Retry text (last user
    // text, same fallback as regenerate) — no missing footer, no dead Retry.
    const footer = block.footer ?? `PESDac · ${thread.subject}`;
    const retryText =
      error?.retryText ?? lastUserText(blocks.slice(0, Math.max(0, key)));
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
        avatar={<Avatar name="PESDac" size="md" tooltip={isModalOpen ? false : undefined} />}
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
                onClick={() => startTurn(retryText, { forceOk: true })}
              />
            </HStack>
          </ChatMessageBubble>
        )}
        <ChatMessageMetadata
          timestamp={<ChatTimestamp value={block.time} />}
          footer={
            <HStack gap={1} vAlign="center">
              {footer ? (
                <Text type="supporting" color="secondary">
                  {footer}
                </Text>
              ) : null}
              <CopyButton
                text={assistantBlockText(block)}
                label="Copy response"
              />
              {live == null && (
                <VoteButtons voteKey={feedbackKey(sessionKey, key)} />
              )}
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
              <VStack
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: "100%",
                  position: "relative",
                }}
              >
                {/* Find floats over the message corner — never a layout row. */}
                {findOpen && (
                  <div
                    data-find-panel
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 16,
                      zIndex: 20,
                      width: 340,
                      maxWidth: "calc(100% - 32px)",
                    }}
                  >
                    <Card variant="muted" elevation="high" padding={2}>
                      <VStack gap={1}>
                        <HStack gap={1} vAlign="center">
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <TextInput
                              label="Find in thread"
                              isLabelHidden
                              placeholder="Find in thread..."
                              hasClear
                              hasAutoFocus
                              value={findQuery}
                              onChange={(v) => {
                                setFindQuery(v);
                                setFindAt(0);
                              }}
                              onEnter={stepFind(1)}
                            />
                          </div>
                          <Button
                            label="Close find"
                            variant="ghost"
                            size="sm"
                            isIconOnly
                            icon={<Icon icon={XMarkIcon} size="md" />}
                            onClick={closeFind}
                          />
                        </HStack>
                        <HStack gap={1} vAlign="center">
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <Text type="supporting" color="secondary">
                              {findQuery.trim() === ""
                                ? "Type to search"
                                : findMatches.length === 0
                                  ? "No matches"
                                  : `${Math.min(findAt, findMatches.length - 1) + 1} of ${findMatches.length}`}
                            </Text>
                          </div>
                          <Button
                            label="Previous match"
                            variant="ghost"
                            size="sm"
                            isIconOnly
                            icon={<Icon icon={ChevronUpIcon} size="sm" />}
                            onClick={stepFind(-1)}
                          />
                          <Button
                            label="Next match"
                            variant="ghost"
                            size="sm"
                            isIconOnly
                            icon={<Icon icon={ChevronDownIcon} size="sm" />}
                            onClick={stepFind(1)}
                          />
                        </HStack>
                      </VStack>
                    </Card>
                  </div>
                )}
                <ChatLayout
                  density="spacious"
                  style={{ flex: 1, minHeight: 0 }}
                  composer={
                    <>
                      {editingIndex != null && (
                        <HStack gap={2} vAlign="center">
                          <Text type="supporting" color="secondary">
                            Editing message — Send applies it to this turn,
                            Esc cancels.
                          </Text>
                          <Button
                            label="Cancel edit"
                            variant="ghost"
                            size="sm"
                            isIconOnly
                            icon={<Icon icon={XMarkIcon} size="sm" />}
                            onClick={cancelEdit}
                          />
                        </HStack>
                      )}
                      {/* B20: vendor ChatComposerInput wires onPaste only — this
                      layout-neutral wrapper (display:contents) adds the
                      missing OS-drop path without touching Astryx layout. */}
                      <div
                        style={{ display: "contents" }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const files = Array.from(e.dataTransfer?.files ?? []);
                          if (files.length > 0) stageIntoDrawer(files);
                        }}
                      >
                      <ChatComposer
                      value={composerText}
                      onChange={setComposerText}
                      onSubmit={handleSend}
                      onStop={handleStop}
                      isStopShown={live != null}
                      isDisabled={!isAppReady}
                      statusPosition={
                        (syncErrorMessage != null || llmStatusMessage != null) &&
                        sendError == null
                          ? "top"
                          : undefined
                      }
                      status={
                        sendError
                          ? { type: "warning", message: sendError.message }
                          : syncErrorMessage != null
                            ? { type: "error", message: syncErrorMessage }
                            : llmStatusMessage != null
                              ? { type: "warning", message: llmStatusMessage }
                              : !storageOk
                              ? {
                                  type: "warning",
                                  message:
                                    "History isn't saving in this browser — new messages will be lost on reload.",
                                }
                              : corruptKeys.length > 0
                                ? {
                                    type: "warning",
                                    message:
                                      "Saved data looked damaged, so this chat started fresh — history may be incomplete.",
                                  }
                                : outboxSnapshot.total > 0
                                  ? {
                                      type: "warning",
                                      message:
                                        `${outboxSnapshot.total} unsynced — ` +
                                        "will send automatically when online." +
                                        (outboxSnapshot.evicted > 0
                                          ? ` ${outboxSnapshot.evicted} oldest dropped (outbox full).`
                                          : "") +
                                        // Failed-fatal ops never auto-retry
                                        // (the worker skips them); a reload
                                        // rebuilds a record-less queue and
                                        // retries everything durable. Name it
                                        // so a stuck count is diagnosable.
                                        (outboxSnapshot.failedFatal > 0
                                          ? ` ${outboxSnapshot.failedFatal} failed and won't retry until reload.`
                                          : ""),
                                    }
                                  : // B21: attachment-only can't send (the vendor
                                    // composer trim-gates empty submits before our
                                    // onSubmit ever fires) — say so instead of
                                    // no-op silence. Lowest priority: any real
                                    // error/status wins over this hint.
                                    attachments.length > 0 &&
                                      composerText.trim() === ""
                                    ? {
                                        type: "warning",
                                        message:
                                          "Add a message to send these files — attachments can't be sent on their own.",
                                      }
                                    : undefined
                      }
                      placeholder={
                        composerMode === "deep"
                          ? "Ask for a deep, step-by-step explanation..."
                          : thread.placeholder
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
                          {getProfile().shortcutFind && (
                            <Button
                              label="Find in thread"
                              variant="ghost"
                              size="sm"
                              isIconOnly
                              isDisabled={!isAppReady}
                              icon={
                                <Icon icon={MagnifyingGlassIcon} size="sm" />
                              }
                              onClick={openFind}
                            />
                          )}
                          <AttachButton onFiles={stageIntoDrawer} />
                          <DropdownMenu
                            button={{
                              label: "Reference",
                              variant: "ghost",
                              size: "sm",
                              icon: <Icon icon={AtSymbolIcon} size="sm" />,
                              isIconOnly: true,
                              isDisabled: !isAppReady,
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
                              isDisabled: !isAppReady,
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
                      // Cosmetic only (dummy value): reserves the context-window
                      // slot until the context-meter work lands.
                      headerContext={
                        <HStack gap={2} vAlign="center">
                          <ProgressBar
                            value={42}
                            label="Context usage"
                            isLabelHidden
                          />
                        </HStack>
                      }
                      footerActions={
                        <DropdownMenu
                          button={{
                            label:
                              composerMode === "ask"
                                ? "Ask"
                                : composerMode === "deep"
                                  ? "Deep Study"
                                  : "Auto",
                            variant: "ghost",
                            size: "sm",
                            isDisabled: !isAppReady,
                          }}
                          items={[
                            {
                              label: "Ask",
                              // B13: the toggle persists the global default —
                              // reload restores the last choice instead of
                              // resetting to Auto. Per-thread override still
                              // lives for the session in composerMode.
                              onClick: () => {
                                setComposerMode("ask");
                                setComposerDepth("ask");
                              },
                            },
                            {
                              label: "Auto",
                              onClick: () => {
                                setComposerMode("auto");
                                setComposerDepth("auto");
                              },
                            },
                            {
                              label: "Deep Study",
                              onClick: () => {
                                setComposerMode("deep");
                                setComposerDepth("deep");
                              },
                            },
                          ]}
                        />
                      }
                      sendActions={
                        <ChatDictationButton dictation={dictation} />
                      }
                      />
                      </div>
                    </>
                  }
                >
                  <ChatMessageList isStreaming={live != null}>
                    {showHistoryLoader ? (
                      <ThreadHistoryLoader isModalOpen={isModalOpen} />
                    ) : (
                      <>
                    {showHistoryRetry && (
                      <HStack gap={2} vAlign="center" hAlign="center">
                        <Button
                          label="Retry"
                          variant="ghost"
                          size="sm"
                          icon={
                            <Icon icon={ArrowPathIcon} size="sm" />
                          }
                          onClick={handleHistoryRetry}
                        />
                      </HStack>
                    )}
                    {blocks.map((block, i) => {
                      if (block.from === "system") {
                        // Stored divider text freezes its day word at creation;
                        // re-resolve the prefix from the messages below it so
                        // a chat started days ago no longer reads "Today".
                        const text =
                          block.variant === "divider"
                            ? dividerTextFor(
                                block.text,
                                blocks,
                                i,
                                sessionKey,
                                getProfile().region,
                                getProfile().timezone,
                              )
                            : block.text;
                        return findRow(
                          i,
                          <ChatSystemMessage
                            key={i}
                            variant={
                              block.variant === "divider"
                                ? "divider"
                                : undefined
                            }
                          >
                            {text}
                          </ChatSystemMessage>,
                        );
                      }
                      if (block.from === "user") {
                        return findRow(i, renderUserBlock(block, i));
                      }
                      return findRow(
                        i,
                        renderAssistantBlock(
                          block,
                          i,
                          isLastSessionTurn(i),
                        ),
                      );
                    })}
                    {live && (
                      <ChatMessage
                        sender="assistant"
                        avatar={<Avatar name="PESDac" size="md" tooltip={isModalOpen ? false : undefined} />}
                      >
                      <ChatMessageBubble variant="ghost">
                        <Markdown density="compact">
                          {live.text + "▍"}
                        </Markdown>
                      </ChatMessageBubble>
                      <ChatToolCalls calls={live.tools} />
                      </ChatMessage>
                    )}
                    {/* Follow-ups anchor to the end of the message flow — never
                        in the sticky dock, so scrolled content can't slide
                        under them. No avatar/bubble: centered pills read as
                        "what to ask next", not as another answer. */}
                    {live == null && ((followUps != null && showFollowUps) || sendError) && (
                      <HStack gap={2} wrap="wrap" vAlign="center" hAlign="center">
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
                      </>
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
