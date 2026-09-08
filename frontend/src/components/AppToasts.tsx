"use client";

// App-level toast host (error surfaces F1/F2). Rendered INSIDE the
// LayerProvider (see Pesdac/AuthLayout) so useToast() never hits the
// SSR-throwing fallback path — effects don't run on the server, and
// the provider is present for the render itself.
//
// Two jobs:
//   1. Publish the toast fn through toastRef so handlers defined
//      outside the provider subtree (e.g. Pesdac's logout) can toast.
//   2. Global safety net: any promise rejection nobody caught becomes
//      one error Toast (+ console.error for devtools) instead of
//      silence. Caught flows never reach this listener.

import { useEffect } from "react";
import { useToast, type ShowToastFn } from "@astryxdesign/core/Toast";

export type { ShowToastFn };

export default function AppToasts({
  toastRef,
}: {
  toastRef: { current: ShowToastFn | null };
}) {
  const toast = useToast();
  useEffect(() => {
    toastRef.current = toast;
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
    // Toast-above-modal ordering (link-password fix T3). The toast
    // viewport calls showPopover() once on mount; every later
    // dialog.showModal() (ProfileDialog, rename, alerts, onboarding)
    // enters the CSS top layer after it and paints above — including
    // the ::backdrop blur — so toasts read as blurry/dimmed.
    // Re-assert the viewport's top-layer recency whenever a modal
    // dialog opens. Synchronous hide+show re-inserts it at the top
    // with no paint in between (no flicker); Astryx/React toast state
    // is untouched, and later toasts inherit the corrected order.
    // No dialog styling, theme, CSS, or LayerProvider config changes.
    const repromote = () => {
      if (document.querySelector("dialog[open]") == null) return;
      const popovers = document.querySelectorAll('[popover="manual"]');
      popovers.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        // Menus opened from inside a dialog already outrank it via
        // recency — leave nested layers alone.
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
          // Not showing (or popovers unsupported): hide throws before
          // show runs, so a closed layer is never forced open here.
        }
      });
    };
    let scheduled = false;
    const schedule = () => {
      // Run after the mutation batch so showModal() has landed.
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        repromote();
      });
    };
    schedule(); // an already-open dialog at mount
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const target = m.target;
        // Toast renders inside the viewport mutate on every toast —
        // those never change dialog order, so ignore them.
        if (
          target instanceof HTMLElement &&
          target.hasAttribute("popover")
        ) {
          continue;
        }
        schedule();
        break;
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    return () => {
      observer.disconnect();
    };
  }, []);
  return null;
}
