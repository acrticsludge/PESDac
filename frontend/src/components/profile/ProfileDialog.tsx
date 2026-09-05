"use client";

import { useEffect, useState } from "react";

import { Layout, VStack, HStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Dialog } from "@astryxdesign/core/Dialog";
import { DialogHeader } from "@astryxdesign/core/Dialog";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import {
  TABS,
  tabFromHash,
  IdentitySection,
  StudySection,
  AssistantSection,
  PrivacySection,
  LegalSection,
  type ProfileTab,
} from "./sections";

// My Profile as a settings-dialog (modal over the chat — settings without
// leaving the conversation). Section list filters as you type; the pane
// swaps beside it. All controls are the same storage-backed rows.
export default function ProfileDialog({
  isOpen,
  initialTab,
  onOpenChange,
}: {
  isOpen: boolean;
  initialTab: ProfileTab;
  onOpenChange: (open: boolean) => void;
}) {
  const [tab, setTab] = useState<ProfileTab>(initialTab);
  const [query, setQuery] = useState("");
  // Fresh open (or new entry tab) resets navigation state.
  useEffect(() => {
    if (isOpen) {
      setTab(initialTab);
      setQuery("");
    }
  }, [isOpen, initialTab]);
  const visible = TABS.filter((t) =>
    t.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      width={920}
      maxHeight="80dvh"
    >
      <Layout
        header={
          <DialogHeader
            title="My Profile"
            hasDivider
            onOpenChange={onOpenChange}
          />
        }
        content={
          <HStack gap={4} vAlign="start" width="100%">
            <VStack
              gap={2}
              style={{ width: 220, flexShrink: 0 }}
            >
              <TextInput
                label="Search settings"
                isLabelHidden
                placeholder="Search settings..."
                startIcon={MagnifyingGlassIcon}
                hasClear
                value={query}
                onChange={setQuery}
              />
              {visible.map((t) => (
                <Button
                  key={t.value}
                  label={`${t.label} settings`}
                  variant={t.value === tab ? "secondary" : "ghost"}
                  width="100%"
                  onClick={() => setTab(t.value)}
                >
                  {t.label}
                </Button>
              ))}
              {visible.length === 0 && (
                <Text type="supporting" color="secondary">
                  No sections match.
                </Text>
              )}
            </VStack>
            <VStack
              gap={4}
              style={{ flex: 1, minWidth: 0, overflowY: "auto" }}
            >
              {tab === "profile" && <IdentitySection />}
              {tab === "study" && <StudySection />}
              {tab === "assistant" && <AssistantSection />}
              {tab === "privacy" && <PrivacySection />}
              {tab === "legal" && <LegalSection />}
            </VStack>
          </HStack>
        }
      />
    </Dialog>
  );
}

export { tabFromHash };
export type { ProfileTab };
