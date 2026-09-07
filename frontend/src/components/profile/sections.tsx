"use client";

import { useState, type ReactNode, type ComponentType, type SVGProps } from "react";
import { useToast } from "@astryxdesign/core/Toast";

import {
  VStack,
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
} from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { Kbd } from "@astryxdesign/core/Kbd";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Selector } from "@astryxdesign/core/Selector";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Switch } from "@astryxdesign/core/Switch";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Card } from "@astryxdesign/core/Card";
import { Badge } from "@astryxdesign/core/Badge";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { CollapsibleGroup } from "@astryxdesign/core/Collapsible";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Banner } from "@astryxdesign/core/Banner";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Divider } from "@astryxdesign/core/Divider";
import {
  UserIcon,
  EnvelopeIcon,
  AcademicCapIcon,
  CalendarDaysIcon,
  Squares2X2Icon,
  ClockIcon,
  CheckCircleIcon,
  SparklesIcon,
  Cog6ToothIcon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  ArrowDownTrayIcon,
  TrashIcon,
  PlusIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
  LanguageIcon,
  GlobeAltIcon,
  KeyIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import {
  clearAllChats,
  dumpStore,
  getProfile,
  updateProfile,
  useSessionVersion,
} from "../../lib/session";
import { useAuth, useProfile, useAccounts, linkGoogle, unlinkAccount, enableTwoFactor, verifyTwoFactorSetup, disableTwoFactor, changePassword, apiDeleteAccount, apiFetch, apiUpdateProfile, toUserMessage, MIN_PASSWORD_LENGTH } from "../../lib/auth";
import { navigate } from "astro:transitions/client";
import {
  BRANCHES,
  CAMPUSES,
  SEMESTERS,
} from "../../lib/profile-options";

export type ProfileTab =
  | "profile"
  | "authentication"
  | "study"
  | "assistant"
  | "shortcuts"
  | "language"
  | "privacy"
  | "legal";

export const TABS: { value: ProfileTab; label: string }[] = [
  { value: "profile", label: "Profile" },
  { value: "authentication", label: "Authentication" },
  { value: "study", label: "Study" },
  { value: "assistant", label: "Assistant" },
  { value: "shortcuts", label: "Shortcuts" },
  { value: "language", label: "Language" },
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

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/** The one control-column width, so controls align down the panel. */
const CONTROL_WIDTH = 192;

/**
 * A filled, divided group of settings rows (settings-dialog idiom): muted
 * Card, no padding (rows carry the inset so dividers stay full-bleed),
 * subtle dividers between rows only.
 */
function SettingsCard({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <VStack gap={1.5}>
      {title != null && (
        <Text type="supporting" weight="semibold" color="secondary">
          {title}
        </Text>
      )}
      <Card padding={0} width="100%" variant="muted">
        <VStack gap={0}>
          {children}
        </VStack>
      </Card>
    </VStack>
  );
}

/**
 * One setting: icon + name + explanation on the left, the control on the
 * right in the shared column. The row owns the visible label, so every
 * control inside one keeps `isLabelHidden`.
 */
function SettingsRow({
  title,
  description,
  icon,
  control,
}: {
  title: string;
  description?: string;
  /** Required: every row carries one, so titles align down the card. */
  icon: IconComponent;
  control?: ReactNode;
}) {
  return (
    <VStack padding={4} gap={2}>
      <HStack gap={3} vAlign="center" width="100%">
        <Icon icon={icon} size="sm" color="secondary" />
        <VStack gap={0.5} style={{ flex: 1, minWidth: 0 }}>
          <Text type="label">{title}</Text>
          {description != null && (
            <Text type="supporting" color="secondary">
              {description}
            </Text>
          )}
        </VStack>
        {control != null && (
          <HStack
            vAlign="center"
            style={{
              width: CONTROL_WIDTH,
              flexShrink: 0,
              justifyContent: "flex-end",
            }}
          >
            {control}
          </HStack>
        )}
      </HStack>
    </VStack>
  );
}

/** Card wrapper that inserts subtle dividers between its rows. */
function CardRows({ children }: { children: ReactNode }) {
  const rows = Array.isArray(children) ? children : [children];
  return (
    <>
      {rows.map((row, i) => (
        <VStack key={i} gap={0}>
          {i > 0 && <Divider variant="subtle" />}
          {row}
        </VStack>
      ))}
    </>
  );
}

export function IdentitySection() {
  useSessionVersion();
  const auth = useAuth();
  const serverProfile = useProfile();
  const profile = getProfile();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSavingIdentity, setIsSavingIdentity] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // TODO(BetterAuth): email + displayName are account-owned — read-only
  // when authenticated. Logged out the local store remains editable.
  // Server row wins; while it loads, the session name/email stand in so
  // the rows stay read-only instead of flickering to editable inputs.
  const serverUser =
    serverProfile.status === "ready"
      ? serverProfile.user
      : auth.status === "authenticated"
        ? { displayName: auth.user.name, email: auth.user.email }
        : null;
  const authUser = serverUser;
  const displayName = authUser?.displayName || profile.displayName;
  const email = authUser?.email || profile.email;

  // Delete the PESDac identity (users + profile + chats), then route to
  // /signup for a fresh start.
  async function handleDeleteAccount() {
    setIsDeleting(true);
    setDeleteNotice(null);
    try {
      const { fallback } = await apiDeleteAccount();
      setIsDeleting(false);
      setConfirmingDelete(false);
      if (fallback) {
        setDeleteNotice(
          "Deletion was incomplete — your sign-in is gone but some " +
            "PESDac data may remain. Contact support to finish deletion.",
        );
        return;
      }
    } catch (error) {
      setIsDeleting(false);
      setDeleteNotice(toUserMessage(error, "Couldn't delete your account. Try again."));
      return;
    }
    navigate("/signup");
  }

  // Identity fields synced to the server row (auth audit G1/G11):
  // campus/semester/branch live in the backend profile; the local store
  // mirrors for instant UI. Writes go to the server first — on failure
  // the local edit is reverted and a Banner names it, so the two can
  // never silently diverge. Campus writes both `campus` and the legacy
  // `institution` key to the same value so readers of either agree.
  async function saveIdentity(
    patch: Record<string, string>,
    local: { institution?: string; semester?: string; branch?: string },
  ) {
    if (isSavingIdentity) return;
    const prev = getProfile();
    updateProfile(local);
    setSaveError(null);
    setIsSavingIdentity(true);
    try {
      await apiUpdateProfile(patch);
    } catch (error) {
      updateProfile({
        institution: prev.institution,
        semester: prev.semester,
        branch: prev.branch,
      });
      setSaveError(toUserMessage(error, "Couldn't save. Try again."));
    } finally {
      setIsSavingIdentity(false);
    }
  }

  return (
    <VStack gap={5}>
      <HStack gap={3} vAlign="center">
        <Avatar
          name={displayName || email || "?"}
          size="lg"
          shape="circle"
        />
        <VStack gap={0}>
          <Text type="body" weight="semibold">
            {displayName || "Your name"}
          </Text>
          <Text type="supporting" color="secondary">
            {email || "you@example.com"}
          </Text>
        </VStack>
      </HStack>
      {deleteNotice != null && (
        <Banner
          status="error"
          title="Account deletion"
          description={deleteNotice}
        />
      )}
      {saveError != null && (
        <Banner
          status="error"
          title="Couldn't save your profile"
          description={saveError}
        />
      )}
      <SettingsCard title="Identity">
        <CardRows>
          <SettingsRow
            title="Display name"
            description={
              authUser != null
                ? "Managed by your account."
                : "Shown across PESDac."
            }
            icon={UserIcon}
            control={
              authUser != null ? (
                <Text type="body" maxLines={1}>
                  {displayName || "—"}
                </Text>
              ) : (
                <TextInput
                  label="Display name"
                  isLabelHidden
                  size="sm"
                  width={CONTROL_WIDTH}
                  placeholder="Your name"
                  value={profile.displayName}
                  onChange={(value) => updateProfile({ displayName: value })}
                />
              )
            }
          />
          <SettingsRow
            title="Email"
            description={
              authUser != null
                ? "Managed by your account."
                : "Where account notices are sent."
            }
            icon={EnvelopeIcon}
            control={
              authUser != null ? (
                <Text type="body" maxLines={1}>
                  {email || "—"}
                </Text>
              ) : (
                <TextInput
                  label="Email"
                  isLabelHidden
                  size="sm"
                  width={CONTROL_WIDTH}
                  placeholder="you@example.com"
                  value={profile.email}
                  onChange={(value) => updateProfile({ email: value })}
                />
              )
            }
          />
          <SettingsRow
            title="Campus"
            description="Your PES University campus."
            icon={AcademicCapIcon}            control={
              <Selector
                label="Campus"
                isLabelHidden
                size="sm"
                width={CONTROL_WIDTH}
                placeholder="Select"
                hasClear
                options={CAMPUSES}
                value={profile.institution || null}
                isLoading={isSavingIdentity}
                isDisabled={isSavingIdentity}
                onChange={(value) =>
                  void saveIdentity(
                    { campus: value ?? "", institution: value ?? "" },
                    { institution: value ?? "" },
                  )
                }
              />
            }
          />
          <SettingsRow
            title="Semester"
            icon={CalendarDaysIcon}
            control={
              <Selector
                label="Semester"
                isLabelHidden
                size="sm"
                width={CONTROL_WIDTH}
                placeholder="Select"
                hasClear
                options={SEMESTERS}
                value={profile.semester || null}
                isLoading={isSavingIdentity}
                isDisabled={isSavingIdentity}
                onChange={(value) =>
                  void saveIdentity(
                    { semester: value ?? "" },
                    { semester: value ?? "" },
                  )
                }
              />
            }
          />
          <SettingsRow
            title="Branch"
            icon={Squares2X2Icon}
            control={
              <Selector
                label="Branch"
                isLabelHidden
                size="sm"
                width={CONTROL_WIDTH}
                placeholder="Select"
                hasClear
                options={BRANCHES}
                value={profile.branch || null}
                isLoading={isSavingIdentity}
                isDisabled={isSavingIdentity}
                onChange={(value) =>
                  void saveIdentity(
                    { branch: value ?? "" },
                    { branch: value ?? "" },
                  )
                }
              />
            }
          />
        </CardRows>
      </SettingsCard>
      <SettingsCard title="Danger zone">
        <CardRows>
          <SettingsRow
            title="Delete account"
            description="Removes your PESDac identity, profile, chats."
            icon={TrashIcon}
            control={
              <Button
                label="Delete account"
                variant="destructive"
                size="sm"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </Button>
            }
          />
        </CardRows>
      </SettingsCard>
      <Text type="supporting" color="secondary">
        Account management will be handled by BetterAuth.
      </Text>
      <Dialog
        isOpen={confirmingDelete}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmingDelete(false);
            setIsDeleting(false);
          }
        }}
        purpose="form"
      >
        <Layout
          header={
            <DialogHeader
              title="Delete your account?"
              hasDivider
              onOpenChange={(open) => {
                if (!open) {
                  setConfirmingDelete(false);
                  setIsDeleting(false);
                }
              }}
            />
          }
          content={
            <LayoutContent>
              <VStack gap={3}>
                <Text type="body" color="secondary">
                  Everything you did on PESDac is permanently erased. This
                  cannot be undone.
                </Text>
              </VStack>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack gap={2}>
                <Button
                  label="Cancel"
                  variant="ghost"
                  onClick={() => {
                    setConfirmingDelete(false);
                    setIsDeleting(false);
                  }}
                />
                <Button
                  label="Delete"
                  variant="destructive"
                  isLoading={isDeleting}
                  isDisabled={isDeleting}
                  onClick={() => void handleDeleteAccount()}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
    </VStack>
  );
}

const WEEKLY_GOALS = [
  { value: "3 days", label: "3 days" },
  { value: "5 days", label: "5 days" },
  { value: "7 days", label: "7 days" },
];

const DIFFICULTIES = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

export function StudySection() {
  useSessionVersion();
  const profile = getProfile();
  return (
    <VStack gap={5}>
      <SettingsCard title="Schedule & level">
        <CardRows>
          <SettingsRow
            title="Semester exams"
            description="When your exams land."
            icon={CalendarDaysIcon}
            control={
              <TextInput
                label="Semester exams"
                isLabelHidden
                size="sm"
                width={CONTROL_WIDTH}
                placeholder="December 2026"
                value={profile.examMonth}
                onChange={(value) => updateProfile({ examMonth: value })}
              />
            }
          />
          <SettingsRow
            title="Weekly study goal"
            description="Days per week you aim to study."
            icon={CheckCircleIcon}
            control={
              <SegmentedControl
                label="Weekly study goal"
                size="sm"
                value={profile.weeklyGoal}
                onChange={(value) => updateProfile({ weeklyGoal: value })}
              >
                {WEEKLY_GOALS.map((g) => (
                  <SegmentedControlItem
                    key={g.value}
                    value={g.value}
                    label={g.label}
                  />
                ))}
              </SegmentedControl>
            }
          />
          <SettingsRow
            title="Quiz difficulty"
            description="Shapes future quiz questions; nothing changes in chat yet."
            icon={SparklesIcon}
            control={
              <SegmentedControl
                label="Quiz difficulty"
                size="sm"
                value={profile.difficulty}
                onChange={(value) => updateProfile({ difficulty: value })}
              >
                {DIFFICULTIES.map((d) => (
                  <SegmentedControlItem
                    key={d.value}
                    value={d.value}
                    label={d.label}
                  />
                ))}
              </SegmentedControl>
            }
          />
        </CardRows>
      </SettingsCard>
    </VStack>
  );
}

const DEPTHS = [
  { value: "auto", label: "Auto" },
  { value: "ask", label: "Ask" },
  { value: "deep", label: "Deep" },
];

const VERBOSITIES = [
  { value: "concise", label: "Concise" },
  { value: "balanced", label: "Balanced" },
  { value: "thorough", label: "Thorough" },
];

const CITATIONS = [
  { value: "always", label: "Always" },
  { value: "on request", label: "On request" },
];

export function AssistantSection() {
  useSessionVersion();
  const profile = getProfile();
  return (
    <VStack gap={5}>
      <SettingsCard title="Answers">
        <CardRows>
          <SettingsRow
            title="Default answer depth"
            description="Auto matches the question, Ask keeps it short, Deep gives the chapter."
            icon={Cog6ToothIcon}
            control={
              <SegmentedControl
                label="Default answer depth"
                size="sm"
                value={profile.depth}
                onChange={(value) => updateProfile({ depth: value })}
              >
                {DEPTHS.map((d) => (
                  <SegmentedControlItem
                    key={d.value}
                    value={d.value}
                    label={d.label}
                  />
                ))}
              </SegmentedControl>
            }
          />
          <SettingsRow
            title="Explanation verbosity"
            icon={ChatBubbleLeftRightIcon}
            control={
              <SegmentedControl
                label="Explanation verbosity"
                size="sm"
                value={profile.verbosity}
                onChange={(value) => updateProfile({ verbosity: value })}
              >
                {VERBOSITIES.map((v) => (
                  <SegmentedControlItem
                    key={v.value}
                    value={v.value}
                    label={v.label}
                  />
                ))}
              </SegmentedControl>
            }
          />
          <SettingsRow
            title="Source citations"
            icon={DocumentTextIcon}
            control={
              <SegmentedControl
                label="Source citations"
                size="sm"
                value={profile.citations}
                onChange={(value) => updateProfile({ citations: value })}
              >
                {CITATIONS.map((c) => (
                  <SegmentedControlItem
                    key={c.value}
                    value={c.value}
                    label={c.label}
                  />
                ))}
              </SegmentedControl>
            }
          />
        </CardRows>
      </SettingsCard>
      <SettingsCard title="Follow-ups">
        <CardRows>
          <SettingsRow
            title="Proactive quizzes"
            description="Offer a quiz after finishing an explanation."
            icon={SparklesIcon}
            control={
              <Switch
                label="Proactive quizzes"
                isLabelHidden
                value={profile.proactiveQuiz}
                onChange={(checked) =>
                  updateProfile({ proactiveQuiz: checked })
                }
              />
            }
          />
          <SettingsRow
            title="Follow-up suggestions"
            description="Show suggestion pills under each answer."
            icon={ChatBubbleLeftRightIcon}
            control={
              <Switch
                label="Follow-up suggestions"
                isLabelHidden
                value={profile.followUps}
                onChange={(checked) => updateProfile({ followUps: checked })}
              />
            }
          />
        </CardRows>
      </SettingsCard>
      <Text type="supporting" color="secondary">
        Answer depth applies to new messages right away. Verbosity,
        citations, and quiz difficulty bind in the backend phase.
      </Text>
    </VStack>
  );
}

const SHORTCUT_ROWS: {
  key: "shortcutNewChat" | "shortcutCancel" | "shortcutFocus";
  title: string;
  description: string;
  icon: IconComponent;
  keys: string;
}[] = [
  {
    key: "shortcutNewChat",
    title: "New chat",
    description: "Start a fresh chat from anywhere.",
    icon: PlusIcon,
    keys: "mod+k",
  },
  {
    key: "shortcutCancel",
    title: "Cancel and close",
    description: "Stop answers, close menus and dialogs.",
    icon: XMarkIcon,
    keys: "escape",
  },
  {
    key: "shortcutFocus",
    title: "Focus composer",
    description: "Jump to the message box.",
    icon: MagnifyingGlassIcon,
    keys: "/",
  },
];

export function ShortcutsSection() {
  useSessionVersion();
  const profile = getProfile();
  return (
    <VStack gap={5}>
      <SettingsCard title="Shortcuts">
        <CardRows>
          {SHORTCUT_ROWS.map((row) => (
            <SettingsRow
              key={row.key}
              title={row.title}
              description={row.description}
              icon={row.icon}
              control={
                <HStack gap={2} vAlign="center">
                  <Kbd keys={row.keys} />
                  <Switch
                    label={row.title}
                    isLabelHidden
                    value={profile[row.key]}
                    onChange={(checked) =>
                      updateProfile({ [row.key]: checked })
                    }
                  />
                </HStack>
              }
            />
          ))}
        </CardRows>
      </SettingsCard>
      <Text type="supporting" color="secondary">
        Switch a shortcut off and its keys do nothing. Rebinding comes
        with the backend phase.
      </Text>
    </VStack>
  );
}

const LANGUAGES = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "hi", label: "Hindi" },
  { value: "kn", label: "Kannada" },
  { value: "ta", label: "Tamil" },
  { value: "te", label: "Telugu" },
  { value: "ml", label: "Malayalam" },
  { value: "mr", label: "Marathi" },
  { value: "bn", label: "Bengali" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "ja", label: "Japanese" },
  { value: "zh-CN", label: "Chinese (Simplified)" },
  { value: "pt", label: "Portuguese" },
  { value: "ru", label: "Russian" },
  { value: "ar", label: "Arabic" },
  { value: "ko", label: "Korean" },
];

const REGIONS = [
  { value: "IN", label: "India" },
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "JP", label: "Japan" },
  { value: "CN", label: "China" },
  { value: "CA", label: "Canada" },
  { value: "AU", label: "Australia" },
  { value: "AE", label: "UAE" },
  { value: "SG", label: "Singapore" },
  { value: "BR", label: "Brazil" },
  { value: "ES", label: "Spain" },
  { value: "IT", label: "Italy" },
  { value: "NL", label: "Netherlands" },
  { value: "KR", label: "South Korea" },
  { value: "ZA", label: "South Africa" },
  { value: "SA", label: "Saudi Arabia" },
];

const TIMEZONES = [
  { value: "PT", label: "Pacific (GMT-08:00)" },
  { value: "MT", label: "Mountain (GMT-07:00)" },
  { value: "CT", label: "Central (GMT-06:00)" },
  { value: "ET", label: "Eastern (GMT-05:00)" },
  { value: "AT", label: "Atlantic (GMT-04:00)" },
  { value: "ART", label: "Argentina (GMT-03:00)" },
  { value: "HST", label: "Hawaii (GMT-10:00)" },
  { value: "AKT", label: "Alaska (GMT-09:00)" },
  { value: "UTC", label: "UTC (GMT+00:00)" },
  { value: "CET", label: "Central European (GMT+01:00)" },
  { value: "EET", label: "Eastern European (GMT+02:00)" },
  { value: "SAST", label: "South Africa (GMT+02:00)" },
  { value: "MSK", label: "Moscow (GMT+03:00)" },
  { value: "GST", label: "Gulf (GMT+04:00)" },
  { value: "IST", label: "Indian (GMT+05:30)" },
  { value: "NPT", label: "Nepal (GMT+05:45)" },
  { value: "BDT", label: "Dhaka (GMT+06:00)" },
  { value: "ICT", label: "Bangkok (GMT+07:00)" },
  { value: "CST", label: "China / Singapore (GMT+08:00)" },
  { value: "JST", label: "Japan / Korea (GMT+09:00)" },
  { value: "AET", label: "Sydney (GMT+10:00)" },
  { value: "NZT", label: "Auckland (GMT+12:00)" },
];

export function LanguageSection() {
  useSessionVersion();
  const profile = getProfile();
  return (
    <VStack gap={5}>
      <SettingsCard title="Language & region">
        <CardRows>
          <SettingsRow
            title="Language"
            description="Used across menus, buttons, and email."
            icon={LanguageIcon}
            control={
            <Selector
              label="Language"
              isLabelHidden
              size="sm"
              width={CONTROL_WIDTH}
              hasSearch
              searchPlaceholder="Search languages..."
              options={LANGUAGES}
              value={profile.language}
              onChange={(value) => updateProfile({ language: value })}
            />
            }
          />
          <SettingsRow
            title="Region format"
            description="Dates, numbers, and currency."
            icon={GlobeAltIcon}
            control={
            <Selector
              label="Region format"
              isLabelHidden
              size="sm"
              width={CONTROL_WIDTH}
              hasSearch
              searchPlaceholder="Search regions..."
              options={REGIONS}
              value={profile.region}
              onChange={(value) => updateProfile({ region: value })}
            />
            }
          />
          <SettingsRow
            title="Time zone"
            description="Used for scheduling and every timestamp you see."
            icon={ClockIcon}
            control={
            <Selector
              label="Time zone"
              isLabelHidden
              size="sm"
              width={CONTROL_WIDTH}
              hasSearch
              searchPlaceholder="Search time zones..."
              options={TIMEZONES}
              value={profile.timezone}
              onChange={(value) => updateProfile({ timezone: value })}
            />
            }
          />
        </CardRows>
      </SettingsCard>
      <Text type="supporting" color="secondary">
        Stored, not applied: the interface keeps its current language
        until the backend phase binds these.
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

// Downloads a JSON payload as one file. Handler-only window access:
// safe in the SSR island because it runs on click, not render.
function downloadJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function PrivacySection() {
  useSessionVersion();
  const auth = useAuth();
  const profile = getProfile();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const loggedIn = auth.status === "authenticated";
  // Toast viewport: PrivacySection lives inside ProfileDialog which is
  // rendered under the shell's LayerProvider, so useToast() works here.
  const toast = useToast();

  // F2: server export when logged in, local dump when logged out.
  // Per slice-12 toast policy: one success Toast once the download
  // begins; the spinner sits on the button while the server is hit.
  async function handleExport() {
    if (isExporting) return;
    setIsExporting(true);
    setServerError(null);
    try {
      const data = loggedIn
        ? await apiFetch<Record<string, unknown>>("/users/me/export")
        : dumpStore();
      downloadJson("pesdac-data.json", data);
      toast({ body: "Your data export is ready.", type: "info" });
    } catch (error) {
      setServerError(toUserMessage(error, "Export failed. Try again."));
    } finally {
      setIsExporting(false);
    }
  }

  // F3: server delete-all + local wipe when logged in. Per slice-12:
  // do NOT clear the local store until the server request succeeds
  // when authenticated — otherwise a failed server call leaves the
  // server with chats the user can't see, and a successful one that
  // races the clear is still consistent (server is the source of
  // truth). Local-only path (logged out) is unchanged.
  async function handleClearAll() {
    if (isClearingAll) return;
    setIsClearingAll(true);
    setServerError(null);
    if (loggedIn) {
      try {
        await apiFetch<unknown>("/chats", { method: "DELETE" });
      } catch (error) {
        setServerError(
          toUserMessage(error, "Couldn't delete chats. Try again."),
        );
        setIsClearingAll(false);
        return;
      }
    }
    clearAllChats();
    setIsClearingAll(false);
    setConfirmingClear(false);
    if (loggedIn) toast({ body: "All chats deleted.", type: "info" });
  }

  return (
    <VStack gap={5}>
      <SettingsCard title="History">
        <CardRows>
          <SettingsRow
            title="Chat history retention"
            description="Enforced after the backend phase; stored as your preference today."
            icon={ClockIcon}
            control={
              <Selector
                label="Chat history retention"
                isLabelHidden
                size="sm"
                width={CONTROL_WIDTH}
                options={RETENTIONS}
                value={profile.retention}
                onChange={(value) => updateProfile({ retention: value })}
              />
            }
          />
        </CardRows>
      </SettingsCard>
      {serverError != null && (
        <Banner
          status="error"
          title="Couldn't reach the server"
          description={serverError}
        />
      )}
      <SettingsCard title="Your data">
        <CardRows>
          <SettingsRow
            title="Export my data"
            description="Download every saved chat, draft, vote, and preference as one JSON file."
            icon={ArrowDownTrayIcon}
            control={
              <Button
                label="Export my data"
                variant="secondary"
                size="sm"
                isLoading={isExporting}
                isDisabled={isExporting}
                clickAction={() => {
                  void handleExport();
                }}
              >
                Export
              </Button>
            }
          />
          <SettingsRow
            title="Delete all chats"
            description="Removes all chats and their messages. Ratings, drafts, and profile settings are kept."
            icon={TrashIcon}
            control={
              <Button
                label="Delete all chats"
                variant="destructive"
                size="sm"
                onClick={() => setConfirmingClear(true)}
              >
                Delete
              </Button>
            }
          />
        </CardRows>
      </SettingsCard>
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
        isActionLoading={isClearingAll}
        onAction={() => void handleClearAll()}
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
    <VStack gap={5}>
      <VStack gap={1.5}>
        <Text type="supporting" weight="semibold" color="secondary">
          Documents
        </Text>
        {/* The group draws its own divided rows — no Card around it, or the
            chrome doubles and rows spill past the card edge. */}
        <CollapsibleGroup hasDividers>
          {LEGAL_DOCS.map((doc) => (
            <Collapsible
              key={doc.name}
              value={doc.name}
              trigger={
                <HStack gap={3} vAlign="center">
                  <Icon icon={DocumentTextIcon} size="sm" color="secondary" />
                  <Text type="label">{doc.name}</Text>
                  <Badge label="Publishes at launch" />
                </HStack>
              }
            >
              <Text type="supporting" color="secondary">
                {doc.summary} The full document publishes at launch.
              </Text>
            </Collapsible>
          ))}
        </CollapsibleGroup>
      </VStack>
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

export function AuthenticationSection() {
  const auth = useAuth();
  const accounts = useAccounts();
  const [isLinking, setIsLinking] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  // TOTP setup wizard: null (idle) or the freshly minted key material.
  // The secret is parsed out of the otpauth URI for manual entry — no
  // QR dependency. Backup codes show once, at setup time only.
  const [setup, setSetup] = useState<{
    secret: string;
    backupCodes: string[];
  } | null>(null);
  const [isStarting2FA, setIsStarting2FA] = useState(false);
  const [code, setCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isDisabling2FA, setIsDisabling2FA] = useState(false);
  // Change-password form (credential accounts only): current + new.
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordDone, setPasswordDone] = useState(false);
  // Post-mutation override: the session cookie cache can lag the fresh
  // 2FA flag, so the UI trusts its own confirmed writes first.
  const [twoFactorOn, setTwoFactorOn] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const session2FA =
    auth.status === "authenticated" ? auth.user.twoFactorEnabled : false;
  const enabled2FA = twoFactorOn ?? session2FA;
  // Any in-flight BetterAuth mutation; lets the other buttons stay
  // clickable visually but reject re-entry until the round-trip lands
  // (avoids a concurrent write racing the active one).
  const anyPending =
    isLinking ||
    isUnlinking ||
    isStarting2FA ||
    isVerifying ||
    isDisabling2FA ||
    isChangingPassword;

  const linked =
    accounts.status === "ready" ? accounts.accounts : null;
  const googleAccount =
    linked?.find((a) => a.providerId === "google") ?? null;
  // The server refuses to unlink the last remaining method, so Unlink is
  // only offered when another way back in exists.
  const canUnlink =
    googleAccount != null && linked != null && linked.length > 1;
  // Credential (email + password) sign-in exists only for users who
  // signed up with a password. Google-only users have none — and there
  // is no client path to set a first one (the server's setPassword is
  // serverOnly in BetterAuth 1.7.3, and reset emails need a sender we
  // don't have) — so the Password row renders only when a credential
  // account is linked. Gated on ready so it never flickers in.
  const hasCredential =
    accounts.status === "ready" &&
    (linked?.some((a) => a.providerId === "credential") ?? false);

  async function handleLinkGoogle() {
    setIsLinking(true);
    setAuthError(null);
    try {
      await linkGoogle();
    } catch (e) {
      setAuthError(toUserMessage(e, "Couldn't link Google. Try again."));
    } finally {
      setIsLinking(false);
    }
  }

  async function handleUnlinkGoogle() {
    if (googleAccount == null) return;
    setIsUnlinking(true);
    setAuthError(null);
    try {
      await unlinkAccount(googleAccount.id);
    } catch (e) {
      setAuthError(toUserMessage(e, "Couldn't unlink Google. Try again."));
    } finally {
      setIsUnlinking(false);
    }
  }

  async function handleStart2FA() {
    setIsStarting2FA(true);
    setAuthError(null);
    try {
      const { totpURI, backupCodes } = await enableTwoFactor();
      const secret = parseTotpSecret(totpURI);
      setCode("");
      setSetup({ secret, backupCodes });
    } catch (e) {
      setAuthError(toUserMessage(e, "Couldn't start 2FA setup. Try again."));
    } finally {
      setIsStarting2FA(false);
    }
  }

  async function handleVerify2FA() {
    if (code.trim().length < 6) {
      setAuthError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setIsVerifying(true);
    setAuthError(null);
    try {
      await verifyTwoFactorSetup(code);
      setSetup(null);
      setTwoFactorOn(true);
    } catch (e) {
      setAuthError(toUserMessage(e, "That code didn't work. Try again."));
    } finally {
      setIsVerifying(false);
    }
  }

  async function handleDisable2FA() {
    setIsDisabling2FA(true);
    setAuthError(null);
    try {
      await disableTwoFactor();
      setTwoFactorOn(false);
    } catch (e) {
      setAuthError(toUserMessage(e, "Couldn't turn off 2FA. Try again."));
    } finally {
      setIsDisabling2FA(false);
    }
  }

  async function handleChangePassword() {
    if (isChangingPassword) return;
    if (!currentPassword) {
      setAuthError("Enter your current password.");
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setAuthError(
        `The new password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
      return;
    }
    setIsChangingPassword(true);
    setAuthError(null);
    setPasswordDone(false);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setShowPasswordForm(false);
      setPasswordDone(true);
    } catch (e) {
      setAuthError(toUserMessage(e, "Couldn't change your password. Try again."));
    } finally {
      setIsChangingPassword(false);
    }
  }

  return (
    <VStack gap={5}>
      <SettingsCard title="Authentication">
        <CardRows>
          <SettingsRow
            title="Google account"
            description={
              googleAccount != null
                ? "Signed in with Google."
                : accounts.status === "error"
                  ? "Couldn't load link status."
                  : "Sign in and link with your Google account."
            }
            icon={GlobeAltIcon}
            control={
              googleAccount != null ? (
                canUnlink ? (
                  <Button
                    label="Unlink"
                    variant="secondary"
                    size="sm"
                    isLoading={isUnlinking}
                    isDisabled={anyPending}
                    onClick={() => void handleUnlinkGoogle()}
                  />
                ) : (
                  <Text type="body" weight="semibold">
                    Linked
                  </Text>
                )
              ) : (
                <Button
                  label="Link Google"
                  variant="secondary"
                  size="sm"
                  isLoading={isLinking}
                  isDisabled={anyPending}
                  onClick={() => void handleLinkGoogle()}
                />
              )
            }
          />
          <SettingsRow
            title="Two-factor authentication"
            description={
              enabled2FA
                ? "On — signing in asks for an authenticator code."
                : "Add an extra layer of security with TOTP."
            }
            icon={ShieldCheckIcon}
            control={
              enabled2FA ? (
                <Button
                  label="Disable 2FA"
                  variant="secondary"
                  size="sm"
                  isLoading={isDisabling2FA}
                  isDisabled={anyPending}
                  onClick={() => void handleDisable2FA()}
                />
              ) : (
                <Button
                  label="Enable 2FA"
                  variant="secondary"
                  size="sm"
                  isLoading={isStarting2FA}
                  isDisabled={anyPending}
                  onClick={() => void handleStart2FA()}
                />
              )
            }
          />
          {hasCredential && (
            <SettingsRow
              title="Password"
              description="Change the password you sign in with."
              icon={KeyIcon}
              control={
                <Button
                  label="Change"
                  variant="secondary"
                  size="sm"
                  isDisabled={anyPending}
                  onClick={() => {
                    setShowPasswordForm((v) => !v);
                    setAuthError(null);
                    setPasswordDone(false);
                  }}
                />
              }
            />
          )}
        </CardRows>
      </SettingsCard>
      {hasCredential && showPasswordForm && (
        <SettingsCard title="Change your password">
          <VStack padding={4} gap={3}>
            <TextInput
              label="Current password"
              type="password"
              placeholder="Your current password"
              value={currentPassword}
              onChange={setCurrentPassword}
            />
            <TextInput
              label="New password"
              type="password"
              placeholder="Choose a new password"
              description={`At least ${MIN_PASSWORD_LENGTH} characters`}
              value={newPassword}
              onChange={setNewPassword}
            />
            <HStack gap={2}>
              <Button
                label="Save new password"
                variant="primary"
                size="sm"
                isLoading={isChangingPassword}
                onClick={() => void handleChangePassword()}
              />
              <Button
                label="Cancel"
                variant="secondary"
                size="sm"
                onClick={() => setShowPasswordForm(false)}
              />
            </HStack>
          </VStack>
        </SettingsCard>
      )}
      {setup != null && !enabled2FA && (
        <SettingsCard title="Set up your authenticator">
          <VStack padding={4} gap={3}>
            <Text type="body">
              Enter this key in your authenticator app, then type the
              6-digit code it shows.
            </Text>
            <VStack gap={1}>
              <Text type="label">Setup key</Text>
              <Text type="body" weight="semibold" maxLines={3}>
                {setup.secret || "Couldn't read the key — start over."}
              </Text>
            </VStack>
            <VStack gap={1}>
              <Text type="label">Backup codes (save these now)</Text>
              <Text type="supporting" color="secondary">
                {setup.backupCodes.length > 0
                  ? setup.backupCodes.join("  ")
                  : "None issued."}
              </Text>
            </VStack>
            <TextInput
              label="Authenticator code"
              placeholder="6-digit code"
              value={code}
              onChange={setCode}
            />
            <HStack gap={2}>
              <Button
                label="Verify and enable"
                variant="primary"
                size="sm"
                isLoading={isVerifying}
                onClick={() => void handleVerify2FA()}
              />
              <Button
                label="Cancel"
                variant="secondary"
                size="sm"
                onClick={() => setSetup(null)}
              />
            </HStack>
          </VStack>
        </SettingsCard>
      )}
      {passwordDone && (
        <Text type="body">Password changed.</Text>
      )}
      {authError != null && (
        <Banner status="error" title="Authentication error" description={authError} />
      )}
      <Text type="supporting" color="secondary">
        Auth settings are powered by BetterAuth. Email + password sign-in works alongside Google.
      </Text>
    </VStack>
  );
}

/** Pull the manual-entry secret out of an otpauth:// URI. "" when absent. */
function parseTotpSecret(totpURI: string): string {
  try {
    return new URL(totpURI).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}
