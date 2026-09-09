"use client";

import { VStack, HStack } from "@astryxdesign/core/Layout";
import { Skeleton } from "@astryxdesign/core/Skeleton";

/**
 * Chat list skeleton rows mirroring ConversationItem/SideNavItem rhythm.
 * Renders `rows` placeholder rows in a VStack gap={0.5} container.
 * Row shape: icon 20×20, label 140×14, menu dot 16×16.
 * Presentational only — no fetching, no logic.
 */
export function ChatListSkeleton({ rows }: { rows: number }) {
  if (rows <= 0) return null;
  return (
    <VStack gap={0.5} aria-busy="true" aria-label="Loading chats">
      {Array.from({ length: rows }, (_, i) => (
        <HStack key={i} gap={2} vAlign="center" padding={1}>
          <Skeleton width={20} height={20} radius="rounded" index={i} />
          <Skeleton width={140} height={14} index={i} />
          <span style={{ marginLeft: "auto", display: "inline-flex" }}>
            <Skeleton width={16} height={16} radius="rounded" index={i} />
          </span>
        </HStack>
      ))}
    </VStack>
  );
}