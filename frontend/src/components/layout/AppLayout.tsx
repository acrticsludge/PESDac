"use client";

import Pesdac from "../Pesdac";
import AppErrorBoundary from "../AppErrorBoundary";

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
    <AppErrorBoundary>
      <Pesdac
        initialSubject={initialSubject}
        initialCode={initialCode}
        initialView={initialView}
      />
    </AppErrorBoundary>
  );
}
