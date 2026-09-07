"use client";

// Skeleton placeholder blocks for the Profile dialog sections. Each
// section has its own loading shape that mirrors the real layout —
// an empty card with a few muted blocks at the same positions the
// real rows will land in. Widths are deliberately close to the real
// content's expected width (display name ~140px, email ~200px, row
// control 192px — matches CONTROL_WIDTH in sections.tsx) so the
// transition from skeleton to real rows doesn't reflow the page.

import { VStack, HStack } from "@astryxdesign/core/Layout";
import { Card } from "@astryxdesign/core/Card";
import { Skeleton } from "@astryxdesign/core/Skeleton";

const ROW_WIDTH = 192;

/** One settings-row placeholder (icon + label + control). */
function SkeletonRow({ index }: { index: number }) {
  return (
    <VStack padding={4} gap={2}>
      <HStack gap={3} vAlign="center" width="100%">
        <Skeleton width={20} height={20} radius={2} index={index} />
        <VStack gap={1} style={{ flex: 1, minWidth: 0 }}>
          <Skeleton width={140} height={14} radius={1} index={index} />
          <Skeleton width={200} height={12} radius={1} index={index + 1} />
        </VStack>
        <HStack
          vAlign="center"
          style={{
            width: ROW_WIDTH,
            flexShrink: 0,
            justifyContent: "flex-end",
          }}
        >
          <Skeleton width={ROW_WIDTH} height={32} radius={2} index={index} />
        </HStack>
      </HStack>
    </VStack>
  );
}

/** A divider between skeleton rows (matches CardRows' subtle divider). */
function SkeletonDivider() {
  return (
    <div
      aria-hidden
      style={{
        height: 1,
        backgroundColor: "var(--color-border)",
        opacity: 0.5,
        marginInline: 16,
      }}
    />
  );
}

/**
 * One settings-card placeholder: optional title + muted card with N
 * skeleton rows separated by subtle dividers. Mirrors `SettingsCard`
 * from sections.tsx so the loaded state lands in the same shape.
 */
export function SkeletonCard({
  title,
  rows = 3,
}: {
  title?: string;
  rows?: number;
}) {
  return (
    <VStack gap={1.5} aria-busy="true">
      {title != null && (
        <Skeleton width={80} height={12} radius={1} />
      )}
      <Card padding={0} width="100%" variant="muted">
        <VStack gap={0}>
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} style={{ width: "100%" }}>
              {i > 0 && <SkeletonDivider />}
              <SkeletonRow index={i} />
            </div>
          ))}
        </VStack>
      </Card>
    </VStack>
  );
}

/**
 * Header row placeholder: large avatar circle + name + email block.
 * Mirrors the IdentitySection header (avatar size="lg" + two text
 * lines). 40px circle ≈ Avatar size="lg" diameter.
 */
export function SkeletonIdentityHeader() {
  return (
    <HStack gap={3} vAlign="center" aria-busy="true">
      <Skeleton width={40} height={40} radius="rounded" />
      <VStack gap={1}>
        <Skeleton width={160} height={18} radius={2} />
        <Skeleton width={220} height={14} radius={1} index={1} />
      </VStack>
    </HStack>
  );
}