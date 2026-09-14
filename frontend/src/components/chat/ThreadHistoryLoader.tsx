"use client";

import { VStack } from "@astryxdesign/core/Layout";
import { ChatMessage } from "@astryxdesign/core/Chat";
import { Avatar } from "@astryxdesign/core/Avatar";
import { ChatMessageBubble } from "@astryxdesign/core/Chat";
import { ChatToolCalls } from "@astryxdesign/core/Chat";

/**
 * Thread history loader — one honest running chip in the real assistant
 * shell. Replaces the 3-turn skeleton bar template: claims no structure,
 * animates from frame one (running Spinner), and announces via the chip's
 * role="status" (wrapper keeps aria-busy + aria-label="Loading chat history").
 * Presentational only — no fetching, no logic. `isModalOpen` kills the
 * avatar tooltip while a modal covers it (same stuck-tooltip gate as the
 * thread avatars — a showing tooltip has no mouseleave under a dialog).
 */
export function ThreadHistoryLoader({ isModalOpen }: { isModalOpen?: boolean }) {
  return (
    <VStack gap={4} aria-busy="true" aria-label="Loading chat history">
      <ChatMessage
        sender="assistant"
        avatar={<Avatar name="PESDac" size="md" tooltip={isModalOpen ? false : undefined} />}
      >
        <ChatMessageBubble variant="ghost">
          <ChatToolCalls
            calls={[
              { name: "history", target: "Chat history", status: "running" },
            ]}
          />
        </ChatMessageBubble>
      </ChatMessage>
    </VStack>
  );
}
