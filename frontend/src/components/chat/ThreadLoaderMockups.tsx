"use client";

import { Theme } from "@astryxdesign/core/theme";
import { PESDacMockupTheme } from "../../theme/PESDacMockupTheme";
import { VStack, HStack } from "@astryxdesign/core/Layout";
import { Text, Heading } from "@astryxdesign/core/Text";
import { Card } from "@astryxdesign/core/Card";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import {
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatToolCalls,
} from "@astryxdesign/core/Chat";

/**
 * Dev-only mockups for the thread history-loader exploration.
 * Each option renders inside a real ChatMessageList so spacing,
 * density, and animation match the thread view exactly.
 * Presentational only — no fetching, no session, no logic.
 * Route: /mockups (see src/pages/mockups.astro).
 */
function MockupSection({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <VStack gap={3}>
      <VStack gap={1}>
        <Heading level={2}>{title}</Heading>
        <Text type="supporting" color="secondary">
          {body}
        </Text>
      </VStack>
      <Card variant="muted" padding={4}>
        <ChatMessageList>{children}</ChatMessageList>
      </Card>
    </VStack>
  );
}

function OptionAWorkingRow() {
  return (
    <ChatMessage
      sender="assistant"
      avatar={<Avatar name="PESDac" size="md" />}
    >
      <ChatMessageBubble variant="ghost">
        <HStack gap={2} vAlign="center">
          <Spinner size="sm" />
          <Text type="supporting" color="secondary">
            Loading chat history…
          </Text>
        </HStack>
      </ChatMessageBubble>
    </ChatMessage>
  );
}

function OptionBToolcallChip() {
  return (
    <ChatMessage
      sender="assistant"
      avatar={<Avatar name="PESDac" size="md" />}
    >
      <ChatToolCalls
        calls={[
          { name: "history", target: "Chat history", status: "running" },
        ]}
      />
    </ChatMessage>
  );
}

function OptionCTypingDots() {
  return (
    <VStack gap={0} aria-busy="true" aria-label="Loading chat history">
      <ChatMessage
        sender="assistant"
        avatar={<Avatar name="PESDac" size="md" />}
      >
        <ChatMessageBubble variant="ghost">
          <HStack gap={1} vAlign="center" aria-hidden="true">
            <Skeleton width={8} height={8} radius="rounded" index={0} />
            <Skeleton width={8} height={8} radius="rounded" index={1} />
            <Skeleton width={8} height={8} radius="rounded" index={2} />
          </HStack>
        </ChatMessageBubble>
      </ChatMessage>
    </VStack>
  );
}

export default function ThreadLoaderMockups() {
  return (
    <Theme theme={PESDacMockupTheme} mode="dark">
      <div style={{ maxWidth: 720, marginInline: "auto", width: "100%" }}>
        <VStack gap={8}>
          <VStack gap={1}>
            <Heading level={1}>Thread loader mockups</Heading>
            <Text type="body" color="secondary">
              Each option as it would appear while a chat&apos;s history
              loads. Animations are live — compare motion, height, and how
              much structure each one claims.
            </Text>
          </VStack>

          <MockupSection
            title="Option A — assistant working row (recommended)"
            body="One honest status row: PESDac avatar, spinner, and text. Animates from frame one, announces via role=status, claims no structure."
          >
            <OptionAWorkingRow />
          </MockupSection>

          <MockupSection
            title="Option B — running toolcall chip (shipped)"
            body="History fetch dressed as a running tool call, matching the retrieve/search chip language in real turns. Shipped as ThreadHistoryLoader."
          >
            <OptionBToolcallChip />
          </MockupSection>

          <MockupSection
            title="Option C — typing dots (same Skeleton pulse)"
            body="Three pulsing Skeleton dots with staggered indices — literally the same shimmer keyframes, zero content mimicry."
          >
            <OptionCTypingDots />
          </MockupSection>
        </VStack>
      </div>
    </Theme>
  );
}
