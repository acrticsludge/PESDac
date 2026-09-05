"use client";

// Login-split layout for /login and /signup (spec §B + D5).
// Astryx chrome around <AuthView>: brand row on the left, a muted
// cover on the right (D5: muted, not marketing copy), a single
// footer swap-link between login and signup, and no legal line (D4).
// The auth form itself is Neon's <AuthView>.
//
// Structure mirrors the Playground login-split reference 1:1:
// Center > VStack > Card(padding:0) > Grid(columns:fit, gap:8) >
// [Section(form) | div.login-split-image > Card(transparent) > img]
//
// Container query reorders the cover to the top below 512px and
// tightens the padding at that point, keyed to the grid (not the
// window) so it never desyncs.

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

// D5: the COVER slot is a muted, photographic-feeling image. We
// ship a high-quality SVG illustration (rich vertical composition
// with overlapping shapes) at /public/template-assets/... so it
// reads as a real cover without depending on a network fetch. Drop
// a vertical photo at the same path later if/when one is sourced
// — the wrapper is already set up to object-fit:cover.
const COVER_IMAGE_URL = "/template-assets/light-working-vertical-1.svg";

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
  min-height: 520px;
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
  // F1.1 / spec §B: logged-in users bounce to /new on mount.
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
                            // Hide the SDK's swap link; ours lives below
                            // the card and is the only one.
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
