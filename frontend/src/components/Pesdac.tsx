"use client";

import { useRef, useState, type CSSProperties } from "react";

import { Theme } from "@astryxdesign/core/theme";
import { PESDacMockupTheme } from "../theme/PESDacMockupTheme";
import {
  buildChatPath,
  getChatByCode,
  getChatCode,
  getChatSubject,
  isSubject,
} from "../lib/chat";
import ThreadView from "./chat/ThreadView";
import { getThread } from "../content/threads";
import {
  useSessionVersion,
  listCustomChats,
  createCustomChat,
  renameCustomChat,
  deleteCustomChat,
  makeDraftThread,
} from "../lib/session";

import { AppShell } from "@astryxdesign/core/AppShell";

import { Divider } from "@astryxdesign/core/Divider";

import { Button } from "@astryxdesign/core/Button";

import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";

import { AlertDialog } from "@astryxdesign/core/AlertDialog";

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
import { Icon } from "@astryxdesign/core/Icon";
import type { IconType } from "@astryxdesign/core/Icon";

import { MoreMenu } from "@astryxdesign/core/MoreMenu";

import type { StatusDotVariant } from "@astryxdesign/core/StatusDot";

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
  type SearchableItem,
} from "@astryxdesign/core/Typeahead";

import {
  ToggleButton,
  ToggleButtonGroup,
} from "@astryxdesign/core/ToggleButton";

import { Token } from "@astryxdesign/core/Token";

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
  Cog6ToothIcon,
  UserCircleIcon,
  ComputerDesktopIcon,
  GlobeAltIcon,
  CpuChipIcon,
  CircleStackIcon,
  CalculatorIcon,
  AtSymbolIcon,
} from "@heroicons/react/24/outline";

/* -------------------------------------------------------------------------- */
/*                                PESDac Data                                 */
/* -------------------------------------------------------------------------- */

type Conversation = {
  label: string;
  status: StatusDotVariant;
  statusLabel: string;
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
    chats: [
      {
        label: "OSI Model",
        status: "success",
        statusLabel: "Active",
      },
      {
        label: "TCP vs UDP",
        status: "neutral",
        statusLabel: "Idle",
      },
      {
        label: "IP Addressing & Subnetting",
        status: "accent",
        statusLabel: "In progress",
      },
      {
        label: "Routing Protocols",
        status: "neutral",
        statusLabel: "Idle",
      },
    ],
  },

  {
    name: "OS",
    icon: ComputerDesktopIcon,
    chats: [
      {
        label: "Process Scheduling",
        status: "success",
        statusLabel: "Active",
      },
      {
        label: "Deadlocks",
        status: "warning",
        statusLabel: "Needs review",
      },
      {
        label: "Virtual Memory",
        status: "accent",
        statusLabel: "In progress",
      },
      {
        label: "File Systems",
        status: "neutral",
        statusLabel: "Idle",
      },
    ],
  },

  {
    name: "DLCD",
    icon: CpuChipIcon,
    chats: [
      {
        label: "Boolean Algebra",
        status: "success",
        statusLabel: "Active",
      },
      {
        label: "K-Maps",
        status: "accent",
        statusLabel: "In progress",
      },
      {
        label: "Sequential Circuits",
        status: "neutral",
        statusLabel: "Idle",
      },
      {
        label: "Flip-Flops",
        status: "neutral",
        statusLabel: "Idle",
      },
    ],
  },

  {
    name: "DSA",
    icon: CircleStackIcon,
    chats: [
      {
        label: "Binary Trees",
        status: "success",
        statusLabel: "Active",
      },
      {
        label: "Graph Algorithms",
        status: "accent",
        statusLabel: "In progress",
      },
      {
        label: "Sorting Algorithms",
        status: "neutral",
        statusLabel: "Idle",
      },
      {
        label: "Dynamic Programming",
        status: "warning",
        statusLabel: "Needs review",
      },
    ],
  },

  {
    name: "Math",
    icon: CalculatorIcon,
    chats: [
      {
        label: "Matrices",
        status: "success",
        statusLabel: "Active",
      },
      {
        label: "Differential Equations",
        status: "neutral",
        statusLabel: "Idle",
      },
      {
        label: "Probability",
        status: "accent",
        statusLabel: "In progress",
      },
      {
        label: "Fourier Series",
        status: "warning",
        statusLabel: "Needs review",
      },
    ],
  },
];

const SELECTED_CHAT = "Binary Trees";

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

const REFERENCE_ITEMS: SearchableItem<{ type: string }>[] = [
  {
    id: "slides",
    label: "Course Slides",
    auxiliaryData: {
      type: "PESDac course material",
    },
  },

  {
    id: "textbook",
    label: "Textbook",
    auxiliaryData: {
      type: "PESDac knowledge source",
    },
  },

  {
    id: "lectures",
    label: "Lecture Recordings",
    auxiliaryData: {
      type: "PESDac knowledge source",
    },
  },
];

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

function ConversationItem({
  label,
  isSelected,
  onClick,
  onRename,
  onDelete,
}: {
  label: string;
  isSelected?: boolean;
  onClick?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const showMenu = isHovered || isMenuOpen;

  return (
    <Stack
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <SideNavItem
        label={label}
        href="#"
        isSelected={isSelected}
        onClick={(event) => {
          event.preventDefault();
          onClick?.();
        }}
        actions={
          showMenu ? (
            <MoreMenu
              size="sm"
              label="Conversation options"
              onOpenChange={setIsMenuOpen}
              items={[
                { label: "Pin", onClick: () => {} },
                { label: "Rename", onClick: onRename ?? (() => {}) },
                { label: "Archive", onClick: () => {} },
                { label: "Delete", onClick: onDelete ?? (() => {}) },
              ]}
            />
          ) : null
        }
      />
    </Stack>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Main component                                */
/* -------------------------------------------------------------------------- */

export default function ShellSideNav({
  initialSubject,
  initialCode,
}: {
  initialSubject?: string;
  initialCode?: string;
} = {}) {
  // URL is source of truth for shared links: /subject/[subject]/[code].
  // Fall back to welcome state for unknown codes (mockup phase).
  const initialChat =
    initialCode != null ? getChatByCode(initialCode) : null;
  const initialSubjectValue =
    initialChat?.subject ??
    (isSubject(initialSubject) ? initialSubject : null);

  // Added interaction state; the existing welcome/composer state remains intact.
  const [selectedChat, setSelectedChat] = useState<string | null>(
    initialChat?.label ?? null,
  );
  // Custom (session) conversation open in-place (mockup: no URL for customs).
  const [draftCode, setDraftCode] = useState<string | null>(null);
  // Draft auto-send: first message typed on welcome, sent on thread mount.
  const [draftAutoSend, setDraftAutoSend] = useState<string | null>(null);
  // Rename dialog for custom chats (mockup: demo threads not renamable).
  const [renamingCode, setRenamingCode] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Delete confirmation for custom chats.
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  // Sidebar conversation search (filters demo + custom labels).
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  useSessionVersion();

  const [mode, setMode] = useState<string | null>(
    initialSubjectValue ?? "auto",
  );

  const [category, setCategory] = useState<string | null>(initialSubjectValue);

  const [attachments, setAttachments] = useState<string[]>([]);

  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);

  const composerInputRef = useRef<ChatComposerInputHandle>(null);

  const dictation = useChatDictation({
    inputRef: composerInputRef,
  });

  const activeMode =
    MODE_OPTIONS.find((m) => m.key === mode) ?? MODE_OPTIONS[0];

  const suggestions = category ? CATEGORY_SUGGESTIONS[category] : null;

  const renamingChat =
    renamingCode != null
      ? (listCustomChats().find((c) => c.code === renamingCode) ?? null)
      : null;

  const saveRename = () => {
    if (renamingChat) renameCustomChat(renamingChat.code, renameValue);
    setRenamingCode(null);
  };

  const deletingChat =
    deletingCode != null
      ? (listCustomChats().find((c) => c.code === deletingCode) ?? null)
      : null;

  const confirmDelete = () => {
    if (deletingChat) {
      deleteCustomChat(deletingChat.code);
      if (draftCode === deletingChat.code) {
        setDraftCode(null);
        setDraftAutoSend(null);
      }
    }
    setDeletingCode(null);
  };

  const query = searchQuery.trim().toLowerCase();
  const matchesQuery = (label: string) =>
    query === "" || label.toLowerCase().includes(query);

  // Chat navigation: shareable URL is /subject/[subject]/[code].
  // For now the fully implemented conversation is CN → TCP vs UDP;
  // every other code deep-links to the same welcome shell with the
  // correct subject + selection until its thread is built.
  const openConversation = (label: string) => {
    setSelectedChat(label);
    setDraftCode(null);
    const subject = getChatSubject(label);
    const chatCode = getChatCode(label);
    window.location.href = buildChatPath(subject, chatCode);
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
      window.location.href = "/new";
    }
  };

  const handleWelcomeSend = (value: string) => {
    const text = value.trim();
    if (!text) return;
    // Mockup default: unscoped chats file under CN until backend scopes them.
    const subject = category ?? (mode && mode !== "auto" ? mode : "CN");
    const chat = createCustomChat(subject, text);
    setSelectedChat(null);
    setDraftCode(chat.code);
    setDraftAutoSend(text);
  };

  /* ---------------------------------------------------------------------- */
  /* Suggestion → Composer                                                 */
  /* ---------------------------------------------------------------------- */

  const applySuggestion = (prompt: string) => {
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
                <SideNavItem label="Settings" icon={Cog6ToothIcon} href="#" />

                <SideNavItem
                  label="My Profile"
                  icon={UserCircleIcon}
                  href="#"
                />
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
                onClick={(event) => {
                  event.preventDefault();
                  startNewChat();
                }}
              />

              <SideNavItem
                label="Search conversations"
                icon={MagnifyingGlassIcon}
                href="#"
                isSelected={isSearchOpen}
                onClick={(event) => {
                  event.preventDefault();
                  setIsSearchOpen((v) => !v);
                  setSearchQuery("");
                }}
              />

              <SideNavItem label="Study Library" icon={BookOpenIcon} href="#" />
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

            <SideNavSection title="Subjects" isHeaderHidden>
              {WORKSPACES.map((workspace) => {
                const demoChats = workspace.chats.filter((chat) =>
                  matchesQuery(chat.label),
                );
                const customs = listCustomChats().filter(
                  (c) =>
                    c.subject === workspace.name && matchesQuery(c.title),
                );
                if (
                  query !== "" &&
                  demoChats.length === 0 &&
                  customs.length === 0
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
                      {demoChats.map((chat) => (
                        <ConversationItem
                          key={chat.label}
                          label={chat.label}
                          isSelected={chat.label === selectedChat}
                          onClick={() => openConversation(chat.label)}
                        />
                      ))}
                      {customs.map((c) => (
                        <ConversationItem
                          key={c.code}
                          label={c.title}
                          isSelected={c.code === draftCode}
                          onClick={() => {
                            setDraftCode(c.code);
                            setDraftAutoSend(null);
                            setSelectedChat(null);
                          }}
                          onRename={() => {
                            setRenameValue(c.title);
                            setRenamingCode(c.code);
                          }}
                          onDelete={() => {
                            setDeletingCode(c.code);
                          }}
                        />
                      ))}
                    </VStack>
                  </SideNavItem>
                );
              })}
            </SideNavSection>
          </SideNav>
        }

        /* ================================================================== */
        /* Main Chat                                                          */
        /* ================================================================== */
      >
        {(() => {
          const draftChat =
            draftCode != null
              ? (listCustomChats().find((c) => c.code === draftCode) ?? null)
              : null;
          const draftThread = draftChat ? makeDraftThread(draftChat) : null;
          const thread =
            draftThread ??
            (selectedChat != null ? getThread(selectedChat) : null);
          const key =
            draftCode ??
            (selectedChat != null ? getChatCode(selectedChat) : "home");
          return thread ? (
            <ThreadView
              thread={thread}
              sessionKey={key}
              autoSend={draftThread ? (draftAutoSend ?? undefined) : undefined}
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
                      What are you studying today?
                    </Text>
                  </VStack>

                  {/* ======================================================== */}
                  {/* Actual Astryx Chat Composer                              */}
                  {/* ======================================================== */}

                  <ChatComposer
                    onSubmit={handleWelcomeSend}
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
                        onFiles={(files) =>
                          setAttachments((prev) => [
                            ...prev,
                            ...files.map((file) => file.name),
                          ])
                        }
                      />
                    }
                    /* ------------------------------------------------------ */
                    /* Attached files                                         */
                    /* ------------------------------------------------------ */

                    drawer={
                      attachments.length > 0 ? (
                        <ChatComposerDrawer count={attachments.length}>
                          {attachments.map((name) => (
                            <Token
                              key={name}
                              label={name}
                              onRemove={() =>
                                setAttachments((prev) =>
                                  prev.filter((n) => n !== name),
                                )
                              }
                            />
                          ))}
                        </ChatComposerDrawer>
                      ) : undefined
                    }
                    /* ------------------------------------------------------ */
                    /* Reference button                                        */
                    /* ------------------------------------------------------ */

                    headerActions={
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
                              onClick: () => {},
                            },
                            {
                              label: "Knowledge sources",
                              onClick: () => {},
                            },
                            {
                              label: "About PESDac",
                              onClick: () => {},
                            },
                          ]}
                        />
                      </>
                    }
                    sendActions={<ChatDictationButton dictation={dictation} />}
                  />

                  {/* ======================================================== */}
                  {/* Subject quick filters                                   */}
                  {/* ======================================================== */}

                  <VStack gap={6} style={categories}>
                    <ToggleButtonGroup
                      label="Subject"
                      value={category}
                      onChange={setCategory}
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

        <Dialog
          isOpen={renamingChat != null}
          onOpenChange={(open) => {
            if (!open) setRenamingCode(null);
          }}
          purpose="form"
        >
          <Layout
            header={
              <DialogHeader
                title="Rename chat"
                hasDivider
                onOpenChange={(open) => {
                  if (!open) setRenamingCode(null);
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
                  placeholder={renamingChat?.title}
                />
              </LayoutContent>
            }
            footer={
              <LayoutFooter hasDivider>
                <HStack gap={2}>
                  <Button
                    label="Cancel"
                    variant="ghost"
                    onClick={() => setRenamingCode(null)}
                  />
                  <Button label="Save" variant="primary" onClick={saveRename} />
                </HStack>
              </LayoutFooter>
            }
          />
        </Dialog>

        <AlertDialog
          isOpen={deletingChat != null}
          onOpenChange={(open) => {
            if (!open) setDeletingCode(null);
          }}
          title="Delete chat?"
          description={
            deletingChat
              ? `“${deletingChat.title}” and its messages will be permanently removed. This cannot be undone.`
              : "This chat and its messages will be permanently removed."
          }
          actionLabel="Delete"
          onAction={confirmDelete}
        />
      </AppShell>
    </Theme>
  );
}
