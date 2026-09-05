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
  ChatComposerInput,
} from "@astryxdesign/core/Chat";
import { useResizable, ResizeHandle } from "@astryxdesign/core/Resizable";

import {
  DocumentTextIcon,
  ClipboardDocumentIcon,
  ShareIcon,
  XMarkIcon,
  ChevronRightIcon,
  AtSymbolIcon,
} from "@heroicons/react/24/outline";

import type {
  Artifact,
  AssistantBlock,
  Bubble,
  Thread,
  ToolCall,
  UserBlock,
} from "../../content/threads/types";
import {
  useSessionVersion,
  getOverlay,
  appendBlocks,
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

function StudyNoteActions({ onClose }: { onClose?: () => void }) {
  return (
    <>
      <Button
        label="Copy"
        variant="ghost"
        size="sm"
        icon={<Icon icon={ClipboardDocumentIcon} size="sm" />}
        isIconOnly
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

export default function ThreadView({
  thread,
  sessionKey,
  autoSend,
}: {
  thread: Thread;
  sessionKey: string;
  autoSend?: string;
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

  // Session overlay: blocks appended this session (persisted per code).
  useSessionVersion();
  const overlay = getOverlay(sessionKey);
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

  const finalizeTurn = (
    tools: ToolCall[],
    text: string,
    followUps: string[],
  ) => {
    const trimmed = text.trim();
    if (trimmed) {
      appendBlocks(sessionKey, [
        {
          from: "assistant",
          bubbles: [{ type: "markdown", md: trimmed }],
          toolCalls: tools,
          followUps,
          time: new Date().toISOString(),
          footer: `PESDac · ${thread.subject}`,
        },
      ]);
    }
    setLive(null);
  };

  const handleSend = (value: string) => {
    const text = value.trim();
    if (!text || live) return;
    // Day break: new messages on a later day than the last one get a
    // "Today" divider first (mockup label; backend sends real dates).
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
        ? [{ from: "system", text: "Today", variant: "divider" } as const]
        : []),
      { from: "user", bubbles: [{ type: "text", text }], time: new Date().toISOString() },
    ]);
    const plan = planResponse(text, thread.subject, composerMode);
    const running = plan.toolCalls.map((t) => ({ ...t, status: "running" as const, duration: "" }));
    setLive({ tools: running, text: "", full: plan.answer, followUps: plan.followUps });
    later(700, () => {
      const words = plan.answer.split(/(\s+)/);
      let i = 0;
      const step = () => {
        i += 2;
        const partial = words.slice(0, i).join("");
        if (i >= words.length) {
          finalizeTurn(plan.toolCalls, plan.answer, plan.followUps);
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

  const handleStop = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    if (live) finalizeTurn(live.tools, live.text, live.followUps);
    else setLive(null);
  };

  // First message typed on welcome: run it once the thread mounts.
  const autoSendRef = useRef<string | undefined>(autoSend);
  useEffect(() => {
    if (autoSendRef.current) {
      const text = autoSendRef.current;
      autoSendRef.current = undefined;
      const t = window.setTimeout(() => handleSend(text), 350);
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
          {block.attachments.map((name) => (
            <Token key={name} label={name} />
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

  const renderAssistantBlock = (block: AssistantBlock, key: number) => {
    const after = block.toolCallsAfter ?? block.bubbles.length - 1;
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
        {after >= block.bubbles.length ? toolCalls : null}
        <ChatMessageMetadata
          timestamp={<Timestamp value={block.time} format="time" />}
          footer={
            block.footer ? (
              <Text type="supporting" color="secondary">
                {block.footer}
              </Text>
            ) : undefined
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
                      {live == null && followUps && (
                        <HStack gap={2} wrap="wrap">
                          {followUps.map((suggestion) => (
                            <Button
                              key={suggestion}
                              label={suggestion}
                              variant="ghost"
                              size="sm"
                              onClick={() => handleSend(suggestion)}
                            />
                          ))}
                        </HStack>
                      )}
                      <ChatComposer
                      onSubmit={handleSend}
                      onStop={handleStop}
                      isStopShown={live != null}
                      placeholder={
                        composerMode === "ask"
                          ? thread.placeholder
                          : "Ask for a deep, step-by-step explanation..."
                      }
                      input={<ChatComposerInput />}
                      headerActions={
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
                            onClick: () => {},
                          }))}
                        />
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
                      />
                    </VStack>
                  }
                >
                  <ChatMessageList>
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
                      return renderAssistantBlock(block, i);
                    })}
                    {live && (
                      <ChatMessage
                        sender="assistant"
                        avatar={<Avatar name="PESDac" size="md" />}
                      >
                        <ChatToolCalls calls={live.tools} />
                        <ChatMessageBubble variant="ghost">
                          <Markdown density="compact">
                            {live.text + "▍"}
                          </Markdown>
                        </ChatMessageBubble>
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
