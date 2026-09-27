"use client";

import { useEffect } from "react";
import Pesdac from "../Pesdac";
import AppErrorBoundary from "../AppErrorBoundary";

/**
 * Keyboard-vs-pointer modality for the composer focus ring (global.css
 * B40). `:focus-visible` matches a contenteditable on mouse click too
 * (text-input heuristic), so the ring can't be keyboard-only in CSS
 * alone. The ring decision is taken once at focus time (native
 * semantics): keydown always precedes Tab focus and pointerdown always
 * precedes click focus, so `focusin` records HOW this focus arrived on
 * the editable itself. Typing afterwards never re-triggers it — a
 * mouse-placed cursor stays ringless while typing, Tab keeps the
 * standard Astryx ring (e2e K13). Scoped here because both composers
 * (Pesdac + ThreadView) mount under this island.
 */
function useComposerRingModality(): void {
  useEffect(() => {
    let lastModality: "keyboard" | "pointer" = "pointer";
    const onKeyDown = () => {
      lastModality = "keyboard";
    };
    const onPointerDown = () => {
      lastModality = "pointer";
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.matches(
          '[contenteditable="true"][role="combobox"], [contenteditable="true"][role="textbox"]',
        )
      ) {
        if (lastModality === "keyboard") target.dataset.kbRing = "1";
        else delete target.dataset.kbRing;
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    window.addEventListener("focusin", onFocusIn, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      });
      window.removeEventListener("focusin", onFocusIn, { capture: true });
    };
  }, []);
}

export default function AppLayout({
  initialSubject,
  initialCode,
  initialView,
}: {
  initialSubject?: string;
  initialCode?: string;
  initialView?: "chat" | "profile";
} = {}) {
  useComposerRingModality();
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
