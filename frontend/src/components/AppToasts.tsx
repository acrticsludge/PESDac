"use client";

// App-level toast host (error surfaces F1/F2). Rendered INSIDE the
// LayerProvider (see Pesdac/AuthLayout) so useToast() never hits the
// SSR-throwing fallback path — effects don't run on the server, and
// the provider is present for the render itself.
//
// Two jobs:
//   1. Publish the toast fn through toastRef so handlers defined
//      outside the provider subtree (e.g. Pesdac's logout) can toast.
//      The published fn is wrapped: after dispatching it schedules a
//      top-layer re-assert (next frame, after React commits the toast
//      DOM), so a toast enqueued over an already-open dialog still
//      paints above it. No-op when no dialog is open.
//   2. Global safety net: any promise rejection nobody caught becomes
//      one error Toast (+ console.error for devtools) instead of
//      silence. Caught flows never reach this listener.

import { useEffect } from "react";
import { useToast, type ShowToastFn } from "@astryxdesign/core/Toast";

export type { ShowToastFn };

// ---- Toast-above-modal ordering (link-password fix, hardened) --------------
//
// The toast viewport enters the CSS top layer once on mount (showPopover),
// but every later dialog.showModal() paints above it — including the
// ::backdrop blur — so toasts under an open modal render dimmed and their
// dismiss X is unclickable. Paint order in the top layer is recency order,
// so re-showing the viewport after any layer change puts it back on top.
// Synchronous hide+show re-inserts it with no paint in between (no
// flicker); toast state is untouched. No dialog styling, theme, CSS, or
// LayerProvider config changes.
//
// Triggers (all funnel into one deduped frame callback):
//   - dialog open/close flips the `open` attribute (showModal/close),
//   - node insertions cover dialog mounts and toast renders from ANY caller
//     (toastRef bridge or direct useToast) — the toast DOM lands after
//     dispatch, so the scheduled frame re-asserts recency after it,
//   - the `toggle` event fires on every top-layer transition (dialog AND
//     popover show/hide) with zero DOM footprint — the observer cannot see
//     programmatic showPopover() calls. It doesn't bubble, so capture.
// The observer roots at documentElement, not body: Astro view transitions
// swap the body element, which would silently detach a body-rooted observer
// while the persisted island (and this effect) lives on.
let repromoteScheduled = false;

function repromoteToastLayer(): void {
  if (document.querySelector("dialog[open]") == null) return;
  const popovers = document.querySelectorAll('[popover="manual"]');
  popovers.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    // Menus opened from inside a dialog already outrank it via recency —
    // leave nested layers alone.
    if (node.closest("dialog") != null) return;
    const popover = node as HTMLElement & {
      showPopover?: () => void;
      hidePopover?: () => void;
    };
    if (
      typeof popover.hidePopover !== "function" ||
      typeof popover.showPopover !== "function"
    ) {
      return;
    }
    try {
      popover.hidePopover();
      popover.showPopover();
    } catch {
      // Not showing (or popovers unsupported): hide throws before show
      // runs, so a closed layer is never forced open here.
    }
  });
}

function scheduleToastRepromote(): void {
  if (repromoteScheduled) return;
  repromoteScheduled = true;
  const run = () => {
    repromoteScheduled = false;
    repromoteToastLayer();
  };
  // rAF runs after React commits the toast/dialog DOM but before paint, so
  // the re-asserted order is what the user first sees.
  if (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function"
  ) {
    window.requestAnimationFrame(run);
  } else {
    queueMicrotask(run);
  }
}

export default function AppToasts({
  toastRef,
}: {
  toastRef: { current: ShowToastFn | null };
}) {
  const toast = useToast();
  useEffect(() => {
    const showToast: ShowToastFn = (options) => {
      const dismiss = toast(options);
      scheduleToastRepromote();
      return dismiss;
    };
    toastRef.current = showToast;
    const onUnhandled = (event: PromiseRejectionEvent) => {
      console.error("Unhandled rejection:", event.reason);
      toast({
        body: "Something went wrong. Try again — if it keeps happening, reload the page.",
        type: "error",
      });
    };
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandled);
      toastRef.current = null;
    };
  }, [toast, toastRef]);
  useEffect(() => {
    // An already-open dialog at mount (persisted shell, restored session).
    scheduleToastRepromote();
    const onMutation = (mutations: MutationRecord[]) => {
      for (const m of mutations) {
        if (m.type === "attributes") {
          scheduleToastRepromote();
          break;
        }
        if (
          m.type === "childList" &&
          (m.addedNodes.length > 0 || m.removedNodes.length > 0)
        ) {
          scheduleToastRepromote();
          break;
        }
      }
    };
    const observer = new MutationObserver(onMutation);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    const onToggle = (e: Event) => {
      // Own re-shows and menus carry a popover attribute: ignore them, or
      // the re-show would reschedule itself forever.
      const t = e.target;
      if (t instanceof HTMLElement && t.hasAttribute("popover")) return;
      scheduleToastRepromote();
    };
    document.addEventListener("toggle", onToggle, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("toggle", onToggle, true);
    };
  }, []);
  return null;
}
