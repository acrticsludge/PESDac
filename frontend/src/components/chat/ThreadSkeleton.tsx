"use client";

import { VStack, HStack } from "@astryxdesign/core/Layout";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { ChatMessage } from "@astryxdesign/core/Chat";
import { Avatar } from "@astryxdesign/core/Avatar";
import { ChatMessageBubble } from "@astryxdesign/core/Chat";
import { ChatMessageMetadata } from "@astryxdesign/core/Chat";

/**
 * Thread skeleton — 3-turn ditto template mirroring the real shells in
 * ThreadView (`renderUserBlock` / `renderAssistantBlock`):
 * - Turn 1 (user): ChatMessage sender="user" with NO avatar + default
 *   FILLED ChatMessageBubble (no ghost, no group) with short-pill bars
 *   (140x12 + 96x12, right-aligned by the sender context) + bubble
 *   `metadata` carrying ChatMessageMetadata (timestamp 64x10 slot +
 *   28x28 edit-icon reserve).
 * - Turns 2-3 (assistant): ChatMessage sender="assistant" + Avatar
 *   PESDac md + ghost bubbles (280+200 / 220 widths kept) +
 *   ChatMessageMetadata (timestamp 64x10 + footer 120x10 + three 28x28
 *   copy/vote/regenerate action reserves).
 * No toolcall-shape row: the proof-only rule stands and this component
 * takes no props, so no loading chat can prove toolcalls here — never
 * invented. No follow-ups, no artifact panel, no isStreaming.
 * Wrapper VStack gap=4 matches the ChatMessageList balanced inner gap
 * (the list's only gap source), so the swap lands with no reflow.
 * aria-busy + aria-label="Loading chat history".
 * Presentational only — no fetching, no logic.
 */
export function ThreadSkeleton() {
  return (
    <VStack gap={4} aria-busy="true" aria-label="Loading chat history">
      {/* Turn 1: User */}
      <ChatMessage sender="user">
        <ChatMessageBubble
          metadata={
            <ChatMessageMetadata
              timestamp={<Skeleton width={64} height={10} />}
              footer={<Skeleton width={28} height={28} radius={2} />}
            />
          }
        >
          <VStack gap={2}>
            <Skeleton width={140} height={12} />
            <Skeleton width={96} height={12} />
          </VStack>
        </ChatMessageBubble>
      </ChatMessage>

      {/* Turn 2: Assistant (first) */}
      <ChatMessage
        sender="assistant"
        avatar={<Avatar name="PESDac" size="md" />}
      >
        <ChatMessageBubble variant="ghost">
          <VStack gap={2}>
            <Skeleton width={280} height={12} />
            <Skeleton width={200} height={12} />
          </VStack>
        </ChatMessageBubble>
        <ChatMessageMetadata
          timestamp={<Skeleton width={64} height={10} />}
          footer={
            <HStack gap={1} vAlign="center">
              <Skeleton width={120} height={10} />
              <Skeleton width={28} height={28} radius={2} />
              <Skeleton width={28} height={28} radius={2} />
              <Skeleton width={28} height={28} radius={2} />
            </HStack>
          }
        />
      </ChatMessage>

      {/* Turn 3: Assistant (second) */}
      <ChatMessage
        sender="assistant"
        avatar={<Avatar name="PESDac" size="md" />}
      >
        <ChatMessageBubble variant="ghost">
          <VStack gap={2}>
            <Skeleton width={220} height={12} />
          </VStack>
        </ChatMessageBubble>
        <ChatMessageMetadata
          timestamp={<Skeleton width={64} height={10} />}
          footer={
            <HStack gap={1} vAlign="center">
              <Skeleton width={120} height={10} />
              <Skeleton width={28} height={28} radius={2} />
              <Skeleton width={28} height={28} radius={2} />
              <Skeleton width={28} height={28} radius={2} />
            </HStack>
          }
        />
      </ChatMessage>
    </VStack>
  );
}
