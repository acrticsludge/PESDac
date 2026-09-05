"use client";

import { useState } from "react";

import {
  Layout,
  LayoutContent,
  VStack,
  HStack,
} from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TabList, Tab } from "@astryxdesign/core/TabList";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Selector } from "@astryxdesign/core/Selector";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Divider } from "@astryxdesign/core/Divider";
import {
  getProfile,
  updateProfile,
  useSessionVersion,
} from "../../lib/session";

export type ProfileTab = "profile" | "study" | "assistant" | "privacy" | "legal";

const TABS: { value: ProfileTab; label: string }[] = [
  { value: "profile", label: "Profile" },
  { value: "study", label: "Study" },
  { value: "assistant", label: "Assistant" },
  { value: "privacy", label: "Privacy" },
  { value: "legal", label: "Legal" },
];

const SEMESTERS = Array.from({ length: 8 }, (_, i) => ({
  value: String(i + 1),
  label: `Semester ${i + 1}`,
}));

const BRANCHES = ["CSE", "ECE", "EEE", "ME", "CE", "BT", "Other"].map((b) => ({
  value: b,
  label: b,
}));

function IdentitySection() {
  useSessionVersion();
  const profile = getProfile();
  return (
    <VStack gap={4}>
      <HStack gap={3} vAlign="center">
        <Avatar
          name={profile.displayName || profile.email || "?"}
          size="lg"
          shape="circle"
        />
        <VStack gap={0}>
          <Text type="body" weight="semibold">
            {profile.displayName || "Your name"}
          </Text>
          <Text type="supporting" color="secondary">
            {profile.email || "you@example.com"}
          </Text>
        </VStack>
      </HStack>
      <Divider />
      <VStack gap={3}>
        <TextInput
          label="Display name"
          placeholder="Your name"
          value={profile.displayName}
          onChange={(value) => updateProfile({ displayName: value })}
        />
        <TextInput
          label="Email"
          placeholder="you@example.com"
          value={profile.email}
          onChange={(value) => updateProfile({ email: value })}
        />
        <TextInput
          label="Institution"
          placeholder="PES University"
          value={profile.institution}
          onChange={(value) => updateProfile({ institution: value })}
        />
        <Selector
          label="Semester"
          placeholder="Select semester"
          hasClear
          options={SEMESTERS}
          value={profile.semester || null}
          onChange={(value) => updateProfile({ semester: value ?? "" })}
        />
        <Selector
          label="Branch"
          placeholder="Select branch"
          hasClear
          options={BRANCHES}
          value={profile.branch || null}
          onChange={(value) => updateProfile({ branch: value ?? "" })}
        />
      </VStack>
    </VStack>
  );
}

// Later slices replace these with the real sections (plan Tasks 4–5).
function ComingSoon({ label }: { label: string }) {
  return (
    <Text type="supporting" color="secondary">
      {label} controls land in the next slice.
    </Text>
  );
}

export default function ProfileView({
  initialTab = "profile",
}: {
  initialTab?: ProfileTab;
} = {}) {
  const [tab, setTab] = useState<ProfileTab>(initialTab);
  return (
    <Layout
      height="fill"
      contentWidth={720}
      content={
        <LayoutContent>
          <VStack gap={4}>
            <VStack gap={1}>
              <Heading level={1}>My Profile</Heading>
              <Text type="supporting" color="secondary">
                Identity, study preferences, and how PESDac handles your
                data.
              </Text>
            </VStack>
            <TabList
              value={tab}
              onChange={(value) => setTab(value as ProfileTab)}
              hasDivider
            >
              {TABS.map((t) => (
                <Tab key={t.value} value={t.value} label={t.label} />
              ))}
            </TabList>
            {tab === "profile" && <IdentitySection />}
            {tab === "study" && <ComingSoon label="Study preference" />}
            {tab === "assistant" && <ComingSoon label="Assistant behavior" />}
            {tab === "privacy" && <ComingSoon label="Privacy and data" />}
            {tab === "legal" && <ComingSoon label="Legal" />}
          </VStack>
        </LayoutContent>
      }
    />
  );
}
