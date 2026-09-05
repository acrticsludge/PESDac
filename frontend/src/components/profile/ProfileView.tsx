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
import { Switch } from "@astryxdesign/core/Switch";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Divider } from "@astryxdesign/core/Divider";
import {
  getProfile,
  updateProfile,
  useSessionVersion,
} from "../../lib/session";
import { SUBJECTS } from "../../lib/chat";

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

const WEEKLY_GOALS = ["3 days", "5 days", "7 days"].map((g) => ({
  value: g,
  label: `${g} / week`,
}));

const DIFFICULTIES = [
  { value: "easy", label: "Easy — recall and definitions" },
  { value: "medium", label: "Medium — application and worked examples" },
  { value: "hard", label: "Hard — exam-style and edge cases" },
];

function StudySection() {
  useSessionVersion();
  const profile = getProfile();
  const toggleSubject = (subject: string) => {
    const has = profile.subjects.includes(subject);
    updateProfile({
      subjects: has
        ? profile.subjects.filter((s) => s !== subject)
        : [...profile.subjects, subject],
    });
  };
  return (
    <VStack gap={4}>
      <VStack gap={2}>
        <Text type="body" weight="semibold">
          Enrolled subjects
        </Text>
        {SUBJECTS.map((subject) => (
          <Switch
            key={subject}
            label={subject}
            description={`Include ${subject} in study suggestions`}
            value={profile.subjects.includes(subject)}
            onChange={(checked) => toggleSubject(subject)}
          />
        ))}
      </VStack>
      <Divider />
      <VStack gap={3}>
        <TextInput
          label="Semester exams"
          placeholder="e.g. December 2026"
          value={profile.examMonth}
          onChange={(value) => updateProfile({ examMonth: value })}
        />
        <Selector
          label="Weekly study goal"
          options={WEEKLY_GOALS}
          value={profile.weeklyGoal}
          onChange={(value) => updateProfile({ weeklyGoal: value })}
        />
        <Selector
          label="Quiz difficulty"
          description="Shapes future quiz questions; nothing changes in chat yet"
          options={DIFFICULTIES}
          value={profile.difficulty}
          onChange={(value) => updateProfile({ difficulty: value })}
        />
      </VStack>
    </VStack>
  );
}

const DEPTHS = [
  { value: "auto", label: "Auto — match the question" },
  { value: "ask", label: "Ask — short answers first" },
  { value: "deep", label: "Deep — step-by-step by default" },
];

const VERBOSITIES = [
  { value: "concise", label: "Concise" },
  { value: "balanced", label: "Balanced" },
  { value: "thorough", label: "Thorough" },
];

const CITATIONS = [
  { value: "always", label: "Always show sources" },
  { value: "on request", label: "Only on request" },
];

function AssistantSection() {
  useSessionVersion();
  const profile = getProfile();
  return (
    <VStack gap={4}>
      <VStack gap={3}>
        <Selector
          label="Default answer depth"
          options={DEPTHS}
          value={profile.depth}
          onChange={(value) => updateProfile({ depth: value })}
        />
        <Selector
          label="Explanation verbosity"
          options={VERBOSITIES}
          value={profile.verbosity}
          onChange={(value) => updateProfile({ verbosity: value })}
        />
        <Selector
          label="Source citations"
          options={CITATIONS}
          value={profile.citations}
          onChange={(value) => updateProfile({ citations: value })}
        />
      </VStack>
      <Divider />
      <VStack gap={2}>
        <Switch
          label="Proactive quizzes"
          description="Offer a quiz after finishing an explanation"
          value={profile.proactiveQuiz}
          onChange={(checked) => updateProfile({ proactiveQuiz: checked })}
        />
        <Switch
          label="Follow-up suggestions"
          description="Show suggestion pills under each answer"
          value={profile.followUps}
          onChange={(checked) => updateProfile({ followUps: checked })}
        />
      </VStack>
      <Text type="supporting" color="secondary">
        Stored, not wired: the composer keeps its current behavior until
        the backend phase binds these.
      </Text>
    </VStack>
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
            {tab === "study" && <StudySection />}
            {tab === "assistant" && <AssistantSection />}
            {tab === "privacy" && <ComingSoon label="Privacy and data" />}
            {tab === "legal" && <ComingSoon label="Legal" />}
          </VStack>
        </LayoutContent>
      }
    />
  );
}
