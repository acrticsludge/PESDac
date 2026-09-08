"use client";

import { useEffect, useState, type ComponentType, type SVGProps } from "react";

import {
  Layout,
  LayoutPanel,
  LayoutContent,
  VStack,
} from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TabList, Tab } from "@astryxdesign/core/TabList";
import { Dialog } from "@astryxdesign/core/Dialog";
import { DialogHeader } from "@astryxdesign/core/Dialog";
import {
  SideNav,
  SideNavSection,
  SideNavItem,
} from "@astryxdesign/core/SideNav";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import {
  MagnifyingGlassIcon,
  UserCircleIcon,
  BookOpenIcon,
  SparklesIcon,
  CommandLineIcon,
  LanguageIcon,
  ShieldCheckIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";
import {
  IdentitySection,
  AuthenticationSection,
  StudySection,
  AssistantSection,
  ShortcutsSection,
  LanguageSection,
  PrivacySection,
  LegalSection,
} from "./sections";
import { TABS, type ProfileTab } from "./profile-tabs";

export type { ProfileTab };

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const NAV_GROUPS: {
  label: string;
  tabs: { value: ProfileTab; label: string; icon: IconComponent }[];
}[] = [
  {
    label: "Account",
    tabs: [
      { value: "profile", label: "Profile", icon: UserCircleIcon },
      { value: "authentication", label: "Authentication", icon: ShieldCheckIcon },
    ],
  },
  {
    label: "Preferences",
    tabs: [
      { value: "study", label: "Study", icon: BookOpenIcon },
      { value: "assistant", label: "Assistant", icon: SparklesIcon },
      { value: "shortcuts", label: "Shortcuts", icon: CommandLineIcon },
      { value: "language", label: "Language", icon: LanguageIcon },
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
    authentication: {
      heading: "Authentication",
      description: "Google account, 2FA, and account security.",
    },
    study: {
      heading: "Study",
      description: "Schedule and quiz level.",
    },
    assistant: {
      heading: "Assistant",
      description: "How answers behave by default.",
    },
    shortcuts: {
      heading: "Keyboard shortcuts",
      description: "Switch off any shortcut on this surface.",
    },
    language: {
      heading: "Language & region",
      description: "Language, formats, and time zone.",
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

function ActivePane({ tab }: { tab: ProfileTab }) {
  const meta = PANEL_META[tab];
  return (
    <VStack gap={4}>
      <VStack gap={0.5}>
        <Heading level={2}>{meta.heading}</Heading>
        <Text type="supporting" color="secondary">
          {meta.description}
        </Text>
      </VStack>
      {tab === "profile" && <IdentitySection />}
      {tab === "authentication" && <AuthenticationSection />}
      {tab === "study" && <StudySection />}
      {tab === "assistant" && <AssistantSection />}
      {tab === "shortcuts" && <ShortcutsSection />}
      {tab === "language" && <LanguageSection />}
      {tab === "privacy" && <PrivacySection />}
      {tab === "legal" && <LegalSection />}
    </VStack>
  );
}

// My Profile as a settings-dialog (modal over the chat — settings without
// leaving the conversation): grouped icon rail + searchable sections on
// desktop, search + tab strip below 640px. Scroll and zone sizing belong
// to Layout (start panel + scrollable content), never to inline styles.
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
  const searchBox = (
    <TextInput
      label="Search settings"
      isLabelHidden
      placeholder="Search settings..."
      startIcon={MagnifyingGlassIcon}
      hasClear
      value={query}
      onChange={setQuery}
    />
  );
  const noMatch = (
    <Text type="supporting" color="secondary">
      No sections match.
    </Text>
  );
  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      // Relative, like the template's 1120: room to fit on desktop,
      // shrink-to-viewport on small screens — no viewport overflow.
      width="min(1120px, calc(100vw - 2rem))"
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
        start={
          isNarrow ? undefined : (
            // 260px = SideNav's natural width, padding={0} because the
            // panel is border-box: default 16px padding would leave a
            // 228px content box and clip the rail with a scrollbar.
            <LayoutPanel width={260} padding={0} role="navigation">
              <SideNav
                topContent={searchBox}
              >
                {visibleGroups.map((group) => (
                  <SideNavSection key={group.label} title={group.label}>
                    {group.tabs.map((t) => (
                      <SideNavItem
                        key={t.value}
                        label={t.label}
                        icon={
                          <Icon icon={t.icon} size="sm" color="primary" />
                        }
                        isSelected={t.value === tab}
                        onClick={() => setTab(t.value)}
                      />
                    ))}
                  </SideNavSection>
                ))}
                {visibleGroups.length === 0 && noMatch}
              </SideNav>
            </LayoutPanel>
          )
        }
        content={
          <LayoutContent>
            {isNarrow ? (
              <VStack gap={3}>
                {searchBox}
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
                  noMatch
                ) : (
                  <ActivePane tab={tab} />
                )}
              </VStack>
            ) : (
              <ActivePane tab={tab} />
            )}
          </LayoutContent>
        }
      />
    </Dialog>
  );
}
