"use client";

// Session gate (spec §A): required-purpose Dialog that opens for guests
// on app routes. Triple non-closable — purpose="required" swallows
// Esc/cancel, controlled-open ignores onOpenChange closes, and Pesdac's
// global Esc handler yields while the gate is open. The gate is UX, not
// a boundary: endpoints enforce ownership; this only routes guests to
// /login or /signup. No embedded form.

import { navigate } from "astro:transitions/client";
import { SparklesIcon } from "@heroicons/react/24/outline";

import { Dialog } from "@astryxdesign/core/Dialog";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import {
  HStack,
  Layout,
  LayoutContent,
  VStack,
} from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";

import { useEffect, useState } from "react";

import { useAuth } from "../../lib/auth";
import {
  isLogoutTransition,
  LOGOUT_TRANSITION_EVENT,
} from "../../lib/logout-guard";

// Standalone auth pages manage their own session state (logged-in loads
// bounce); the gate never renders there.
const AUTH_PATHS = new Set(["/login", "/signup"]);

export default function AuthGate() {
  const auth = useAuth();
  // Logout flight (logout/relogin fix): the session is transiently guest
  // on an app route while navigation to /login is already guaranteed.
  // Re-render on window edges so the gate stays shut for zero frames.
  // No copy/layout change — the dialog below is untouched.
  const [, setTransitionTick] = useState(0);
  useEffect(() => {
    const onTransition = () => setTransitionTick((v) => v + 1);
    window.addEventListener(LOGOUT_TRANSITION_EVENT, onTransition);
    return () =>
      window.removeEventListener(LOGOUT_TRANSITION_EVENT, onTransition);
  }, []);
  if (isLogoutTransition()) return null;
  // In-flight sessions render the shell as-is — no flash of gate while
  // the session is still resolving.
  if (auth.status !== "guest") return null;
  if (
    typeof window !== "undefined" &&
    AUTH_PATHS.has(window.location.pathname)
  ) {
    return null;
  }
  return (
    <Dialog
      isOpen
      onOpenChange={() => {}}
      purpose="required"
      aria-label="Log in to continue"
      // Compact prompt, not a settings surface: fixed narrow width,
      // shrink-to-viewport on small screens — no viewport overflow.
      width="min(440px, calc(100vw - 2rem))"
    >
      <Layout
        content={
          <LayoutContent>
            <VStack gap={4}>
              <HStack gap={2} vAlign="center">
                <Icon icon={SparklesIcon} />
                <Text type="body" weight="bold">
                  PESDac
                </Text>
              </HStack>
              <VStack gap={1}>
                <Heading level={2}>Log in to continue</Heading>
                <Text type="supporting" color="secondary">
                  Create a PESDac account to study with your course material. It takes a minute.
                </Text>
              </VStack>
              <VStack gap={2} hAlign="stretch">
                <Button
                  label="Create account"
                  variant="primary"
                  onClick={() => navigate("/signup")}
                />
                <Button
                  label="Log in"
                  variant="secondary"
                  onClick={() => navigate("/login")}
                />
              </VStack>
            </VStack>
          </LayoutContent>
        }
      />
    </Dialog>
  );
}
