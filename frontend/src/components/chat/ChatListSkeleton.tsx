"use client";

import { VStack, HStack } from "@astryxdesign/core/Layout";
import { Skeleton } from "@astryxdesign/core/Skeleton";

/**
 * Chat list skeleton rows mirroring Subjects custom/demo rows.
 * Real Subjects rows (ConversationItem → SideNavItem) are label-only —
 * no icon (only Pinned rows use BookmarkIcon) and MoreMenu is
 * hover-only — so each row is a single label slot. The row holds the
 * real SideNavItem md slot (size-element-md height, spacing-2 label
 * inset) so the swap lands with no shift.
 * Presentational only — no fetching, no logic.
 */
export function ChatListSkeleton({ rows }: { rows: number }) {
  if (rows <= 0) return null;
  return (
    <VStack gap={0.5} aria-busy="true" aria-label="Loading chats">
      {Array.from({ length: rows }, (_, i) => (
        <HStack
          key={i}
          gap={2}
          vAlign="center"
          style={{
            minHeight: "var(--size-element-md)",
            paddingInlineStart: "var(--spacing-2)",
          }}
        >
          <Skeleton width={140} height={14} radius={1} index={i} />
        </HStack>
      ))}
    </VStack>
  );
}