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
      toast({ body: "Something went wrong. Try again.", type: "error" });
    };
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandled);
      toastRef.current = null;
    };
  }, [toast, toastRef]);
  return null;
}
