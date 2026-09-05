"use client";

// Login-split layout for /login and /signup (spec §B + D5).
// Astryx chrome around <AuthView>: brand row on the left, a blank
// muted image panel on the right (COVER slot stays blank — D5), and
// a single footer swap-link between login and signup. No legal
// agreement line (D4). The auth form itself is Neon's <AuthView>.
//
// The page is a standalone island (never AppLayout), so this
// component wraps the whole surface in a Center that fills the
// viewport. The shell uses the same primitives the Playground
// reference uses: VStack/HStack, Grid, Center, Card, Section, Text,
// Icon, EmptyState.
//
// Container query: collapses to one column below 512px and reorders
// the image to the top with a 160px stacked strip. The min column
// width (240) plus the 2x inset (32) plus the 2x page padding (48)
// sums to 320 — the narrowest phone — so the form never clips.

import { useEffect, type CSSProperties, type ReactNode } from "react";
import { VStack, HStack, StackItem } from "@astryxdesign/core/Layout";
import { Grid } from "@astryxdesign/core/Grid";
import { Center } from "@astryxdesign/core/Center";
import { Card } from "@astryxdesign/core/Card";
import { Section } from "@astryxdesign/core/Section";
import { Text } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import { SparklesIcon } from "@heroicons/react/24/outline";
import { AuthView, NeonAuthUIProvider } from "@neondatabase/auth-ui";
import "@neondatabase/auth-ui/css";

import { authClient } from "../../lib/neon-auth";

const COLUMN_MIN_WIDTH = 240;

const pageStyle: CSSProperties = {
  minHeight: "100%",
  backgroundColor: "var(--color-background-body)",
};
const cardWrap: CSSProperties = {
  width: "100%",
  maxWidth: 1000,
  marginInline: "auto",
};
// D5: the COVER slot is intentionally blank. The right column gets a
// muted surface so the card still reads as a two-column layout on
// desktop, but no image, no illustration, no marketing copy.
const coverBlank: CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 160,
  backgroundColor: "var(--color-background-muted)",
};

const LOGIN_SPLIT_CSS = `
.login-split-grid {
  container-type: inline-size;
  container-name: login-split;
  padding: var(--spacing-8);
}
.login-split-image {
  width: 100%;
  order: 0;
}
@container login-split (max-width: 511px) {
  .login-split-grid {
    padding: var(--spacing-4);
  }
  .login-split-image {
    order: -1;
    max-height: 160px;
  }
}
`;

export type AuthLayoutProps = {
  /** Which Neon form to render: sign-in or sign-up. */
  pathname: "sign-in" | "sign-up";
  /** Card header line (e.g. "Welcome back" / "Create your account"). */
  title: string;
  /** Subhead below the title. */
  subtitle: string;
  /** Footer swap-link target + label. */
  swapHref: "/login" | "/signup";
  swapLabel: string;
};

export default function AuthLayout(props: AuthLayoutProps) {
  // F1.1 / spec §B: logged-in users bounce to /new on mount. We
  // wait one tick so the SDK has the session, then call navigate.
  // Using window.location to avoid importing astro:transitions
  // client-side (Astro's ClientRouter handles SPA navigation; a
  // full reload to /new is fine here because the gate there will
  // re-evaluate anyway).
  useEffect(() => {
    let cancelled = false;
    void authClient.getSession().then((res) => {
      if (cancelled) return;
      if (res?.data) window.location.assign("/new");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const card = (
    <VStack gap={4} width="100%">
      <div style={cardWrap}>
        <Card padding={0} width="100%">
          <Grid
            columns={{ minWidth: COLUMN_MIN_WIDTH, repeat: "fit" }}
            gap={8}
            align="stretch"
            className="login-split-grid"
          >
            <Section variant="transparent" padding={0} height="100%">
              <VStack gap={4} height="100%">
                <HStack gap={2} vAlign="center">
                  <Icon icon={SparklesIcon} />
                  <Text type="body" weight="bold">
                    PESDac
                  </Text>
                </HStack>

                <StackItem size="fill">
                  <Center axis="vertical" height="100%">
                    <VStack gap={4} hAlign="stretch" width="100%">
                      <VStack gap={1}>
                        <Text type="display-1" as="h2">
                          {props.title}
                        </Text>
                        <Text type="body" color="secondary" size="sm">
                          {props.subtitle}
                        </Text>
                      </VStack>

                      <NeonAuthUIProvider
                        authClient={authClient}
                        social={{ providers: ["google"] }}
                        redirectTo="/new"
                        defaultTheme="dark"
                      >
                        <AuthView pathname={props.pathname} />
                      </NeonAuthUIProvider>
                    </VStack>
                  </Center>
                </StackItem>

                <Text type="supporting" color="secondary">
                  {props.swapLabel}{" "}
                  <Link href={props.swapHref} type="supporting">
                    {props.swapHref === "/login" ? "Log in" : "Sign up"}
                  </Link>
                </Text>
              </VStack>
            </Section>

            <div className="login-split-image" aria-hidden="true">
              <Card
                variant="transparent"
                padding={0}
                width="100%"
                height="100%"
              >
                <div style={coverBlank} />
              </Card>
            </div>
          </Grid>
        </Card>
      </div>
    </VStack>
  );

  return (
    <Center axis="both" padding={6} style={pageStyle}>
      <style>{LOGIN_SPLIT_CSS}</style>
      {card}
    </Center>
  );
}

// Re-export so pages that need to override the bounce target don't
// have to know the props shape.
export type { ReactNode };
