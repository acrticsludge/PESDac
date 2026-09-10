"use client";

import { VStack, HStack } from "@astryxdesign/core/Layout";
import { Skeleton } from "@astryxdesign/core/Skeleton";

/**
 * Composer skeleton — mirrors the ChatComposer body geometry:
 * rounded card (body padding + container radius) with header
 * (Attach + Reference size="sm" slots), input placeholder slot,
 * and footer (Auto + Settings size="md" left, dictation + 32px
 * send right). Paint-only; welcomeText/attachments survive in state.
 * Presentational only — no logic, no fetching.
 */
export function ComposerSkeleton(props: {
  "aria-busy"?: boolean | "true" | "false";
  "aria-label"?: string;
}) {
  return (
    <VStack
      gap={2}
      style={{ width: "100%" }}
      aria-busy={props["aria-busy"]}
      aria-label={props["aria-label"]}
    >
      {/* Card mirrors ChatComposer body: spacing-3 padding, container
          radius, gap-2 rhythm. */}
      <VStack
        gap={2}
        style={{
          width: "100%",
          padding: "var(--spacing-3)",
          borderRadius: "var(--radius-chat)",
          backgroundColor: "var(--color-background-popover)",
        }}
      >
        {/* Header: Attach + Reference icon-only size="sm" slots (28px) */}
        <HStack gap={1} vAlign="center">
          <Skeleton width={28} height={28} radius={2} index={0} />
          <Skeleton width={28} height={28} radius={2} index={1} />
        </HStack>

        {/* Input: placeholder slot — mirrors ChatComposerInput's
            minHeight: 84 (Pesdac.tsx `composerInput` style). The bar sits
            top-aligned like the real placeholder's first line; keep this
            84 in sync if that style ever changes. */}
        <div
          style={{
            minHeight: 84,
            display: "flex",
            alignItems: "flex-start",
            width: "100%",
          }}
        >
          <Skeleton width={220} height={16} radius={1} index={2} />
        </div>

        {/* Footer: Auto + Settings size="md" left, dictation + send
            (32px) right */}
        <HStack gap={1} vAlign="center">
          <Skeleton width={80} height={32} radius={2} index={3} />
          <Skeleton width={90} height={32} radius={2} index={4} />
          <div style={{ flex: 1 }} />
          <Skeleton width={32} height={32} radius="rounded" index={5} />
          <Skeleton width={32} height={32} radius="rounded" index={6} />
        </HStack>
      </VStack>
    </VStack>
  );
}