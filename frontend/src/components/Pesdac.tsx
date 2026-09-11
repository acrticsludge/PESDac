"use client";

import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { navigate } from "astro:transitions/client";

import { Theme } from "@astryxdesign/core/theme";
import { PESDacMockupTheme } from "../theme/PESDacMockupTheme";
import {
  buildChatPath,
  getChatByCode,
  getChatCode,
  getChatSubject,
  isChatCodeFormat,
  isSubject,
} from "../lib/chat";
import {
  REFERENCE_ITEMS,
  stripReferenceTokens,
} from "../lib/references";
import {
  stageFiles,
  revokeStaged,
  attachmentLabel,
  type StagedFile,
} from "../lib/attachments";
import type { Attachment } from "../content/threads/types";
import ThreadView from "./chat/ThreadView";
import { ChatListSkeleton } from "./chat/ChatListSkeleton";
import { ComposerSkeleton } from "./chat/ComposerSkeleton";
import type { ProfileTab } from "./profile/profile-tabs";
import AuthGate from "./auth/AuthGate";
import OnboardingDialog from "./auth/OnboardingDialog";
import AppToasts, { type ShowToastFn } from "./AppToasts";
import { apiLogout, apiGetProfile, useAuth, useProfile, AUTH_REQUIRED_EVENT, toUserMessage, getAuthEpoch, useAuthEpoch, clearAuthCache, type LogoutOutcome } from "../lib/auth";
import {
  beginLogoutTransition,
  endLogoutTransition,
  isLogoutTransition,
} from "../lib/logout-guard";
import { tabFromHash } from "./profile/profile-tabs";
import { useCacheRevalidation } from "../lib/cache-revalidation";
import { isCampus } from "../lib/profile-options";
import AttachButton from "./chat/AttachButton";

const ProfileDialog = lazy(() => import("./profile/ProfileDialog"));
import { getThread } from "../content/threads";
import {
  useSessionVersion,
  useStorageHealth,
  useCorruptKeys,
  listCustomChats,
  createCustomChat,
  deleteCustomChat,
  renameDemoChat,
  demoDisplayLabel,
  makeDraftThread,
  togglePin,
  listPinned,
  archiveChat,
  unarchiveChat,
  listArchived,
  type ChatRef,
  type ChatAuth,
  readDraft,
  writeDraft,
  getProfile,
  updateProfile as updateLocalProfile,
  clearLocalProfileSeed,
  getSeededIdentityKey,
  setSeededIdentityKey,
  setProfileSeedPending,
  getProfileSeedPending,
  getChatHydratedKey,
  getChatHydratePending,
  getChatHydrateFailed,
  getHydrateSyncError,
  getCreateSyncError,
  shouldShowWorkspaceSkeleton,
  userReady,
  chatReady,
  identitySeedKey,
  hydrateChats,
  createChatBacked,
  renameChatBacked,
  deleteChatBacked,
  setPinBacked,
  setArchivedBacked,
  isServerChat,
  CANCEL_EVENT,
  FOCUS_COMPOSER_EVENT,
  LAST_KNOWN_SUBJECT_COUNTS_KEY,
  LAST_KNOWN_PINNED_COUNT_KEY,
  LAST_KNOWN_ARCHIVED_COUNT_KEY,
  LAST_KNOWN_SNAPSHOT_AT_KEY,
} from "../lib/session";

import { AppShell } from "@astryxdesign/core/AppShell";

import { Divider } from "@astryxdesign/core/Divider";

import { Button } from "@astryxdesign/core/Button";

import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";

import { AlertDialog } from "@astryxdesign/core/AlertDialog";

import { LayerProvider } from "@astryxdesign/core/Layer";

import { TextInput } from "@astryxdesign/core/TextInput";

import {
  Layout,
  LayoutContent,
  LayoutFooter,
  VStack,
  HStack,
} from "@astryxdesign/core/Layout";

import { Text, Heading } from "@astryxdesign/core/Text";

import {
  SideNav,
  SideNavHeading,
  SideNavItem,
  SideNavSection,
} from "@astryxdesign/core/SideNav";

import { NavIcon } from "@astryxdesign/core/NavIcon";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Icon } from "@astryxdesign/core/Icon";
import type { IconType } from "@astryxdesign/core/Icon";

import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Skeleton } from "@astryxdesign/core/Skeleton";

import {
  ChatComposer,
  ChatComposerDrawer,
  ChatComposerInput,
  ChatDictationButton,
  useChatDictation,
  type ChatComposerInputHandle,
  type ChatComposerTrigger,
} from "@astryxdesign/core/Chat";

import {
  createStaticSource,
  TypeaheadItem,
} from "@astryxdesign/core/Typeahead";

import {
  ToggleButton,
  ToggleButtonGroup,
} from "@astryxdesign/core/ToggleButton";

import { Token } from "@astryxdesign/core/Token";

import { Thumbnail } from "@astryxdesign/core/Thumbnail";

import { ClickableCard } from "@astryxdesign/core/ClickableCard";

import { Grid } from "@astryxdesign/core/Grid";
import { Stack } from "@astryxdesign/core/Stack";

import {
  DropdownMenu,
  DropdownMenuItem,
} from "@astryxdesign/core/DropdownMenu";

import {
  SparklesIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  BookOpenIcon,
  BookmarkIcon,
  Cog6ToothIcon,
  UserCircleIcon,
  ComputerDesktopIcon,
  GlobeAltIcon,
  CpuChipIcon,
  CircleStackIcon,
  CalculatorIcon,
  AtSymbolIcon,
  ArrowRightStartOnRectangleIcon,
  ArrowLeftStartOnRectangleIcon,
} from "@heroicons/react/24/outline";

/* -------------------------------------------------------------------------- */
/*                                PESDac Data                                 */
/* -------------------------------------------------------------------------- */

type Conversation = {
  label: string;
};

type Workspace = {
  name: string;
  icon: IconType;
  chats: Conversation[];
};

/* -------------------------------------------------------------------------- */
/*                                  Subjects                                  */
/* -------------------------------------------------------------------------- */

const WORKSPACES: Workspace[] = [
  {
    name: "CN",
    icon: GlobeAltIcon,
    chats: [],
  },

  {
    name: "OS",
    icon: ComputerDesktopIcon,
    chats: [],
  },

  {
    name: "DLCD",
    icon: CpuChipIcon,
    chats: [],
  },

  {
    name: "DSA",
    icon: CircleStackIcon,
    chats: [],
  },

  {
    name: "Math",
    icon: CalculatorIcon,
    chats: [],
  },
];

// Sidebar labels only — statuses removed 2026-09-07 (never rendered).
/* -------------------------------------------------------------------------- */
/*                         Chat welcome configuration                          */
/* -------------------------------------------------------------------------- */

const pageStyle: CSSProperties = {
  minHeight: "100%",
};

const composerInput: CSSProperties = {
  minHeight: 84,
};

const categories: CSSProperties = {
  paddingInline: "var(--spacing-3)",
};

/* -------------------------------------------------------------------------- */
/*                           PESDac Quick Prompts                              */
/* -------------------------------------------------------------------------- */

const CATEGORY_SUGGESTIONS: Record<
  string,
  Array<{
    heading: string;
    body: string;
    prompt: string;
  }>
> = {
  CN: [
    {
      heading: "Explain a networking concept",
      body: "Break down a difficult CN concept step by step",
      prompt: "Explain the OSI model in simple terms",
    },
    {
      heading: "Compare protocols",
      body: "Understand the differences between networking protocols",
      prompt: "Explain the difference between TCP and UDP",
    },
    {
      heading: "Solve a subnetting problem",
      body: "Work through IP addressing and subnetting",
      prompt: "Help me solve a subnetting problem",
    },
    {
      heading: "Quiz me on CN",
      body: "Test your understanding of Computer Networks",
      prompt: "Quiz me on Computer Networks",
    },
  ],

  OS: [
    {
      heading: "Explain a concept",
      body: "Understand an Operating Systems concept simply",
      prompt: "Explain process scheduling in Operating Systems",
    },
    {
      heading: "Compare algorithms",
      body: "Compare OS algorithms and their trade-offs",
      prompt: "Compare FCFS, SJF and Round Robin scheduling",
    },
    {
      heading: "Solve a problem",
      body: "Work through an OS problem step by step",
      prompt: "Help me solve a CPU scheduling problem",
    },
    {
      heading: "Quiz me on OS",
      body: "Test your Operating Systems knowledge",
      prompt: "Quiz me on Operating Systems",
    },
  ],

  DLCD: [
    {
      heading: "Explain Boolean algebra",
      body: "Learn Boolean operations and simplification",
      prompt: "Explain Boolean algebra from the basics",
    },
    {
      heading: "Solve a K-map",
      body: "Work through Karnaugh map simplification",
      prompt: "Show me how to solve a K-map",
    },
    {
      heading: "Explain flip-flops",
      body: "Understand sequential logic components",
      prompt: "Explain SR, JK, D and T flip-flops",
    },
    {
      heading: "Quiz me on DLCD",
      body: "Test your Digital Logic knowledge",
      prompt: "Quiz me on DLCD",
    },
  ],

  DSA: [
    {
      heading: "Explain a data structure",
      body: "Break down a DSA concept with examples",
      prompt: "Explain binary trees in simple terms",
    },
    {
      heading: "Understand an algorithm",
      body: "Learn how an algorithm works step by step",
      prompt: "Explain graph traversal algorithms",
    },
    {
      heading: "Solve a DSA problem",
      body: "Work through a problem with guidance",
      prompt: "Give me a DSA problem and help me solve it",
    },
    {
      heading: "Quiz me on DSA",
      body: "Test your algorithms and data structures knowledge",
      prompt: "Quiz me on DSA",
    },
  ],

  Math: [
    {
      heading: "Explain a concept",
      body: "Break down a difficult mathematical concept",
      prompt: "Explain matrices from the basics",
    },
    {
      heading: "Solve a problem",
      body: "Work through a mathematical problem step by step",
      prompt: "Help me solve this mathematics problem",
    },
    {
      heading: "Study probability",
      body: "Understand probability concepts and examples",
      prompt: "Teach me probability with examples",
    },
    {
      heading: "Quiz me on Math",
      body: "Test your understanding with practice questions",
      prompt: "Quiz me on Mathematics",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/*                              Composer modes                                */
/* -------------------------------------------------------------------------- */

const MODE_OPTIONS = [
  {
    key: "auto",
    label: "Auto",
    icon: SparklesIcon,
  },

  {
    key: "CN",
    label: "CN",
    icon: GlobeAltIcon,
  },

  {
    key: "OS",
    label: "OS",
    icon: ComputerDesktopIcon,
  },

  {
    key: "DLCD",
    label: "DLCD",
    icon: CpuChipIcon,
  },

  {
    key: "DSA",
    label: "DSA",
    icon: CircleStackIcon,
  },

  {
    key: "Math",
    label: "Math",
    icon: CalculatorIcon,
  },
] as const;

/* -------------------------------------------------------------------------- */
/*                          Reference / @ trigger                              */
/* -------------------------------------------------------------------------- */

const referenceTrigger: ChatComposerTrigger = {
  character: "@",

  searchSource: createStaticSource(REFERENCE_ITEMS),

  renderItem: (item) => (
    <TypeaheadItem
      item={item}
      description={(item.auxiliaryData as { type: string })?.type}
    />
  ),

  onSelect: (item) => ({
    value: `@${item.id}`,
    label: item.label,
    variant: "blue",
  }),
};

/* -------------------------------------------------------------------------- */
/*                     Added CN conversation experience                       */
/* -------------------------------------------------------------------------- */

/*                         Conversation Item                                  */
/* -------------------------------------------------------------------------- */

export type ChatMenuItem = { label: string; onClick: () => void };

function ConversationItem({
  label,
  isSelected,
  onClick,
  menu,
  icon,
  isPending,
  isDisabled,
}: {
  label: string;
  isSelected?: boolean;
  onClick?: () => void;
  menu: ChatMenuItem[];
  icon?: ReactNode | IconType;
  isPending?: boolean;
  isDisabled?: boolean;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const showMenu = (isHovered || isMenuOpen) && !isDisabled;

  return (
    <Stack
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <SideNavItem
        label={label}
        href="#"
        isSelected={isSelected}
        isDisabled={isDisabled}
        icon={isPending ? <Spinner size="sm" /> : icon}
        onClick={(event) => {
          if (isPending || isDisabled) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          onClick?.();
        }}
        actions={
          showMenu ? (
            <MoreMenu
              size="sm"
              label="Conversation options"
              onOpenChange={setIsMenuOpen}
              items={menu}
            />
          ) : null
        }
      />
    </Stack>
  );
}

/*                              Main component                                */
/* -------------------------------------------------------------------------- */

export default function ShellSideNav({
  initialSubject,
  initialCode,
  initialView,
}: {
  initialSubject?: string;
  initialCode?: string;
  initialView?: "chat" | "profile";
} = {}) {
  // URL is source of truth for shared links: /subject/[subject]/[code].
  // Fall back to welcome state for unknown codes (mockup phase).
  const initialChat =
    initialCode != null ? getChatByCode(initialCode) : null;
  const initialSubjectValue =
    initialChat?.subject ??
    (isSubject(initialSubject) ? initialSubject : null);

  // My Profile is a settings-dialog (modal over the chat — settings
  // without leaving the conversation). No route view, no shell churn:
  // the dialog opens over whatever is underneath.
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<ProfileTab>("profile");
  const openProfile = (tab: ProfileTab) => {
    setProfileTab(tab);
    setIsProfileOpen(true);
  };
  // Toast bridge (error surfaces F1/F2): handlers in this file live
  // outside the provider subtree, so AppToasts publishes the toast fn
  // here after mount. Null until then — every use is optional-chained.
  const toastRef = useRef<ShowToastFn | null>(null);
  // Session gate (slice 2.4, spec §A): guests on app routes get the
  // required-purpose AuthGate dialog. Loading sessions render the shell
  // as-is — no flash of gate while the session is still resolving.
  const authState = useAuth();
  const serverProfile = useProfile();
  const isGateOpen = authState.status === "guest";
  // Server→local hydration (auth audit G2, logout/relogin fix): the
  // session store is memory-only and wiped on reload, so seed the
  // onboarding fields from the server row for every authenticated
  // identity. Keyed by user id + auth epoch — NOT by island lifetime:
  // after logout → login in the same persisted shell the epoch has
  // bumped, so user B always reseeds instead of inheriting user A's
  // one-shot flag (which was also a cross-identity leak). The write is
  // guarded against stale resolves (user-A promise landing after user-B
  // took over). Offline keeps local defaults; the key resets so the
  // next mount retries.
  const hydratedKeyRef = useRef<string | null>(null);
  const authEpoch = useAuthEpoch();
  const authUserId = authState.status === "authenticated" ? authState.user.id : null;
  useEffect(() => {
    if (authState.status !== "authenticated" || authUserId == null) return;
    const key = identitySeedKey(authUserId, authEpoch);
    if (hydratedKeyRef.current === key && getSeededIdentityKey() === key)
      return;
    hydratedKeyRef.current = key;
    setProfileSeedPending(true);
    let cancelled = false;
    const userId = authUserId;
    const epochAtStart = authEpoch;
    void apiGetProfile(userId)
      .then((server) => {
        if (cancelled) return;
        if (getAuthEpoch() !== epochAtStart) return;
        updateLocalProfile({
          institution: isCampus(server.campus) ? server.campus : "",
          semester: typeof server.semester === "string" ? server.semester : "",
          branch: typeof server.branch === "string" ? server.branch : "",
          subjects: Array.isArray(server.subjects) ? server.subjects : [],
        });
        setSeededIdentityKey(key);
        setProfileSeedPending(false);
      })
      .catch(() => {
        // Offline/backend down: keep local defaults. Reset the key so
        // the next mount (or remount) retries.
        if (cancelled) return;
        hydratedKeyRef.current = null;
        setProfileSeedPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authState.status, authUserId, authEpoch]);
  // Chat backing identity (spec §5): authenticated identities hydrate
  // server-side chats; guests and unknown-tag windows (loading status)
  // never produce one — they stay memory-only with zero fetches.
  const chatAuth: ChatAuth =
    authState.status === "authenticated" && authUserId != null
      ? { userId: authUserId, identityKey: identitySeedKey(authUserId, authEpoch) }
      : null;
  const notifyChat = (body: string) =>
    toastRef.current?.({ body, type: "error" });
  // Server chat hydrate (spec §5): adopt-then-hydrate-replace per identity,
  // epoch-gated on the same identitySeedKey as the profile seed (no
  // parallel identity scheme). Failed hydrates keep the memory paint with
  // one toast and retry on the next identity transition.
  const chatHydratedRef = useRef<string | null>(null);
  useEffect(() => {
    if (chatAuth == null) return;
    if (chatHydratedRef.current === chatAuth.identityKey) return;
    chatHydratedRef.current = chatAuth.identityKey;
    // kept-memory releases the gate (no auto-retry — the effect never
    // re-fires on its own): the next mount/identity transition or a
    // user-initiated Retry can hydrate again.
    void hydrateChats(chatAuth, { notify: notifyChat }).then((result) => {
      if (result.status === "kept-memory") chatHydratedRef.current = null;
    });
  }, [authState.status, authUserId, authEpoch]);
  const authExpiredRef = useRef(false);
  // Backend rejected our session (expired/invalid): clear it and
  // route to re-login. Guarded against reentrancy — apiLogout's
  // own backend call 401s too and would re-fire this event.
  // Per slice-12: the Logout row needs a visible pending state so
  // the user sees feedback during the round-trip. Re-entry guard
  // matches the row's isDisabled.
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  useEffect(() => {
    const onAuthRequired = () => {
      if (authExpiredRef.current) return;
      // A backend 401 raised by logout's own revocation call races this
      // handler while the logout window is open — navigation is already
      // guaranteed there, so stay silent instead of double-toasting.
      if (isLogoutTransition()) return;
      authExpiredRef.current = true;
      beginLogoutTransition();
      toastRef.current?.({
        body: "Your session expired. Please log in again.",
        type: "error",
      });
      void apiLogout().finally(async () => {
        // Reset so a later real expiry in the same island lifetime still
        // fires (one-shot refs must not survive their flow).
        authExpiredRef.current = false;
        clearLocalProfileSeed();
        // Await the navigation BEFORE closing the logout window (same
        // guarantee as handleLogout): endLogoutTransition() on an
        // uncommitted transition would reopen the gate for a frame.
        try {
          await navigate("/login");
        } catch {
          window.location.assign("/login");
        }
        setIsLoggingOut(false);
        endLogoutTransition();
      });
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);
  // Onboarding wizard (slice 3.1): required while the server says the
  // profile isn't set up. Same Esc yield as the gate.
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  // F1: first name = displayName up to the first space; empty when
  // logged out → generic heading. Server row wins; the session name
  // covers the fetch window so the heading never flickers generic.
  const displayName =
    serverProfile.status === "ready"
      ? serverProfile.user.displayName
      : authState.status === "authenticated"
        ? authState.user.name
        : "";
  const firstName = displayName.split(/\s/, 1)[0];
  // Sidebar account row: same source as the greeting.
  const accountEmail =
    serverProfile.status === "ready"
      ? serverProfile.user.email
      : authState.status === "authenticated"
        ? authState.user.email
        : "";
  // Account row Logout: sign out, then leave the app routes — the gate
// // re-opens next visit. Local state ALWAYS clears (gate reopens on next
// // visit regardless). Backend/BetterAuth revocation failures are reported
// // back, but never block navigation — the user's session is dead as
// // far as the UI cares, even if a stale cookie lingered.
// //
// // Logout-intent window (logout/relogin fix): opened at click, closed
// // after navigate("/login") commits. While open the gate stays shut and
// // epoch-killed fetch rejections stay silent (see AuthGate +
// // OnboardingDialog); only this function's own server-failed/catch
// // toasts fire. Navigation is guaranteed on EVERY path — including
// // logout's own failure — via the bounded race below (apiFetch aborts
// // at 15s but BetterAuth signOut has no timeout of its own).
const LOGOUT_TIMEOUT_MS = 15000;
  const handleLogout = async () => {
    if (isLoggingOut) return;
    beginLogoutTransition();
    setIsLoggingOut(true);
    try {
      const outcome: LogoutOutcome = await Promise.race([
        apiLogout(),
        new Promise<LogoutOutcome>((resolve) =>
          window.setTimeout(
            () =>
              resolve({
                kind: "server-failed",
                message: "Couldn't tell the server you logged out.",
              }),
            LOGOUT_TIMEOUT_MS,
          ),
        ),
      ]);
      if (outcome.kind === "server-failed") {
        // Honest warning (F1 / T14): local session is gone but the
        // server didn't confirm revocation. User-visible, not a silent
        // success.
        toastRef.current?.({
          body: `${outcome.message} You can keep using the app; sign back in to clear this warning.`,
          type: "info",
        });
      }
    } catch (error) {
      // Local logout still happened; only surface the message — then
      // still navigate below (a failed revocation must not strand the
      // user on a guest app route behind the gate).
      toastRef.current?.({
        body: toUserMessage(error, "Couldn't log you out. Try again."),
        type: "error",
      });
    }
    try {
      await navigate("/login");
    } catch {
      window.location.assign("/login");
    }
    // Reset so a persisted island never sticks on "Logging out…" and a
    // later real expiry still fires.
    setIsLoggingOut(false);
    authExpiredRef.current = false;
    endLogoutTransition();
  };
  // Added interaction state; the existing welcome/composer state remains intact.
  const [selectedChat, setSelectedChat] = useState<string | null>(
    initialChat?.label ?? null,
  );
  // Custom conversations deep-link via /subject/[subject]/[code] (same
  // scheme as demos; custom codes never collide with demo codes — genCode
  // avoids TAKEN demo codes). On a direct load the store is empty until
  // hydrate, so seed draftCode from the URL and let the thread appear when
  // customs land.
  const initialCustomCode =
    initialCode != null &&
    getChatByCode(initialCode) == null &&
    isChatCodeFormat(initialCode)
      ? initialCode
      : null;
  const [draftCode, setDraftCode] = useState<string | null>(initialCustomCode);
  // Foreground-gated revalidation (caching Fix 4): pageshow re-proof,
  // coalesced foreground refetch (hydrate + open custom thread), and the
  // sibling-tab logout ping. Listeners only — every leg reuses the
  // session/auth paths above; no UI, fetch, or Phase-1–3 semantics touched.
  // Sibling logout runs the full choke point (spec §7: logout row minus
  // navigation) — never a bare row reset, never navigation.
  useCacheRevalidation({
    chatAuth,
    openCode: draftCode,
    notify: notifyChat,
    onSiblingLogout: () => clearAuthCache(),
  });
  // Draft auto-send: first message typed on welcome, sent on thread mount.
  const [draftAutoSend, setDraftAutoSend] = useState<{
    text: string;
    attachments: Attachment[];
  } | null>(null);
  // Rename dialog (custom chats + demo display-label overrides).
  const [renameTarget, setRenameTarget] = useState<
    { kind: "custom"; code: string } | { kind: "demo"; label: string } | null
  >(null);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  // Delete confirmation: customs delete permanently; demos archive
  // (Archive is instant, Delete asks first — same shelf).
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: "custom" | "demo"; id: string; title: string } | null
  >(null);
  // Hover tooltips anchored behind an open modal (sidebar Avatar name,
  // truncated account Texts) have no mouseleave while the dialog covers
  // them, so an already-showing tooltip sticks above the backdrop with no
  // way to dismiss. While any modal is open the sidebar tooltips stay
  // off — flipping the prop unmounts a stuck layer and blocks new hovers.
  // Tooltips behave exactly as before when no modal is open.
  const isAnyModalOpen =
    isProfileOpen ||
    isOnboardingOpen ||
    renameTarget != null ||
    deleteTarget != null;
  // Per-chat pending flag drives the inline Spinner on the side-nav row
  // while a side-nav action (pin/archive/delete) is in flight. Today
  // these are synchronous local-store writes, so the flag only flashes
  // briefly — keep it so the UX is consistent when persistence moves
  // server-side. Keyed by `${kind}:${id}` to match refKeys().
  const [pending, setPending] = useState<Record<string, true>>({});
  const setRowPending = (key: string, value: boolean) =>
    setPending((prev) => {
      if (value) return { ...prev, [key]: true };
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  const refKeyOf = (ref: ChatRef) => `${ref.kind}:${ref.id}`;
  const isRowPending = (ref: ChatRef) => Boolean(pending[refKeyOf(ref)]);
  // Sidebar conversation search (filters demo + custom labels).
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  useSessionVersion();
  // Session reads run directly during render — NOT gated on mount. Gating
  // makes pinned/renamed chats visibly jump sections on first paint (and on
  // every chat switch/refresh). SSR renders empty and React patches on
  // hydration: a benign, invisible correction.
  const customs = listCustomChats();
  const pinnedRefs = listPinned();
  const archivedRefs = listArchived();
  const refKeys = (refs: ChatRef[]) =>
    new Set(refs.map((r) => `${r.kind}:${r.id}`));
  const pinKeys = refKeys(pinnedRefs);
  const archivedKeys = refKeys(archivedRefs);
  const isPinnedHere = (ref: ChatRef) => pinKeys.has(`${ref.kind}:${ref.id}`);
  const isArchivedHere = (ref: ChatRef) =>
    archivedKeys.has(`${ref.kind}:${ref.id}`);
  const storageOk = useStorageHealth();
  const corruptKeys = useCorruptKeys();
  // App readiness gate (spec §3–§4, frozen): render-direct reads next to
  // the listCustomChats() reads above — reactive via the same
  // useSessionVersion() subscription, no new context or effect chain.
  // U = user data settled; C = chat list hydrated for this identity.
  // Chat rows skeleton on !(U && C) — !U forces skeletons even when C
  // holds (never a live list over an unproven identity).
  const seedPending = getProfileSeedPending();
  const isUserReady = userReady(
    authState.status,
    serverProfile.status,
    seedPending,
  );
  const isChatReady = chatReady(chatAuth, getChatHydratedKey());
  const chatRowsLive = isUserReady && isChatReady;
  // Chat sync error surface (chat-error-display spec §4): hydrate failure
  // releases the spinner gate below and paints the welcome composer error.
  // The user's own failed create wins over the background hydrate failure;
  // guests never see either (zero fetches on the guest path).
  const hydrateFailed = getChatHydrateFailed();
  const welcomeSyncError =
    chatAuth != null ? (getCreateSyncError() ?? getHydrateSyncError()) : null;

  // Chat skeleton loading: `shouldShowWorkspaceSkeleton` (session.ts)
  // wraps the frozen hydrate-window predicate plus the
  // unresolved-session and user-unready windows (session settled but
  // me/profile/seed still pending while hydrate already finished — rows
  // can't paint yet, so the skeleton must). Pinned/Archived/Subjects
  // sections use their own snapshot counts below — never a shared global
  // total.
  const hydratePending = getChatHydratePending();

  // Per-workspace skeleton placement (fan-out fix): the session store is
  // memory-backed, so on reload the per-subject distribution is unknowable
  // from `customs` alone — a total count would skeleton every workspace.
  // While authed customs are live, snapshot per-subject counts to
  // localStorage (counts only, no titles — and only for authenticated
  // sessions, so guest sessions never seed it); while pending — or while
  // auth is still unresolved — read it back so ONLY the workspaces that
  // will receive rows skeleton. The keys live in `lib/session.ts` (single
  // source) and are wiped on every identity transition by the store reset —
  // never namespaced by identity: the identity key is unknowable during the
  // loading window, which is exactly when the snapshot is needed, and a
  // last-user pointer would reintroduce the leak. SSR reads none (matches
  // the "SSR renders empty" doctrine above).
  const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const stampSnapshotWrite = () => {
    try {
      window.localStorage.setItem(LAST_KNOWN_SNAPSHOT_AT_KEY, String(Date.now()));
    } catch {
      // Storage failure must never wedge render — that section just
      // renders no skeleton rows.
    }
  };
  // Write-if-changed cache: the snapshot is serialized every render but
  // localStorage is touched only when it differs from what was last
  // written (or what's already stored) — spam-reloads with unchanged
  // data perform zero writes. The ref seeds from storage on first use
  // so the post-reload render compares against truth, not a blank ref.
  // Live-empty (ready + zero customs) writes "{}" to clear stale counts;
  // pending-empty never touches the snapshot — that is the whole point.
  const lastWrittenSnapshotRef = useRef<string | null>(null);
  // Write-if-changed caches for the pinned/archived counts — same
  // zero-write-on-unchanged-data rule as the subject snapshot above.
  // Live-empty clears all three snapshots (write 0, 0); pending-empty
  // never touches any snapshot.
  const lastWrittenPinnedRef = useRef<number | null>(null);
  const lastWrittenArchivedRef = useRef<number | null>(null);
  const writeCountSnapshot = (
    key: string,
    ref: { current: number | null },
    value: number,
  ) => {
    if (ref.current == null) {
      try {
        const stored = window.localStorage.getItem(key);
        ref.current = stored == null ? Number.NaN : Number(stored);
      } catch {
        ref.current = null;
      }
    }
    if (value !== ref.current) {
      ref.current = value;
      try {
        window.localStorage.setItem(key, String(value));
        stampSnapshotWrite();
      } catch {
        // Storage failure must never wedge render — that section just
        // renders no skeleton rows.
      }
    }
  };
  if (chatAuth != null && typeof window !== "undefined") {
    const liveEmpty = chatRowsLive && customs.length === 0;
    if (customs.length > 0 || liveEmpty) {
      const counts: Record<string, number> = {};
      let pinnedCount = 0;
      let archivedCount = 0;
      for (const c of customs) {
        // Workspace counts exclude pinned/archived customs — the live
        // workspace lists exclude them too, so skeleton bars never paint
        // in a workspace for rows that will land in Pinned/Archived.
        if (isArchivedHere({ kind: "custom", id: c.code })) {
          archivedCount += 1;
          continue;
        }
        if (isPinnedHere({ kind: "custom", id: c.code })) {
          pinnedCount += 1;
          continue;
        }
        counts[c.subject] = (counts[c.subject] ?? 0) + 1;
      }
      const serialized = JSON.stringify(counts);
      if (lastWrittenSnapshotRef.current == null) {
        try {
          lastWrittenSnapshotRef.current = window.localStorage.getItem(
            LAST_KNOWN_SUBJECT_COUNTS_KEY,
          );
        } catch {
          lastWrittenSnapshotRef.current = null;
        }
      }
      if (serialized !== lastWrittenSnapshotRef.current) {
        lastWrittenSnapshotRef.current = serialized;
        try {
          window.localStorage.setItem(
            LAST_KNOWN_SUBJECT_COUNTS_KEY,
            serialized,
          );
          stampSnapshotWrite();
        } catch {
          // Storage failure must never wedge render — that workspace just
          // renders no skeleton rows.
        }
      }
      writeCountSnapshot(
        LAST_KNOWN_PINNED_COUNT_KEY,
        lastWrittenPinnedRef,
        pinnedCount,
      );
      writeCountSnapshot(
        LAST_KNOWN_ARCHIVED_COUNT_KEY,
        lastWrittenArchivedRef,
        archivedCount,
      );
    }
  }
  // Empty-flash fix: `shouldShowChatListSkeleton` (frozen) requires
  // `authenticated`, but `useAuth` stays "loading" until the live session
  // check resolves — that whole window painted the real empty list, so
  // reloads read as "I have no chats" before the skeleton ever appeared.
  // `shouldShowWorkspaceSkeleton` covers the unresolved window plus the
  // user-unready window (session settled but me/profile/seed still pending
  // while hydrate already finished — rows can't paint yet, so the skeleton
  // must, or the sidebar flashes blank); `skeletonRowsFor` returns 0
  // without a snapshot, so first-timers see zero skeletons, and known
  // guests never skeleton. Residue closed by the caching Fix 1 transition
  // wipe: post-transition heaps hold no foreign snapshot, and pre-fix
  // snapshots without a timestamp are cleared by the age-cap above before
  // any read.
  const showWorkspaceSkeleton = shouldShowWorkspaceSkeleton(
    authState.status,
    hydratePending,
    customs.length,
    isUserReady,
    hydrateFailed,
  );
  const readCountSnapshot = (key: string): number => {
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = raw == null ? 0 : Number(raw);
      return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
    } catch {
      return 0;
    }
  };
  let lastKnownBySubject: Record<string, number> = {};
  let lastKnownPinnedCount = 0;
  let lastKnownArchivedCount = 0;
  // 24 h age cap: a snapshot older than the cap (or with no timestamp,
  // e.g. pre-fix snapshots) is cleared + read as empty — never painted.
  let snapshotFresh = false;
  if (showWorkspaceSkeleton && typeof window !== "undefined") {
    try {
      const atRaw = window.localStorage.getItem(LAST_KNOWN_SNAPSHOT_AT_KEY);
      const at = atRaw == null ? Number.NaN : Number(atRaw);
      snapshotFresh =
        Number.isFinite(at) && Date.now() - at <= SNAPSHOT_MAX_AGE_MS;
    } catch {
      snapshotFresh = false;
    }
    if (!snapshotFresh) {
      try {
        window.localStorage.removeItem(LAST_KNOWN_SUBJECT_COUNTS_KEY);
        window.localStorage.removeItem(LAST_KNOWN_PINNED_COUNT_KEY);
        window.localStorage.removeItem(LAST_KNOWN_ARCHIVED_COUNT_KEY);
        window.localStorage.removeItem(LAST_KNOWN_SNAPSHOT_AT_KEY);
      } catch {
        // Storage failure must never wedge render — that section just
        // renders no skeleton rows.
      }
    }
  }
  if (showWorkspaceSkeleton && snapshotFresh && typeof window !== "undefined") {
    try {
      lastKnownBySubject =
        (JSON.parse(
          window.localStorage.getItem(LAST_KNOWN_SUBJECT_COUNTS_KEY) ?? "{}",
        ) as Record<string, number>) ?? {};
    } catch {
      lastKnownBySubject = {};
    }
    lastKnownPinnedCount = readCountSnapshot(LAST_KNOWN_PINNED_COUNT_KEY);
    lastKnownArchivedCount = readCountSnapshot(LAST_KNOWN_ARCHIVED_COUNT_KEY);
  }
  const skeletonRowsFor = (subject: string): number =>
    showWorkspaceSkeleton
      ? Math.min(Math.max(lastKnownBySubject[subject] ?? 0, 0), 3)
      : 0;
  // Pinned/Archived use their own snapshot counts — never the global
  // total. Zero snapshot → zero rows (never fake rows to fill space).
  const pinnedSkeletonRows = showWorkspaceSkeleton
    ? Math.min(Math.max(lastKnownPinnedCount, 0), 3)
    : 0;
  const archivedSkeletonRows = showWorkspaceSkeleton
    ? Math.min(Math.max(lastKnownArchivedCount, 0), 3)
    : 0;

  const [mode, setMode] = useState<string | null>(
    initialSubjectValue ?? "auto",
  );

  const [category, setCategory] = useState<string | null>(initialSubjectValue);

  // Persisted shell (transition:persist): chat swaps arrive as new props,
  // not remounts, so the sidebar (pins, customs, archives, scroll) stays
  // exactly as-is. Only route-derived state re-syncs; ThreadView remounts
  // via its key below, which cancels any in-flight stream on its own.
  useEffect(() => {
    const chat =
      initialCode != null ? getChatByCode(initialCode) : null;
    const customCode =
      chat == null &&
      initialCode != null &&
      isChatCodeFormat(initialCode)
        ? initialCode
        : null;
    const subject =
      chat?.subject ?? (isSubject(initialSubject) ? initialSubject : null);
    // Direct /profile load (or deep link like /profile#study): open the
    // dialog over the welcome view. In-app opens go through openProfile.
    if (initialView === "profile") {
      openProfile(tabFromHash());
    }
    setSelectedChat(chat?.label ?? null);
    setDraftCode(customCode);
    setDraftAutoSend(null);
    setCategory(subject);
    setMode(subject ?? "auto");
    setAttachments([]);
    setRenameTarget(null);
    setDeleteTarget(null);
    setIsSearchOpen(false);
    setSearchQuery("");
    setIsModeMenuOpen(false);
  }, [initialSubject, initialCode, initialView]);

  // Dead deep link: the URL names a custom chat the ready store doesn't
  // have (deleted or unknown code). Bounce to /new instead of stranding
  // the welcome composer on a chat URL. Runs only when the store is live,
  // so in-app opens (chat written before draftCode is set) never trip it.
  useEffect(() => {
    if (!chatRowsLive) return;
    if (draftCode == null) return;
    if (customs.some((c) => c.code === draftCode)) return;
    navigate("/new");
  }, [chatRowsLive, customs, draftCode]);

  const [attachments, setAttachments] = useState<StagedFile[]>([]);

  // Unsent welcome text survives reloads (debounced; send clears it).
  const [welcomeText, setWelcomeText] = useState(() => readDraft("welcome"));

  useEffect(() => {
    const t = window.setTimeout(() => writeDraft("welcome", welcomeText), 400);
    return () => window.clearTimeout(t);
  }, [welcomeText]);

  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);

  const composerInputRef = useRef<ChatComposerInputHandle>(null);

  const dictation = useChatDictation({
    inputRef: composerInputRef,
  });

  const activeMode =
    MODE_OPTIONS.find((m) => m.key === mode) ?? MODE_OPTIONS[0];

  const suggestions = category ? CATEGORY_SUGGESTIONS[category] : null;

  const renamePlaceholder =
    renameTarget?.kind === "custom"
      ? (customs.find((c) => c.code === renameTarget.code)?.title ?? "")
      : renameTarget
        ? demoDisplayLabel(renameTarget.label)
        : "";

  // Persists rename, then closes the dialog. The dialog stays open until
  // persistence succeeds (slice-12): a failed server rename keeps the
  // original name, fires one toast, and leaves the dialog open to retry.
  const saveRename = async () => {
    if (isRenaming || renameTarget == null) return;
    setIsRenaming(true);
    try {
      if (renameTarget.kind === "custom") {
        const ok = await renameChatBacked(renameTarget.code, renameValue, chatAuth, {
          notify: notifyChat,
        });
        if (ok) setRenameTarget(null);
      } else {
        renameDemoChat(renameTarget.label, renameValue);
        setRenameTarget(null);
      }
    } finally {
      setIsRenaming(false);
    }
  };

  // Delete confirmation handler. Server deletes stay non-optimistic
  // (slice-12): the AlertDialog confirm spins, memory follows on success,
  // and failure keeps the chat + one toast with the dialog still open.
  const [isDeleting, setIsDeleting] = useState(false);
  const confirmDelete = () => {
    if (isDeleting || deleteTarget == null) return;
    const target = deleteTarget;
    if (
      target.kind === "custom" &&
      chatAuth != null &&
      isServerChat(target.id)
    ) {
      setIsDeleting(true);
      void deleteChatBacked(target.id, chatAuth, {
        notify: notifyChat,
      }).then((ok) => {
        setIsDeleting(false);
        if (!ok) return;
        if (draftCode === target.id) {
          setDraftCode(null);
          setDraftAutoSend(null);
          navigate("/new");
        }
        setDeleteTarget(null);
      });
      return;
    }
    setIsDeleting(true);
    try {
      if (target.kind === "custom") {
        deleteCustomChat(target.id);
        if (draftCode === target.id) {
          setDraftCode(null);
          setDraftAutoSend(null);
          navigate("/new");
        }
      } else {
        archiveChat({ kind: "demo", id: target.id });
        if (selectedChat === target.id) {
          // Client-side transition: the persisted shell re-syncs from the
          // new page's props, so the sidebar never rebuilds.
          navigate("/new");
        }
      }
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  const query = searchQuery.trim().toLowerCase();
  const matchesQuery = (label: string) =>
    query === "" || label.toLowerCase().includes(query);

  // Pinned + archived rows (customs by code, demos by label).
  const refTitle = (ref: ChatRef): string | null =>
    ref.kind === "custom"
      ? (customs.find((c) => c.code === ref.id)?.title ?? null)
      : demoDisplayLabel(ref.id);

  const openRef = (ref: ChatRef) => {
    // Gate: demo navigation is disabled while user data loads. Custom
    // rows are unreachable here while gated (skeletoned, not rendered).
    if (ref.kind === "demo" && !isUserReady) return;
    if (ref.kind === "custom") {
      setDraftCode(ref.id);
      setDraftAutoSend(null);
      setSelectedChat(null);
      const subject =
        customs.find((c) => c.code === ref.id)?.subject ?? "CN";
      navigate(
        buildChatPath(isSubject(subject) ? subject : "CN", ref.id),
      );
    } else {
      openConversation(ref.id);
    }
  };

  const isRefOpen = (ref: ChatRef) =>
    ref.kind === "custom" ? draftCode === ref.id : selectedChat === ref.id;

  const archiveAndExit = (ref: ChatRef) => {
    if (ref.kind === "demo" || chatAuth == null || !isServerChat(ref.id)) {
      const key = refKeyOf(ref);
      setRowPending(key, true);
      try {
        archiveChat(ref);
        if (ref.kind === "custom" && draftCode === ref.id) {
          setDraftCode(null);
          setDraftAutoSend(null);
          navigate("/new");
        }
        if (ref.kind === "demo" && selectedChat === ref.id) {
          navigate("/new");
        }
      } finally {
        setRowPending(key, false);
      }
      return;
    }
    // Server-backed archive: optimistic row change, rollback + toast on
    // failure (slice-12); the open chat only closes on success.
    const key = refKeyOf(ref);
    setRowPending(key, true);
    void setArchivedBacked(ref, true, chatAuth, {
      notify: notifyChat,
    }).then((ok) => {
      try {
        if (ok && draftCode === ref.id) {
          setDraftCode(null);
          setDraftAutoSend(null);
          navigate("/new");
        }
      } finally {
        setRowPending(key, false);
      }
    });
  };

  const startRename = (ref: ChatRef, display: string) => {
    setRenameValue(display);
    setRenameTarget(
      ref.kind === "custom"
        ? { kind: "custom", code: ref.id }
        : { kind: "demo", label: ref.id },
    );
  };

  // Listed chats: full menu. Demo Delete archives via confirm
  // (Archive is instant; Delete asks first). Server-backed customs
  // write through with row pending + rollback (slice-12); demos and
  // guest customs keep today's synchronous key-set path.
  const listedMenu = (ref: ChatRef, display: string): ChatMenuItem[] => {
    const key = refKeyOf(ref);
    const wrap = (fn: () => void): ChatMenuItem["onClick"] => () => {
      setRowPending(key, true);
      try {
        fn();
      } finally {
        setRowPending(key, false);
      }
    };
    const wrapAsync = (
      fn: () => Promise<boolean>,
    ): ChatMenuItem["onClick"] => () => {
      setRowPending(key, true);
      void fn().finally(() => setRowPending(key, false));
    };
    const pinItem: ChatMenuItem =
      ref.kind === "demo" || chatAuth == null || !isServerChat(ref.id)
        ? {
            label: isPinnedHere(ref) ? "Unpin" : "Pin",
            onClick: wrap(() => togglePin(ref)),
          }
        : {
            label: isPinnedHere(ref) ? "Unpin" : "Pin",
            onClick: wrapAsync(() =>
              setPinBacked(ref, !isPinnedHere(ref), chatAuth, {
                notify: notifyChat,
              }),
            ),
          };
    const archiveItem: ChatMenuItem = {
      label: "Archive",
      onClick: () => archiveAndExit(ref),
    };
    return [
      pinItem,
      { label: "Rename", onClick: () => startRename(ref, display) },
      archiveItem,
      {
        label: "Delete",
        onClick: () =>
          setDeleteTarget(
            ref.kind === "custom"
              ? { kind: "custom", id: ref.id, title: display }
              : { kind: "demo", id: ref.id, title: display },
          ),
      },
    ];
  };

  const archivedMenu = (ref: ChatRef, display: string): ChatMenuItem[] => {
    const key = refKeyOf(ref);
    const wrap = (fn: () => void): ChatMenuItem["onClick"] => () => {
      setRowPending(key, true);
      try {
        fn();
      } finally {
        setRowPending(key, false);
      }
    };
    const wrapAsync = (
      fn: () => Promise<boolean>,
    ): ChatMenuItem["onClick"] => () => {
      setRowPending(key, true);
      void fn().finally(() => setRowPending(key, false));
    };
    const unarchiveItem: ChatMenuItem =
      ref.kind === "demo" || chatAuth == null || !isServerChat(ref.id)
        ? { label: "Unarchive", onClick: wrap(() => unarchiveChat(ref)) }
        : {
            label: "Unarchive",
            onClick: wrapAsync(() =>
              setArchivedBacked(ref, false, chatAuth, {
                notify: notifyChat,
              }),
            ),
          };
    return [
      unarchiveItem,
      ...(ref.kind === "custom"
        ? [
            {
              label: "Delete",
              onClick: () =>
                setDeleteTarget({ kind: "custom", id: ref.id, title: display }),
            },
          ]
        : []),
    ];
  };

  const collectRows = (refs: ChatRef[], includeArchived: boolean) =>
    refs
      .filter((ref) => includeArchived || !isArchivedHere(ref))
      .map((ref) => ({ ref, title: refTitle(ref) }))
      .filter(
        (r): r is { ref: ChatRef; title: string } =>
          r.title != null && matchesQuery(r.title),
      );

  const pinnedRows = collectRows(pinnedRefs, false);
  const archivedRows = collectRows(archivedRefs, true);

  // Chat navigation: shareable URL is /subject/[subject]/[code].
  // For now the fully implemented conversation is CN → TCP vs UDP;
  // every other code deep-links to the same welcome shell with the
  // correct subject + selection until its thread is built.
  const openConversation = (label: string) => {
    // Gate: demo navigation is disabled while user data loads.
    if (!isUserReady) return;
    setSelectedChat(label);
    setDraftCode(null);
    const subject = getChatSubject(label);
    const chatCode = getChatCode(label);
    navigate(buildChatPath(subject, chatCode));
  };

  const startNewChat = () => {
    setSelectedChat(null);
    setDraftCode(null);
    setDraftAutoSend(null);
    // New chat always opens a fresh Auto chat (Claude-style).
    if (
      window.location.pathname !== "/new" &&
      window.location.pathname !== "/"
    ) {
      navigate("/new");
    }
  };

  const handleWelcomeSend = (value: string) => {
    const text = value.trim();
    if (!text) return;
    // Gate: the welcome composer is skeleton-swapped (unreachable) while
    // user data loads; this guard covers any programmatic send path.
    if (!isUserReady) return;
    // Mockup default: unscoped chats file under CN until backend scopes them.
    const subject = category ?? (mode && mode !== "auto" ? mode : "CN");
    // @ tokens stay in the sent text (responder scopes on them) but out of
    // the sidebar title.
    const title = stripReferenceTokens(text) || text;
    if (chatAuth == null) {
      // Guest path: memory-only, byte-identical to today's behavior.
      const chat = createCustomChat(subject, title);
      const staged = attachments;
      setSelectedChat(null);
      setAttachments([]);
      // Send clears the composer via ChatComposer's own onChange.
      revokeStaged(staged);
      setDraftCode(chat.code);
      setDraftAutoSend({ text, attachments: staged.map((s) => s.att) });
      navigate(
        buildChatPath(isSubject(subject) ? subject : "CN", chat.code),
      );
      return;
    }
    // Authenticated path: the server row is created first (no temp code
    // to reconcile); failure keeps the composer text + one toast.
    const staged = attachments;
    setAttachments([]);
    void createChatBacked(subject, title, chatAuth, {
      notify: notifyChat,
    }).then((chat) => {
      if (chat == null) {
        setWelcomeText(text);
        setAttachments(staged);
        return;
      }
      setSelectedChat(null);
      // Send clears the composer via ChatComposer's own onChange.
      revokeStaged(staged);
      setDraftCode(chat.code);
      setDraftAutoSend({ text, attachments: staged.map((s) => s.att) });
      navigate(
        buildChatPath(isSubject(subject) ? subject : "CN", chat.code),
      );
    });
  };

  const removeStaged = (id: string) => {
    const target = attachments.find((s) => s.att.id === id);
    if (target) revokeStaged([target]);
    setAttachments((prev) => prev.filter((s) => s.att.id !== id));
  };

  // Global shortcuts: Ctrl/⌘+K new chat; Esc closes shell UI first, then
  // defers to the open thread (stop stream / cancel edit / close find);
  // "/" focuses whichever composer is visible. Never fires from editable
  // targets (typing "/" or Ctrl+K in a field must not navigate). Each
  // shortcut obeys its profile toggle (Shortcuts section) — off means
  // the keys do nothing here.
  useEffect(() => {
    const isEditable = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      t.closest('input, textarea, [contenteditable="true"]') != null;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        if (!getProfile().shortcutNewChat) return;
        e.preventDefault();
        startNewChat();
        return;
      }
      if (e.key === "Escape") {
        // The session gate and onboarding wizard are required-purpose
        // and non-closable: while either is open Esc yields — it must
        // not close shell UI behind them or cancel the open thread.
        if (isGateOpen || isOnboardingOpen) return;
        if (!getProfile().shortcutCancel) return;
        if (
          renameTarget != null ||
          deleteTarget != null ||
          isSearchOpen ||
          isModeMenuOpen
        ) {
          setRenameTarget(null);
          setDeleteTarget(null);
          setIsSearchOpen(false);
          setSearchQuery("");
          setIsModeMenuOpen(false);
          return;
        }
        window.dispatchEvent(new CustomEvent(CANCEL_EVENT));
        return;
      }
      if (e.key === "/" && !isEditable(e.target)) {
        if (!getProfile().shortcutFocus) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(FOCUS_COMPOSER_EVENT));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [renameTarget, deleteTarget, isSearchOpen, isModeMenuOpen, isGateOpen, isOnboardingOpen]);

  // Welcome composer answers "/" focus requests.
  useEffect(() => {
    const onFocus = () => composerInputRef.current?.focus();
    window.addEventListener(FOCUS_COMPOSER_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_COMPOSER_EVENT, onFocus);
  }, []);

  // Files from picker, drop, or paste all land in the drawer.
  const stageIntoDrawer = (files: File[]) => {
    if (files.length === 0) return;
    setAttachments((prev) => [...prev, ...stageFiles(files)]);
  };

  /* ---------------------------------------------------------------------- */
  /* Suggestion → Composer                                                 */
  /* ---------------------------------------------------------------------- */

  const applySuggestion = (prompt: string) => {
    // Gate: suggestion cards are disabled while user data loads.
    if (!isUserReady) return;
    const input = composerInputRef.current;

    if (!input) {
      return;
    }

    input.focus();

    input.insertText(prompt);

    document.activeElement?.dispatchEvent(
      new Event("input", {
        bubbles: true,
      }),
    );
  };

  /* ---------------------------------------------------------------------- */
  /* Reference → Composer                                                  */
  /* ---------------------------------------------------------------------- */

  const insertReference = (item: (typeof REFERENCE_ITEMS)[number]) => {
    // Gate: the reference menu is unreachable while user data loads
    // (composer skeleton-swapped); this guard covers the same path.
    if (!isUserReady) return;
    const input = composerInputRef.current;

    if (!input) {
      return;
    }

    input.focus();

    input.insertToken({
      value: `@${item.id}`,
      label: item.label,
      variant: "blue",
    });

    document.activeElement?.dispatchEvent(
      new Event("input", {
        bubbles: true,
      }),
    );
  };

  return (
    <Theme theme={PESDacMockupTheme} mode="dark">
      {/* Layer host for toasts (F7): useToast() SSR-throws without it.
          Toast viewport is anchored top-left with a 3-toast cap, so
          transient errors (slice 12E / 15) and success notices land
          where the eye is, not in a bottom-left fallback. */}
      <LayerProvider toast={{ position: "topStart", maxVisible: 3 }}>
      <AppShell
        contentPadding={0}
        /* ================================================================== */
        /* Sidebar                                                            */
        /* ================================================================== */

        sideNav={
          <SideNav
            collapsible
            resizable={{
              defaultWidth: 300,
              minWidth: 240,
              maxWidth: 420,
            }}
            header={
              <SideNavHeading
                heading="PESDac"
                icon={<NavIcon icon={<Icon icon={SparklesIcon} size="sm" />} />}
                headingHref="#"
              />
            }
            footer={
              <SideNavSection title="Account" isHeaderHidden>
                {authState.status === "authenticated" && (
                  <HStack gap={2} vAlign="center" padding={1}>
                    <Avatar
                      name={
                        displayName ||
                        accountEmail ||
                        "?"
                      }
                      size="sm"
                      tooltip={!isAnyModalOpen}
                    />
                    <VStack gap={0.5}>
                      <Text type="body" weight="bold" maxLines={1} hasTruncateTooltip={!isAnyModalOpen}>
                        {displayName ||
                          accountEmail ||
                          "?"}
                      </Text>
                      {displayName !== "" && (
                        <Text
                          type="supporting"
                          color="secondary"
                          maxLines={1}
                          hasTruncateTooltip={!isAnyModalOpen}
                        >
                          {accountEmail}
                        </Text>
                      )}
                    </VStack>
                  </HStack>
                )}
                {authState.status === "loading" && (
                  <HStack
                    gap={2}
                    vAlign="center"
                    padding={1}
                    aria-busy="true"
                    aria-label="Loading account"
                  >
                    <Skeleton width={32} height={32} radius="rounded" />
                    <VStack gap={0.5}>
                      <Skeleton width={96} height={12} />
                      <Skeleton width={128} height={10} />
                    </VStack>
                  </HStack>
                )}
                <SideNavItem
                  label="Settings"
                  icon={Cog6ToothIcon}
                  href="#"
                  isDisabled={!isUserReady}
                  onClick={(event) => {
                    event.preventDefault();
                    if (!isUserReady) return;
                    openProfile("profile");
                  }}
                />

                <SideNavItem
                  label="My Profile"
                  icon={UserCircleIcon}
                  href="#"
                  isDisabled={!isUserReady}
                  onClick={(event) => {
                    event.preventDefault();
                    if (!isUserReady) return;
                    openProfile("profile");
                  }}
                />
                {authState.status === "authenticated" ? (
                  <SideNavItem
                    label={isLoggingOut ? "Logging out…" : "Logout"}
                    icon={ArrowLeftStartOnRectangleIcon}
                    href="#"
                    isDisabled={isLoggingOut}
                    onClick={(event) => {
                      event.preventDefault();
                      if (isLoggingOut) return;
                      void handleLogout();
                    }}
                  />
                ) : authState.status === "guest" ? (
                  <SideNavItem
                    label="Login"
                    icon={ArrowRightStartOnRectangleIcon}
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      navigate("/login");
                    }}
                  />
                ) : null}
              </SideNavSection>
            }
          >
            {/* Main navigation */}

            <SideNavSection title="Menu" isHeaderHidden>
              <SideNavItem
                label="New chat"
                icon={PlusIcon}
                href="#"
                isSelected={selectedChat === null}
                isDisabled={!isUserReady}
                onClick={(event) => {
                  event.preventDefault();
                  if (!isUserReady) return;
                  startNewChat();
                }}
              />

              <SideNavItem
                label="Search conversations"
                icon={MagnifyingGlassIcon}
                href="#"
                isSelected={isSearchOpen}
                isDisabled={!isUserReady}
                onClick={(event) => {
                  event.preventDefault();
                  if (!isUserReady) return;
                  setIsSearchOpen((v) => !v);
                  setSearchQuery("");
                }}
              />

              {/* T23: Study Library is on the planned-feature boundary — keep
                  the visual entry point but mark it explicitly disabled
                  with a "Coming soon" affordance so the user knows it
                  isn't a live route. Toggling or removing would be a
                  redesign; this is the smallest honest change. */}
              <SideNavItem
                label="Study Library"
                icon={BookOpenIcon}
                href="#"
                isDisabled
                onClick={(event) => {
                  event.preventDefault();
                }}
              />
            </SideNavSection>

            {isSearchOpen && (
              <TextInput
                label="Search conversations"
                isLabelHidden
                placeholder="Search conversations..."
                startIcon={MagnifyingGlassIcon}
                hasClear
                value={searchQuery}
                onChange={setSearchQuery}
              />
            )}

            <Divider />

            {/* Subjects */}

            {(pinnedRows.length > 0 || pinnedSkeletonRows > 0) && (
              <SideNavSection title="Pinned">
                <VStack gap={0.5}>
                  {pinnedRows.map(({ ref, title }) => {
                    // Gated custom rows are covered by the skeleton block
                    // below (never a live list over an unproven identity).
                    if (ref.kind === "custom" && !chatRowsLive) return null;
                    return (
                      <ConversationItem
                        key={`${ref.kind}:${ref.id}`}
                        label={title}
                        icon={BookmarkIcon}
                        isSelected={isRefOpen(ref)}
                        isPending={isRowPending(ref)}
                        isDisabled={ref.kind === "demo" && !isUserReady}
                        onClick={() => openRef(ref)}
                        menu={listedMenu(ref, title)}
                      />
                    );
                  })}
                  {showWorkspaceSkeleton && (
                    <ChatListSkeleton rows={pinnedSkeletonRows} withIcon />
                  )}
                </VStack>
              </SideNavSection>
            )}

            <SideNavSection title="Subjects" isHeaderHidden>
              {WORKSPACES.map((workspace) => {
                const demoChats = workspace.chats.filter(
                  (chat) =>
                    !isArchivedHere({ kind: "demo", id: chat.label }) &&
                    !isPinnedHere({ kind: "demo", id: chat.label }) &&
                    matchesQuery(demoDisplayLabel(chat.label)),
                );
                const workspaceCustoms = customs.filter(
                  (c) =>
                    c.subject === workspace.name &&
                    !isArchivedHere({ kind: "custom", id: c.code }) &&
                    !isPinnedHere({ kind: "custom", id: c.code }) &&
                    matchesQuery(c.title),
                );
                if (
                  query !== "" &&
                  demoChats.length === 0 &&
                  workspaceCustoms.length === 0
                ) {
                  return null;
                }
                return (
                  <SideNavItem
                    key={workspace.name}
                    label={workspace.name}
                    icon={workspace.icon}
                    collapsible={{
                      defaultIsCollapsed: false,
                    }}
                  >
                    <VStack gap={0.5}>
                      {demoChats.map((chat) => {
                        const display = demoDisplayLabel(chat.label);
                        const ref: ChatRef = {
                          kind: "demo",
                          id: chat.label,
                        };
                        return (
                          <ConversationItem
                            key={chat.label}
                            label={display}
                            isSelected={chat.label === selectedChat}
                            isPending={isRowPending(ref)}
                            isDisabled={!isUserReady}
                            onClick={() => openConversation(chat.label)}
                            menu={listedMenu(ref, display)}
                          />
                        );
                      })}
                      {chatRowsLive ? (
                        workspaceCustoms.map((c) => {
                        const ref: ChatRef = {
                          kind: "custom",
                          id: c.code,
                        };
                        return (
                          <ConversationItem
                            key={c.code}
                            label={c.title}
                            isSelected={c.code === draftCode}
                            isPending={isRowPending(ref)}
                            onClick={() => {
                              setDraftCode(c.code);
                              setDraftAutoSend(null);
                              setSelectedChat(null);
                              navigate(
                                buildChatPath(
                                  isSubject(c.subject) ? c.subject : "CN",
                                  c.code,
                                ),
                              );
                            }}
                            menu={listedMenu(ref, c.title)}
                          />
                        );
                      })
                      ) : showWorkspaceSkeleton ? (
                        <ChatListSkeleton
                          rows={skeletonRowsFor(workspace.name)}
                        />
                      ) : null}
                    </VStack>
                  </SideNavItem>
                );
              })}
            </SideNavSection>

            {(archivedRows.length > 0 || archivedSkeletonRows > 0) && (
              <SideNavSection title="Archived">
                <VStack gap={0.5}>
                  {archivedRows.map(({ ref, title }) => {
                    // Same rule as Pinned above: gated customs skeleton,
                    // demos render disabled.
                    if (ref.kind === "custom" && !chatRowsLive) return null;
                    return (
                      <ConversationItem
                        key={`${ref.kind}:${ref.id}`}
                        label={title}
                        isSelected={isRefOpen(ref)}
                        isPending={isRowPending(ref)}
                        isDisabled={ref.kind === "demo" && !isUserReady}
                        onClick={() => openRef(ref)}
                        menu={archivedMenu(ref, title)}
                      />
                    );
                  })}
                  {showWorkspaceSkeleton && (
                    <ChatListSkeleton rows={archivedSkeletonRows} />
                  )}
                </VStack>
              </SideNavSection>
            )}
          </SideNav>
        }

        /* ================================================================== */
        /* Main Chat                                                          */
        /* ================================================================== */
      >
        {(() => {
          const draftChat =
            draftCode != null
              ? (customs.find((c) => c.code === draftCode) ?? null)
              : null;
          const draftThread = draftChat ? makeDraftThread(draftChat) : null;
          // Deep-link pending: the URL names a custom chat the store
          // hasn't resolved yet (cold refresh before hydrate lands).
          // Render the real thread shell with skeleton turns — never the
          // /new welcome composer (that composer lives strictly on /new).
          // Provisional carries URL-known fields only; the title lands on
          // hydrate under the same key, so no remount and no composer swap.
          const deepLinkPending =
            draftCode != null && draftChat == null && !chatRowsLive;
          const provisionalThread = deepLinkPending
            ? makeDraftThread({
                code: draftCode,
                subject: isSubject(initialSubject) ? initialSubject : "CN",
                title: "",
                createdAt: new Date().toISOString(),
              })
            : null;
          const thread =
            draftThread ??
            provisionalThread ??
            (selectedChat != null ? getThread(selectedChat) : null);
          const key =
            draftCode ??
            (selectedChat != null ? getChatCode(selectedChat) : "home");
          return thread ? (
            <ThreadView
              // Thread swaps remount the view (fresh scroll, cancelled
              // streams) while the persisted sidebar stays untouched.
              key={key}
              thread={thread}
              sessionKey={key}
              autoSend={draftThread ? (draftAutoSend ?? undefined) : undefined}
              isHistoryLoading={provisionalThread != null && !hydrateFailed}
              notify={notifyChat}
              // App readiness gate (spec §4): the thread skeletons and
              // disables its composer while user data loads.
              isAppReady={isUserReady}
            />
          ) : (
          <Layout
            height="fill"
            contentWidth={720}
            content={
              <LayoutContent>
                <VStack gap={8} vAlign="center" style={pageStyle}>
                  {/* ======================================================== */}
                  {/* Welcome                                                   */}
                  {/* ======================================================== */}

                  <VStack gap={1}>
                    <HStack gap={2} vAlign="center">
                      <Icon icon={SparklesIcon} size="md" color="accent" />

                      <Text type="large" as="h2">
                        Welcome to PESDac
                      </Text>
                    </HStack>

                    <Text type="display-2" as="h1">
                      {firstName !== ""
                        ? `What are you studying today, ${firstName}?`
                        : "What are you studying today?"}
                    </Text>
                  </VStack>

                  {/* ======================================================== */}
                  {/* Actual Astryx Chat Composer                              */}
                  {/* ======================================================== */}

{/* Gate: granular skeleton per composer component until user data
                       is ready (no input accepted before then). Paint-only swap —
                       `welcomeText` and staged attachments survive in state and
                       restore on ready. */}
                   {!isUserReady ? (
                     <ComposerSkeleton aria-busy="true" aria-label="Loading composer" />
                   ) : (
                    <ChatComposer
                     value={welcomeText}
                     onChange={setWelcomeText}
                     onSubmit={handleWelcomeSend}
                     statusPosition={welcomeSyncError != null ? "top" : undefined}
                     status={
                       welcomeSyncError != null
                         ? {
                             type: "error",
                             message: welcomeSyncError,
                           }
                         : !storageOk
                           ? {
                               type: "warning",
                               message:
                                 "History isn't saving in this browser — new chats will be lost on reload.",
                             }
                           : corruptKeys.length > 0
                             ? {
                                 type: "warning",
                                 message:
                                   "Saved data looked damaged, so chats may be incomplete — new messages still save normally.",
                               }
                             : undefined
                     }
                    placeholder={
                      category
                        ? `Ask something about ${category}...`
                        : "Ask anything about your course..."
                    }
                      input={
                        <ChatComposerInput
                          handleRef={composerInputRef}
                          triggers={[referenceTrigger]}
                          style={composerInput}
                          onFiles={stageIntoDrawer}
                        />
                      }
                    /* ------------------------------------------------------ */
                    /* Attached files                                         */
                    /* ------------------------------------------------------ */

                      drawer={
                        attachments.length > 0 ? (
                          <ChatComposerDrawer
                            count={attachments.length}
                            label="Files"
                          >
                            {attachments.map((staged) =>
                              staged.previewUrl ? (
                                <Thumbnail
                                  key={staged.att.id}
                                  src={staged.previewUrl}
                                  alt={staged.att.name}
                                  label={attachmentLabel(staged.att)}
                                  onRemove={() => removeStaged(staged.att.id)}
                                />
                              ) : (
                                <Token
                                  key={staged.att.id}
                                  label={attachmentLabel(staged.att)}
                                  onRemove={() => removeStaged(staged.att.id)}
                                />
                              ),
                            )}
                          </ChatComposerDrawer>
                        ) : undefined
                      }
                    /* ------------------------------------------------------ */
                    /* Reference button                                        */
                    /* ------------------------------------------------------ */

                    headerActions={
                      <>
                        <AttachButton onFiles={stageIntoDrawer} />
                        <DropdownMenu
                          button={{
                            label: "Reference",
                            variant: "ghost",
                            size: "sm",
                            icon: <Icon icon={AtSymbolIcon} size="sm" />,
                            isIconOnly: true,
                          }}
                          hasChevron={false}
                          menuWidth={240}
                        >
                        {REFERENCE_ITEMS.map((item) => (
                          <DropdownMenuItem
                            key={item.id}
                            label={item.label}
                            description={item.auxiliaryData?.type}
                            onClick={() => insertReference(item)}
                          />
                        ))}
                      </DropdownMenu>
                      </>
                    }
                    /* ------------------------------------------------------ */
                    /* Mode + Settings                                        */
                    /* ------------------------------------------------------ */

                    footerActions={
                      <>
                        <DropdownMenu
                          button={{
                            label: activeMode.label,
                            variant: "ghost",
                            size: "md",
                            icon: <Icon icon={activeMode.icon} size="sm" />,
                            children: activeMode.label,
                          }}
                          menuWidth={200}
                          isMenuOpen={isModeMenuOpen}
                          onOpenChange={setIsModeMenuOpen}
                          items={MODE_OPTIONS.map((option) => ({
                            label: option.label,
                            icon: option.icon,

                            onClick: () => {
                              setMode(option.key);

                              /*
                               * If an actual subject is selected,
                               * also make it the active suggestion
                               * category.
                               */
                              if (option.key !== "auto") {
                                setCategory(option.key);
                              }
                            },
                          }))}
                        />

                        <DropdownMenu
                          button={{
                            label: "Settings",
                            variant: "ghost",
                            size: "md",
                            icon: <Icon icon={Cog6ToothIcon} size="sm" />,
                            children: "Settings",
                          }}
                          menuWidth={200}
                          items={[
                            {
                              label: "Study preferences",
                              onClick: () => {
                                // Shortcut to the full surface: Profile's
                                // Study tab, opened over the chat.
                                openProfile("study");
                              },
                            },
                          ]}
                        />
                      </>
                    }
                    sendActions={<ChatDictationButton dictation={dictation} />}
                  />
                  )}

                  {/* ======================================================== */}
                  {/* Subject quick filters                                   */}
                  {/* ======================================================== */}

                  <VStack gap={6} style={categories}>
                    <ToggleButtonGroup
                      label="Subject"
                      value={category}
                      isDisabled={!isUserReady}
                      onChange={(value) => {
                        // Gate: subject toggles are disabled while user
                        // data loads (zero visual change beyond disabled).
                        if (!isUserReady) return;
                        setCategory(value);
                        // Mirror the mode menu: picking a subject scopes
                        // the mode; clearing returns to Auto.
                        setMode(value ?? "auto");
                      }}
                      size="lg"
                    >
                      <ToggleButton
                        value="CN"
                        label="CN"
                        icon={<Icon icon={GlobeAltIcon} size="sm" />}
                      />

                      <ToggleButton
                        value="OS"
                        label="OS"
                        icon={<Icon icon={ComputerDesktopIcon} size="sm" />}
                      />

                      <ToggleButton
                        value="DLCD"
                        label="DLCD"
                        icon={<Icon icon={CpuChipIcon} size="sm" />}
                      />

                      <ToggleButton
                        value="DSA"
                        label="DSA"
                        icon={<Icon icon={CircleStackIcon} size="sm" />}
                      />

                      <ToggleButton
                        value="Math"
                        label="Math"
                        icon={<Icon icon={CalculatorIcon} size="sm" />}
                      />
                    </ToggleButtonGroup>

                    {/* ====================================================== */}
                    {/* Quick study cards                                     */}
                    {/* ====================================================== */}

                    {suggestions && (
                      <Grid
                        columns={{
                          minWidth: 280,
                        }}
                        gap={3}
                      >
                        {suggestions.map((suggestion) => (
                          <ClickableCard
                            key={suggestion.heading}
                            label={suggestion.heading}
                            variant="muted"
                            padding={3}
                            isDisabled={!isUserReady}
                            onClick={() => applySuggestion(suggestion.prompt)}
                          >
                            <VStack gap={0.5}>
                              <Heading level={4}>{suggestion.heading}</Heading>

                              <Text type="body" color="secondary" size="xsm">
                                {suggestion.body}
                              </Text>
                            </VStack>
                          </ClickableCard>
                        ))}
                      </Grid>
                    )}
                  </VStack>
                </VStack>
              </LayoutContent>
            }
            /* ================================================================== */
            /* Footer                                                             */
            /* ================================================================== */

            footer={undefined}
          />
          );
        })()}

        <AuthGate />

        <AppToasts toastRef={toastRef} />

        <OnboardingDialog onActiveChange={setIsOnboardingOpen} />

        {isProfileOpen && (
          <Suspense fallback={null}>
            <ProfileDialog
              isOpen
              initialTab={profileTab}
              onOpenChange={(open) => {
                if (!open) setIsProfileOpen(false);
              }}
            />
          </Suspense>
        )}

        <Dialog
          isOpen={renameTarget != null}
          onOpenChange={(open) => {
            if (!open) setRenameTarget(null);
          }}
          purpose="form"
        >
          <Layout
            header={
              <DialogHeader
                title="Rename chat"
                hasDivider
                onOpenChange={(open) => {
                  if (!open) setRenameTarget(null);
                }}
              />
            }
            content={
              <LayoutContent>
                <TextInput
                  label="Chat name"
                  value={renameValue}
                  onChange={setRenameValue}
                  onEnter={saveRename}
                  hasAutoFocus
                  placeholder={renamePlaceholder}
                />
              </LayoutContent>
            }
            footer={
              <LayoutFooter hasDivider>
                <HStack gap={2}>
                  <Button
                    label="Cancel"
                    variant="ghost"
                    isDisabled={isRenaming}
                    onClick={() => setRenameTarget(null)}
                  />
                  <Button
                    label="Save"
                    variant="primary"
                    isLoading={isRenaming}
                    isDisabled={isRenaming}
                    onClick={() => void saveRename()}
                  />
                </HStack>
              </LayoutFooter>
            }
          />
        </Dialog>

        <AlertDialog
          isOpen={deleteTarget != null}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          title={
            deleteTarget?.kind === "demo" ? "Hide chat?" : "Delete chat?"
          }
          description={
            deleteTarget == null
              ? "This chat will be removed from your sidebar."
              : deleteTarget.kind === "demo"
                ? `“${deleteTarget.title}” will be moved to your Archived chats. You can restore it anytime.`
                : `“${deleteTarget.title}” and its messages will be permanently removed. This cannot be undone.`
          }
          actionLabel={deleteTarget?.kind === "demo" ? "Hide" : "Delete"}
          isActionLoading={isDeleting}
          onAction={confirmDelete}
        />
      </AppShell>
      </LayerProvider>
    </Theme>
  );
}
