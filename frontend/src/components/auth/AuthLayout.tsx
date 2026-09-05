"use client";

// Login-split layout for /login and /signup (spec §B + D5).
// Astryx chrome around <AuthView>: brand row on the left, a muted
// image panel on the right (D5: muted, not marketing copy), a single
// footer swap-link between login and signup, and no legal line (D4).
// The auth form itself is Neon's <AuthView>.
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

import { useEffect, type CSSProperties } from "react";
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

// D5: the COVER slot is muted (not a marketing illustration, no
// copy) but the surface must read as a real cover so the two-column
// layout is obvious. We use a low-contrast on-brand illustration
// (rounded square + chart line) — the same shape the Playground
// reference ships, retuned to the dark surface tokens so it
// disappears into the panel without going invisible.
const COVER_IMAGE_URL =
  "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20800%20600%22%20preserveAspectRatio%3D%22xMidYMid%20slice%22%3E%3Crect%20width%3D%22800%22%20height%3D%22600%22%20fill%3D%22%231b1b1b%22%2F%3E%3Cg%20transform%3D%22translate%28400%20300%29%22%20fill%3D%22none%22%20stroke%3D%22%233a3a3a%22%20stroke-width%3D%228%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Crect%20x%3D%22-90%22%20y%3D%22-90%22%20width%3D%22180%22%20height%3D%22180%22%20rx%3D%2232%22%2F%3E%3Ccircle%20cx%3D%2236%22%20cy%3D%22-36%22%20r%3D%225%22%20fill%3D%22%233a3a3a%22%20stroke%3D%22none%22%2F%3E%3Cpath%20d%3D%22M-68%2060%20L-16%200%20L20%2036%20L40%2016%20L68%2048%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E";

const pageStyle: CSSProperties = {
  minHeight: "100%",
  backgroundColor: "var(--color-background-body)",
};
const cardWrap: CSSProperties = {
  width: "100%",
  maxWidth: 1000,
  marginInline: "auto",
};
const coverImage: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
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
  min-height: 480px;
}
@container login-split (max-width: 511px) {
  .login-split-grid {
    padding: var(--spacing-4);
  }
  .login-split-image {
    order: -1;
    min-height: 160px;
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
  // wait one tick so the SDK has the session, then navigate.
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

  return (
    <Center axis="both" padding={6} style={pageStyle}>
      <style>{LOGIN_SPLIT_CSS}</style>
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
                          <AuthView
                            pathname={props.pathname}
                            // The SDK renders its own swap link at the
                            // bottom of the card ("Already have an
                            // account? Sign in"). We surface exactly
                            // one swap link (below the card) and hide
                            // the SDK's via the classNames slot — the
                            // SDK ignores cardFooter={null} but honors
                            // classNames.footer.
                            classNames={{ footer: "hidden" }}
                          />
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
                  <img style={coverImage} src={COVER_IMAGE_URL} alt="" />
                </Card>
              </div>
            </Grid>
          </Card>
        </div>
      </VStack>
    </Center>
  );
}
