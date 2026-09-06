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

import { useAuth } from "../../lib/auth";

// Standalone auth pages manage their own session state (logged-in loads
// bounce); the gate never renders there.
const AUTH_PATHS = new Set(["/login", "/signup"]);

export default function AuthGate() {
  const auth = useAuth();
  // In-flight sessions render the shell as-is — no flash of gate while
  // the Neon session is still resolving.
  if (auth.status !== "guest") return null;
  if (
    typeof window !== "undefined" &&
    AUTH_PATHS.has(window.location.pathname)
  ) {
    return null;
  }
  // Social re-login with an email that already owns a password account
  // lands here as /new?error=account_not_linked (Neon refuses silent
  // auto-linking). A failed link round-trip lands as
  // /new?error=linking-failed. Name the actual fix instead of the
  // generic prompt.
  const urlError =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("error")
      : null;
  const linkError = urlError === "account_not_linked";
  const linkFailed = urlError === "linking-failed";
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
                <Heading level={2}>
                  {linkError || linkFailed
                    ? "Use your password to log in"
                    : "Log in to continue"}
                </Heading>
                <Text type="supporting" color="secondary">
                  {linkError
                    ? "This email is registered with a password, and Google isn't linked to it yet. Log in with your email and password instead."
                    : linkFailed
                      ? "Google linking didn't finish. Log in with your email and password, then retry from My Profile."
                      : "Create a PESDac account to study with your course material. It takes a minute."}
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
