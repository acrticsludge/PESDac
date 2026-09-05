"use client";

import { useEffect, useState, type ComponentType, type SVGProps } from "react";

import { Layout, VStack, HStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TabList, Tab } from "@astryxdesign/core/TabList";
import { Dialog } from "@astryxdesign/core/Dialog";
import { DialogHeader } from "@astryxdesign/core/Dialog";
import { SideNav, SideNavSection, SideNavItem } from "@astryxdesign/core/SideNav";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import {
  MagnifyingGlassIcon,
  UserCircleIcon,
  BookOpenIcon,
  SparklesIcon,
  ShieldCheckIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";
import {
  TABS,
  IdentitySection,
  StudySection,
  AssistantSection,
  PrivacySection,
  LegalSection,
  type ProfileTab,
} from "./sections";

export type { ProfileTab };

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const NAV_GROUPS: {
  label: string;
  tabs: { value: ProfileTab; label: string; icon: IconComponent }[];
}[] = [
  {
    label: "Account",
    tabs: [{ value: "profile", label: "Profile", icon: UserCircleIcon }],
  },
  {
    label: "Preferences",
    tabs: [
      { value: "study", label: "Study", icon: BookOpenIcon },
      { value: "assistant", label: "Assistant", icon: SparklesIcon },
    ],
  },
  {
    label: "Data & legal",
    tabs: [
      { value: "privacy", label: "Privacy", icon: ShieldCheckIcon },
      { value: "legal", label: "Legal", icon: DocumentTextIcon },
    ],
  },
];

const PANEL_META: Record<ProfileTab, { heading: string; description: string }> =
  {
    profile: {
      heading: "Profile",
      description: "How you appear across PESDac.",
    },
    study: {
      heading: "Study",
      description: "Subjects, schedule, and quiz level.",
    },
    assistant: {
      heading: "Assistant",
      description: "How answers behave by default.",
    },
    privacy: {
      heading: "Privacy",
      description: "What is kept, what leaves, and who may process it.",
    },
    legal: {
      heading: "Legal",
      description: "The documents behind the product.",
    },
  };

// My Profile as a settings-dialog (modal over the chat — settings without
// leaving the conversation): grouped icon rail + searchable sections on
// desktop, search + tab strip below 640px. All controls are the same
// storage-backed rows.
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
  const isNarrow = useMediaQuery("(max-width: 640px)");
  // Fresh open (or new entry tab) resets navigation state.
  useEffect(() => {
    if (isOpen) {
      setTab(initialTab);
      setQuery("");
    }
  }, [isOpen, initialTab]);
  const matches = (label: string) =>
    label.toLowerCase().includes(query.trim().toLowerCase());
  const visibleGroups = NAV_GROUPS.map((g) => ({
    ...g,
    tabs: g.tabs.filter((t) => matches(t.label)),
  })).filter((g) => g.tabs.length > 0);
  const visibleTabs = TABS.filter((t) => matches(t.label));
  const meta = PANEL_META[tab];
  const pane = (
    <VStack gap={4} style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
      <VStack gap={0.5}>
        <Heading level={2}>{meta.heading}</Heading>
        <Text type="supporting" color="secondary">
          {meta.description}
        </Text>
      </VStack>
      {tab === "profile" && <IdentitySection />}
      {tab === "study" && <StudySection />}
      {tab === "assistant" && <AssistantSection />}
      {tab === "privacy" && <PrivacySection />}
      {tab === "legal" && <LegalSection />}
    </VStack>
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
          isNarrow ? (
            <VStack gap={3}>
              <TextInput
                label="Search settings"
                isLabelHidden
                placeholder="Search settings..."
                startIcon={MagnifyingGlassIcon}
                hasClear
                value={query}
                onChange={setQuery}
              />
              <TabList
                value={tab}
                onChange={(value) => setTab(value as ProfileTab)}
                hasDivider
              >
                {visibleTabs.map((t) => (
                  <Tab key={t.value} value={t.value} label={t.label} />
                ))}
              </TabList>
              {visibleTabs.length === 0 ? (
                <Text type="supporting" color="secondary">
                  No sections match.
                </Text>
              ) : (
                pane
              )}
            </VStack>
          ) : (
            <HStack gap={4} vAlign="start" width="100%">
              <VStack style={{ width: 248, flexShrink: 0 }}>
                <SideNav
                  topContent={
                    <TextInput
                      label="Search settings"
                      isLabelHidden
                      placeholder="Search settings..."
                      startIcon={MagnifyingGlassIcon}
                      hasClear
                      value={query}
                      onChange={setQuery}
                    />
                  }
                >
                  {visibleGroups.map((group) => (
                    <SideNavSection key={group.label} title={group.label}>
                      {group.tabs.map((t) => (
                        <SideNavItem
                          key={t.value}
                          label={t.label}
                          icon={
                            <Icon
                              icon={t.icon}
                              size="sm"
                              color="primary"
                            />
                          }
                          isSelected={t.value === tab}
                          onClick={() => setTab(t.value)}
                        />
                      ))}
                    </SideNavSection>
                  ))}
                  {visibleGroups.length === 0 && (
                    <Text type="supporting" color="secondary">
                      No sections match.
                    </Text>
                  )}
                </SideNav>
              </VStack>
              {pane}
            </HStack>
          )
        }
      />
    </Dialog>
  );
}
