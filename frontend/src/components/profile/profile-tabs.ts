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

// Deep-linkable tabs. This helper is intentionally isolated from the heavy
// profile sections module so the chat shell does not load every settings
// panel before the user opens Profile.
export function tabFromHash(): ProfileTab {
  if (typeof window === "undefined") return "profile";
  const hash = window.location.hash.replace(/^#/, "");
  return TABS.some((tab) => tab.value === hash)
    ? (hash as ProfileTab)
    : "profile";
}
