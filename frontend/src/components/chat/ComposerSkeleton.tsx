"use client";

import { VStack, HStack } from "@astryxdesign/core/Layout";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Icon } from "@astryxdesign/core/Icon";
import { ChatComposerInput } from "@astryxdesign/core/Chat";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";

import {
  PaperAirplaneIcon,
  PaperClipIcon,
  AtSymbolIcon,
  MicrophoneIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";

/**
 * Granular composer skeleton — each component skeletons independently.
 * Replaces full-area skeleton with per-element placeholders:
 * - Placeholder text skeleton (where "Ask anything..." renders)
 * - Suggestion card skeletons
 * - Reference menu icon skeleton
 * - Attach menu icon skeleton
 * - Mode selector skeleton
 * - Dictation button skeleton
 * - Send button skeleton
 * Presentational only — no logic, no fetching.
 */
export function ComposerSkeleton() {
  return (
    <VStack gap={3}>
      {/* Composer input area with placeholder skeleton */}
      <VStack gap={2}>
        {/* Placeholder text skeleton */}
        <HStack gap={2} vAlign="center">
          <Skeleton width={200} height={16} radius="rounded" />
          <Skeleton width={120} height={16} radius="rounded" />
          <div style={{ flex: 1 }} />
          {/* Send button skeleton */}
          <Skeleton width={40} height={40} radius="rounded" />
        </HStack>

        {/* Suggestion card skeletons */}
        <HStack gap={2} wrap="wrap">
          <Skeleton width={140} height={32} radius="rounded" />
          <Skeleton width={160} height={32} radius="rounded" />
          <Skeleton width={120} height={32} radius="rounded" />
        </HStack>

        {/* Toolbar: reference @, attach, mode, dictation */}
        <HStack gap={2} vAlign="center" wrap="wrap">
          {/* Reference menu icon skeleton */}
          <Skeleton width={40} height={40} radius="rounded" />
          {/* Attach menu icon skeleton */}
          <Skeleton width={40} height={40} radius="rounded" />
          {/* Mode selector skeleton */}
          <Skeleton width={100} height={36} radius="rounded" />
          <Skeleton width={80} height={36} radius="rounded" />
          <Skeleton width={100} height={36} radius="rounded" />
          {/* Dictation button skeleton */}
          <Skeleton width={40} height={40} radius="rounded" />
        </HStack>
      </VStack>
    </VStack>
  );
}