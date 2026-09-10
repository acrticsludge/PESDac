"use client";

import { VStack, HStack } from "@astryxdesign/core/Layout";
import { Skeleton } from "@astryxdesign/core/Skeleton";

/**
 * Composer skeleton — mirrors the EXACT ChatComposer visual structure:
 * - Input area with placeholder skeleton
 * - headerActions: Attach icon skeleton, Reference icon skeleton
 * - footerActions: Mode selector skeleton, Settings icon skeleton
 * - sendActions: Dictation icon skeleton
 * Subject toggles are separate component below (handled by isDisabled={!isUserReady})
 * Presentational only — no logic, no fetching.
 */
export function ComposerSkeleton() {
  return (
    <VStack gap={3} style={{ width: "100%" }}>
      {/* Main composer input area */}
      <VStack gap={2} style={{ width: "100%" }}>
        {/* Input field with placeholder skeleton */}
        <HStack gap={2} vAlign="center" style={{ width: "100%" }}>
          <Skeleton width={200} height={16} radius="rounded" />
          <Skeleton width={120} height={16} radius="rounded" />
          <div style={{ flex: 1 }} />
          {/* Send button skeleton */}
          <Skeleton width={40} height={40} radius="rounded" />
        </HStack>

        {/* headerActions: Attach + Reference icons */}
        <HStack gap={2} vAlign="center">
          <Skeleton width={40} height={40} radius="rounded" />
          <Skeleton width={40} height={40} radius="rounded" />
          <div style={{ flex: 1 }} />
          {/* footerActions: Mode selector + Settings */}
          <Skeleton width={120} height={40} radius="rounded" />
          <Skeleton width={40} height={40} radius="rounded" />
        </HStack>
      </VStack>
    </VStack>
  );
}