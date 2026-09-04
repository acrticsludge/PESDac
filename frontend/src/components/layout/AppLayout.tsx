"use client";

import Pesdac from "../Pesdac";

export default function AppLayout({
  initialSubject,
  initialCode,
}: {
  initialSubject?: string;
  initialCode?: string;
} = {}) {
  return (
    <Pesdac initialSubject={initialSubject} initialCode={initialCode} />
  );
}
