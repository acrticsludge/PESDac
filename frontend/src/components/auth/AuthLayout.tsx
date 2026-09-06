"use client";

// Login-split layout for /login and /signup (spec §B + D5).
//
// Skeleton mirrors the Playground login-split reference 1:1:
// Center > VStack(gap 4) > Card(padding 0, maxWidth 1000) >
// Grid(fit, minWidth 240, gap 8, stretch) >
//   [Section(transparent) > VStack(gap 4) > brand, StackItem(fill) >
//    Center(vertical) > VStack(gap 4, stretch) > title + form, swap link
//   | div.login-split-image > Card(transparent) > img(cover)]
//
// The form slot hosts Neon's <AuthView>. AuthView ships its own
// Tailwind card (bg-card, border, rounded-xl, shadow, max-w-sm) with
// its own header ("Sign Up" + description) — rendering that as-is
// inside our Astryx card produces double chrome and double titles,
// which is why the page looked out of place. So we:
//   1. Kill the SDK header via cardHeader={<></>} — our Astryx
//      display-1 title + subtitle are the only headers.
//   2. Neutralize the SDK card via classNames.base (max-w-none,
//      border-0, shadow-none, bg-transparent, rounded-none, p-0,
//      gap-4) so only its inner form (inputs, button, divider,
//      Google button) paints.
//   3. Tighten its content padding via classNames.content (px-0
//      gap-4) — the Grid already insets the form side.
//   4. Hide its swap-link footer via classNames.footer + a CSS
//      fallback (the project has no Tailwind, so the SDK's
//      `hidden` utility only works because auth-ui/css ships it;
//      the fallback makes it certain). Our Astryx swap link below
//      the form is the single one.
//   5. Map the SDK's shadcn tokens (--background, --primary, ...)
//      to our Astryx dark values scoped to .neon-auth-ui, so the
//      primary button reads light (#ebebeb on #171717, like the
//      reference Login button) and inputs/borders read dark.
//
// D1: Google + email only (no Apple button). D4: no legal line.
// D5: muted cover (see COVER_IMAGE_URL).

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

// Grid emits minmax(MIN, 1fr) where MIN is a hard floor, so MIN plus
// the grid inset and page padding must fit the narrowest phone or
// the column is clipped. 320 − 2×24 (page) − 2×16 (stacked inset)
// = 240.
const COLUMN_MIN_WIDTH = 240;
// repeat:'fit' (auto-fit) collapses the two columns to one —
// expanding to fill — below 2×MIN + 32(gap) = 512px. The container
// query reorders the image and tightens the inset at that same
// point, keyed to the card width (not the window) so it never
// desyncs.
// minHeight:100% fills the host so the centered card never leaves
// an unpainted band; Center's padding prop keeps it off the
// surface edges.
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

// Muted cover shipped locally (D5). Drop a vertical photo at the
// same path to swap without touching layout (object-fit:cover).
const COVER_IMAGE_URL = "/template-assets/light-working-vertical-1.svg";

// The container query lives in a plain <style> tag so it needs NO
// CSS compiler.
// - Pad the grid, not the Card: the form's Section escapes Card's
//   --container-padding-* vars, which would cancel the inset on the
//   form side. container-type makes the grid the query container
//   for the stack point.
// - repeat:'fit' (auto-fit) collapses the two columns to one below
//   511px; the query reorders the image (order:-1) and tightens the
//   inset at that point, keyed to the card width (not the window)
//   so it never desyncs.
// - .neon-auth-ui tokens map the SDK's shadcn variables to our
//   Astryx dark values (exact hexes from the theme). Scoped to the
//   auth form so nothing else is affected.
// - .neon-auth-ui footer fallback hides the SDK swap link even if
//   its `hidden` utility ever stops resolving.
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
.neon-auth-ui {
  --background: #1b1b1b;
  --foreground: #fafafa;
  --card: transparent;
  --card-foreground: #fafafa;
  --popover: #1b1b1b;
  --popover-foreground: #fafafa;
  --primary: #ebebeb;
  --primary-foreground: #171717;
  --secondary: #262626;
  --secondary-foreground: #fafafa;
  --muted: #262626;
  --muted-foreground: #a3a3a3;
  --accent: #262626;
  --accent-foreground: #fafafa;
  --destructive: #ff6f6c;
  --destructive-foreground: #171717;
  --border: #FFFFFF1A;
  --input: #525252;
  --ring: #ebebeb;
  --radius: 0.625rem;
  width: 100%;
}
.neon-auth-ui [data-slot="card-footer"] {
  display: none !important;
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
  // Spec §B: logged-in users bounce to /new on mount.
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
              {/* Form */}
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
                            // Our Astryx title above is the only
                            // header — suppress the SDK's own
                            // ("Sign Up" + description).
                            cardHeader={<></>}
                            // Neutralize the SDK card so only its
                            // inner form paints inside our Card.
                            className="max-w-none border-0 shadow-none bg-transparent rounded-none p-0 gap-4"
                            classNames={{
                              base: "max-w-none border-0 shadow-none bg-transparent rounded-none p-0 gap-4",
                              header: "p-0",
                              content: "px-0 gap-4",
                              footer: "hidden",
                            }}
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

              {/* Cover image — the transparent Card clips it to rounded
                  corners (overflow:clip + radius), so the image needs
                  no radius. */}
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
