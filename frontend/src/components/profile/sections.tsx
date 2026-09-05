"use client";

import { useState } from "react";

import { VStack, HStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Badge } from "@astryxdesign/core/Badge";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Divider } from "@astryxdesign/core/Divider";
import {
  clearAllChats,
  getProfile,
  updateProfile,
  useSessionVersion,
} from "../../lib/session";
import { SUBJECTS } from "../../lib/chat";

export type ProfileTab =
  | "profile"
  | "study"
  | "assistant"
  | "privacy"
  | "legal";

export const TABS: { value: ProfileTab; label: string }[] = [
  { value: "profile", label: "Profile" },
  { value: "study", label: "Study" },
  { value: "assistant", label: "Assistant" },
  { value: "privacy", label: "Privacy" },
  { value: "legal", label: "Legal" },
];

// Deep-linkable tabs: /profile#study etc. Unknown hashes fall back.
// SSR-safe (no window): server renders the default tab.
export function tabFromHash(): ProfileTab {
  if (typeof window === "undefined") return "profile";
  const hash = window.location.hash.replace(/^#/, "");
  return TABS.some((t) => t.value === hash) ? (hash as ProfileTab) : "profile";
}

const SEMESTERS = Array.from({ length: 8 }, (_, i) => ({
  value: String(i + 1),
  label: `Semester ${i + 1}`,
}));

const BRANCHES = ["CSE", "ECE", "EEE", "ME", "CE", "BT", "Other"].map((b) => ({
  value: b,
  label: b,
}));

export function IdentitySection() {
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

const WEEKLY_GOALS = ["3 days", "5 days", "7 days"].map((g) => ({
  value: g,
  label: `${g} / week`,
}));

const DIFFICULTIES = [
  { value: "easy", label: "Easy — recall and definitions" },
  { value: "medium", label: "Medium — application and worked examples" },
  { value: "hard", label: "Hard — exam-style and edge cases" },
];

export function StudySection() {
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
      <Heading level={3}>Study preferences</Heading>
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

export function AssistantSection() {
  useSessionVersion();
  const profile = getProfile();
  return (
    <VStack gap={4}>
      <Heading level={3}>Assistant behavior</Heading>
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
        Answer depth applies to new messages right away. Verbosity,
        citations, and quiz difficulty bind in the backend phase.
      </Text>
    </VStack>
  );
}

const RETENTIONS = [
  { value: "forever", label: "Keep forever" },
  { value: "1 year", label: "Keep for 1 year" },
  { value: "30 days", label: "Keep for 30 days" },
  { value: "session", label: "Session only" },
];

// Downloads every pesdac-* key as one JSON file. Handler-only window
// access: safe in the SSR island because it runs on click, not render.
function exportAllData() {
  const data: Record<string, unknown> = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key != null && key.startsWith("pesdac-")) {
      const raw = window.localStorage.getItem(key);
      try {
        data[key] = JSON.parse(raw ?? "null");
      } catch {
        data[key] = raw;
      }
    }
  }
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "pesdac-data.json";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function PrivacySection() {
  useSessionVersion();
  const profile = getProfile();
  const [confirmingClear, setConfirmingClear] = useState(false);
  return (
    <VStack gap={4}>
      <Heading level={3}>Privacy &amp; data</Heading>
      <Selector
        label="Chat history retention"
        description="Enforced after the backend phase; stored as your preference today"
        options={RETENTIONS}
        value={profile.retention}
        onChange={(value) => updateProfile({ retention: value })}
      />
      <Divider />
      <VStack gap={2}>
        <Text type="body" weight="semibold">
          Your data
        </Text>
        <HStack gap={2}>
          <Button
            label="Export my data"
            variant="secondary"
            onClick={exportAllData}
          >
            Export my data
          </Button>
          <Button
            label="Delete all chats"
            variant="destructive"
            onClick={() => setConfirmingClear(true)}
          >
            Delete all chats
          </Button>
        </HStack>
        <Text type="supporting" color="secondary">
          Export downloads every saved chat, draft, vote, and preference as
          one JSON file. Delete removes all chats and their messages;
          ratings, drafts, and profile settings are kept.
        </Text>
      </VStack>
      <Divider />
      <Card variant="muted" padding={3} width="100%">
        <Text type="supporting" color="secondary">
          Conversations may be processed or used for training purposes by
          third-party model providers such as NVIDIA. Avoid sharing
          sensitive personal information.
        </Text>
      </Card>
      <AlertDialog
        isOpen={confirmingClear}
        onOpenChange={(open) => {
          if (!open) setConfirmingClear(false);
        }}
        title="Delete all chats?"
        description="Every chat and its messages will be permanently removed. This cannot be undone."
        actionLabel="Delete"
        onAction={() => {
          clearAllChats();
          setConfirmingClear(false);
        }}
      />
    </VStack>
  );
}

const LEGAL_DOCS = [
  {
    name: "Terms of Use",
    summary:
      "The rules for using PESDac: acceptable use, accounts, and liability.",
  },
  {
    name: "Privacy Policy",
    summary:
      "What PESDac stores, why, how long it is kept, and your rights over it.",
  },
  {
    name: "Cookie Notice",
    summary:
      "Which cookies and local storage PESDac uses and what each one does.",
  },
];

export function LegalSection() {
  return (
    <VStack gap={4}>
      <Heading level={3}>Legal</Heading>
      <VStack gap={2}>
        {LEGAL_DOCS.map((doc) => (
          <Collapsible
            key={doc.name}
            trigger={
              <HStack gap={2} vAlign="center" width="100%">
                <Text type="body" weight="semibold">
                  {doc.name}
                </Text>
                <Badge label="Publishes at launch" />
              </HStack>
            }
          >
            <Text type="supporting" color="secondary">
              {doc.summary} The full document publishes at launch.
            </Text>
          </Collapsible>
        ))}
      </VStack>
      <Divider />
      <VStack gap={2}>
        <Text type="body">
          PESDac can make mistakes. Verify important answers against your
          course material.
        </Text>
        <Text type="supporting" color="secondary">
          PESDac is a study aid. Your institution's academic integrity
          policy applies to any submitted work.
        </Text>
      </VStack>
    </VStack>
  );
}
