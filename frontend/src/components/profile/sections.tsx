"use client";

import { useState, type ReactNode, type ComponentType, type SVGProps } from "react";

import { VStack, HStack } from "@astryxdesign/core/Layout";
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
} from "@heroicons/react/24/outline";
import {
  clearAllChats,
  dumpStore,
  getProfile,
  updateProfile,
  useSessionVersion,
} from "../../lib/session";
import { useAuth, apiDeleteAccount, apiFetch, toUserMessage } from "../../lib/auth";
import { linkGoogleAccount, sdkMessage } from "../../lib/neon-auth";
import { navigate } from "astro:transitions/client";
import {
  BRANCHES,
  CAMPUSES,
  SEMESTERS,
} from "../../lib/profile-options";

export type ProfileTab =
  | "profile"
  | "study"
  | "assistant"
  | "shortcuts"
  | "language"
  | "privacy"
  | "legal";

export const TABS: { value: ProfileTab; label: string }[] = [
  { value: "profile", label: "Profile" },
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
  const profile = getProfile();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);
  const [isLinking, setIsLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  // Plan item 23: email + displayName are Neon-owned — read-only when
  // authenticated. Logged out (unreachable behind the gate, kept for
  // honesty) the local store remains editable.
  const neonUser = auth.status === "authenticated" ? auth.user : null;
  const displayName = neonUser?.displayName || profile.displayName;
  const email = neonUser?.email || profile.email;

  // F4: our rows first (users + profile + chats), then the Neon user
  // record. Full success → /signup for a fresh start. SDK fallback
  // (signed out, Neon record remains) → banner and stay: navigating
  // would hide the support message, and closing the dialog lands on
  // the gate, which routes to signup/login anyway.
  async function handleDeleteAccount() {
    setConfirmingDelete(false);
    setDeleteNotice(null);
    try {
      const { fallback } = await apiDeleteAccount();
      if (fallback) {
        setDeleteNotice(
          "Signed out. Contact support to finish deletion.",
        );
        return;
      }
    } catch (error) {
      setDeleteNotice(toUserMessage(error, "Couldn't delete your account. Try again."));
      return;
    }
    navigate("/signup");
  }

  // Link Google to the signed-in account (fixes account_not_linked for
  // password-first users): requires a live session, redirects to Google
  // and back on success. Already-linked returns with no URL — either
  // way a return without redirect means reset the button.
  async function handleLinkGoogle() {
    if (isLinking) return;
    setIsLinking(true);
    setLinkError(null);
    try {
      await linkGoogleAccount();
    } catch (error) {
      setLinkError(sdkMessage(error, "Couldn't link Google. Try again."));
    }
    setIsLinking(false);
    // A real redirect unloads the page, so reaching here means stay.
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
      {linkError != null && (
        <Banner
          status="error"
          title="Google linking"
          description={linkError}
        />
      )}
      <SettingsCard title="Identity">
        <CardRows>
          <SettingsRow
            title="Display name"
            description={
              neonUser != null
                ? "Managed by your sign-in provider."
                : "Shown across PESDac."
            }
            icon={UserIcon}
            control={
              neonUser != null ? (
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
              neonUser != null
                ? "Managed by your sign-in provider."
                : "Where account notices are sent."
            }
            icon={EnvelopeIcon}
            control={
              neonUser != null ? (
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
          {neonUser != null && (
            <SettingsRow
              title="Google account"
              description="Link Google to sign in with one click next time."
              icon={GlobeAltIcon}
              control={
                <Button
                  label={isLinking ? "Linking…" : "Link Google account"}
                  variant="secondary"
                  isLoading={isLinking}
                  onClick={() => void handleLinkGoogle()}
                />
              }
            />
          )}
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
                onChange={(value) => updateProfile({ institution: value ?? "" })}
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
                onChange={(value) => updateProfile({ semester: value ?? "" })}
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
                onChange={(value) => updateProfile({ branch: value ?? "" })}
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
        Sign in and account management are handled by our auth provider.
      </Text>
      <AlertDialog
        isOpen={confirmingDelete}
        onOpenChange={(open) => {
          if (!open) setConfirmingDelete(false);
        }}
        title="Delete your account?"
        description="Everything you did on PESDac is permanently erased. This cannot be undone."
        actionLabel="Delete"
        onAction={() => void handleDeleteAccount()}
      />
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
  const loggedIn = auth.status === "authenticated";

  // F2: server export when logged in, local dump when logged out.
  async function handleExport() {
    setServerError(null);
    try {
      const data = loggedIn
        ? await apiFetch<Record<string, unknown>>("/users/me/export")
        : dumpStore();
      downloadJson("pesdac-data.json", data);
    } catch (error) {
      setServerError(toUserMessage(error, "Export failed. Try again."));
    }
  }

  // F3: server delete-all + local wipe when logged in (overlays still
  // live in memory until the messages slice — clearAllChats covers the
  // in-memory customs keys too, so no ghosts remain); local-only path
  // unchanged when logged out. Keeps the existing confirm dialog.
  async function handleClearAll() {
    setConfirmingClear(false);
    setServerError(null);
    if (loggedIn) {
      try {
        await apiFetch<unknown>("/chats", { method: "DELETE" });
      } catch (error) {
        setServerError(
          toUserMessage(error, "Couldn't delete chats. Try again."),
        );
        return;
      }
    }
    clearAllChats();
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
                onClick={() => void handleExport()}
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
