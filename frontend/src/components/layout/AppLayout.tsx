"use client";

import Pesdac from "../Pesdac";

export default function AppLayout({
  initialSubject,
  initialCode,
  initialView,
}: {
  initialSubject?: string;
  initialCode?: string;
  initialView?: "chat" | "profile";
} = {}) {
  return (
    <Pesdac
      initialSubject={initialSubject}
      initialCode={initialCode}
      initialView={initialView}
    />
  );
}
