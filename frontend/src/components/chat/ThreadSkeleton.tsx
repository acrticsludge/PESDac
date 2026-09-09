"use client";

import { VStack } from "@astryxdesign/core/Layout";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { ChatMessage } from "@astryxdesign/core/Chat";
import { Avatar } from "@astryxdesign/core/Avatar";
import { ChatMessageBubble } from "@astryxdesign/core/Chat";
import { ChatMessageMetadata } from "@astryxdesign/core/Chat";

/**
 * Thread skeleton — 3-turn ditto template per spec FR3:
 * - Turn 1 (user): ChatMessage + Avatar + ChatMessageBubble variant="ghost" + VStack gap=2 → Skeleton 180x12 + 120x12
 * - Turn 2 (assistant): ChatMessage + Avatar + ChatMessageBubble variant="ghost" + VStack gap=2 → Skeleton 280x12 + 200x12 + ChatMessageMetadata skeleton (96x10)
 * - Turn 3 (assistant): same as Turn 2 but width=220 + metadata skeleton
 * Toolcall-shape row (160x32 r2) ONLY when loading chat provably had toolcalls — never invented.
 * aria-busy, aria-label="Loading chat history". No isStreaming, no follow-ups, no artifact panel.
 * Presentational only — no fetching, no logic.
 */
export function ThreadSkeleton() {
  return (
    <>
      {/* Turn 1: User */}
      <ChatMessage
        sender="user"
        avatar={<Avatar name="You" size="md" />}
      >
        <ChatMessageBubble variant="ghost">
          <VStack gap={2}>
            <Skeleton width={180} height={12} />
            <Skeleton width={120} height={12} />
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
        <ChatMessageMetadata>
          <Skeleton width={96} height={10} radius="rounded" />
        </ChatMessageMetadata>
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
        <ChatMessageMetadata>
          <Skeleton width={96} height={10} radius="rounded" />
        </ChatMessageMetadata>
      </ChatMessage>
    </>
  );
}