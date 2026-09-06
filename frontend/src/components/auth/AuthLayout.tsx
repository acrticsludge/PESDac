"use client";

// Login-split layout for /login and /signup (spec §B + D5).
//
// Skeleton mirrors the Playground login-split reference 1:1:
// Center > VStack(gap 4) > Card(padding 0, maxWidth 1000) >
// Grid(fit, minWidth 240, gap 8, stretch) >
//   [Section(transparent) > VStack(gap 4) > brand, StackItem(fill) >
//    Center(vertical) > form, swap link
//   | div.login-split-image > Card(transparent) > img(cover)]
//
// The form itself is Astryx primitives (TextInput / Button /
// Divider / Link / EmptyState), exactly like the reference — NOT
// the SDK's <AuthView>. AuthView is a shadcn-styled form; hosting
// it inside our Astryx card produced double chrome, double titles,
// foreign proportions, and validation errors firing on load. The
// Astryx controls below are wired to the Neon SDK directly:
// sign-in → authClient.signIn.email, sign-up →
// authClient.signUp.email, Google → authClient.signIn.social.
// Forgot-password calls authClient.forgetPassword and swaps the
// form to a confirmation EmptyState.
//
// D1: Google + email only (no Apple button). D4: no legal line.
// D5: muted cover (see COVER_IMAGE_URL).

import { useEffect, useState, type CSSProperties } from "react";
import { VStack, HStack, StackItem } from "@astryxdesign/core/Layout";
import { Grid } from "@astryxdesign/core/Grid";
import { Center } from "@astryxdesign/core/Center";
import { Card } from "@astryxdesign/core/Card";
import { Section } from "@astryxdesign/core/Section";
import { Text } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import { SparklesIcon } from "@heroicons/react/24/outline";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Button } from "@astryxdesign/core/Button";
import { Link } from "@astryxdesign/core/Link";
import { Divider } from "@astryxdesign/core/Divider";
import { Theme } from "@astryxdesign/core/theme";
import { PESDacMockupTheme } from "../../theme/PESDacMockupTheme";

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
// 100dvh (not 100%): the host chain (astro-island > body > html)
// has no height, so a percentage min-height collapses to auto and
// Center has no space to center in — the card sticks to the top.
// Viewport units are independent of the host.
const pageStyle: CSSProperties = {
  minHeight: "100dvh",
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

// Google "G" (same four-color mark the Neon SDK renders on its own
// Google button), inlined so the Astryx secondary button needs no
// external asset. 16×16 like the reference social buttons.
function GoogleMark() {
  return (
    <svg width={16} height={16} viewBox="0 0 256 262" aria-hidden="true">
      <path
        d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622 38.755 30.023 2.685.268c24.659-22.774 38.875-56.282 38.875-96.027"
        fill="#4285f4"
      />
      <path
        d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055-34.523 0-63.824-22.773-74.269-54.25l-1.531.13-40.298 31.187-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1"
        fill="#34a853"
      />
      <path
        d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82 0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602z"
        fill="#fbbc05"
      />
      <path
        d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0 79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251"
        fill="#eb4335"
      />
    </svg>
  );
}

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
  }
}
`;

export type AuthLayoutProps = {
  /** Sign-in or sign-up mode. Signup adds a Name field. */
  pathname: "sign-in" | "sign-up";
  /** Card header line (e.g. "Welcome back" / "Create your account"). */
  title: string;
  /** Subhead below the title. */
  subtitle: string;
  /** Footer swap-link target + label. */
  swapHref: "/login" | "/signup";
  swapLabel: string;
};

type FieldError = {
  field: "name" | "email" | "password";
  message: string;
};

export default function AuthLayout(props: AuthLayoutProps) {
  const isSignup = props.pathname === "sign-up";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<FieldError | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  // Signup can end in "verify your email" instead of a session —
  // the success card then says check-your-inbox and we do NOT
  // navigate. Forgot-password reuses the same success slot.
  const [success, setSuccess] = useState({
    title: "You're signed in",
    description: "Redirecting to your dashboard…",
  });

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

  function succeed(title: string, description: string, navigate: boolean) {
    setSuccess({ title, description });
    setIsSuccess(true);
    if (navigate) {
      window.setTimeout(() => {
        window.location.assign("/new");
      }, 800);
    }
  }

  async function handleSubmit() {
    if (isLoading || isSuccess) return;
    if (isSignup && !name.trim()) {
      setError({ field: "name", message: "Enter your name." });
      return;
    }
    if (!email.trim()) {
      setError({ field: "email", message: "Enter your email." });
      return;
    }
    if (!password) {
      setError({ field: "password", message: "Enter your password." });
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      if (isSignup) {
        const res = await authClient.signUp.email({
          email: email.trim(),
          password,
          name: name.trim(),
        });
        if (res?.error) {
          setError({
            field: "password",
            message:
              typeof res.error.message === "string" && res.error.message
                ? res.error.message
                : "Couldn't create your account. Try again.",
          });
          return;
        }
        // Some configs require email verification before a session
        // exists — check before deciding to navigate.
        const session = await authClient.getSession();
        if (session?.data) {
          succeed("You're signed in", "Redirecting to your dashboard…", true);
        } else {
          succeed(
            "Check your inbox",
            `We sent a verification link to ${email.trim()}.`,
            false,
          );
        }
      } else {
        const res = await authClient.signIn.email({
          email: email.trim(),
          password,
        });
        if (res?.error) {
          setError({
            field: "password",
            message:
              typeof res.error.message === "string" && res.error.message
                ? res.error.message
                : "Incorrect password. Try again.",
          });
          return;
        }
        succeed("You're signed in", "Redirecting to your dashboard…", true);
      }
    } catch {
      setError({
        field: "password",
        message: "Something went wrong. Try again.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleGoogle() {
    if (isLoading || isGoogleLoading || isSuccess) return;
    setIsGoogleLoading(true);
    setError(null);
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: "/new",
      });
    } catch {
      setError({
        field: "password",
        message: "Google sign-in failed. Try again.",
      });
      setIsGoogleLoading(false);
    }
    // On success the SDK redirects away, so no reset here.
  }

  async function handleForgot() {
    if (isLoading || isSuccess) return;
    if (!email.trim()) {
      setError({ field: "email", message: "Enter your email first." });
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: "/login",
      });
      if (res?.error) {
        setError({
          field: "password",
          message:
            typeof res.error.message === "string" && res.error.message
              ? res.error.message
              : "Couldn't send the reset email. Try again.",
        });
        return;
      }
      succeed(
        "Check your inbox",
        `We sent a reset link to ${email.trim()}.`,
        false,
      );
    } catch {
      setError({
        field: "password",
        message: "Couldn't send the reset email. Try again.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  // Every Astryx primitive reads its tokens from PESDacMockupTheme.
  // The app pages get it from Pesdac.tsx; these standalone auth
  // pages mount it here so the card renders themed, not unstyled.
  return (
    <Theme theme={PESDacMockupTheme} mode="dark">
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
                      {isSuccess ? (
                        <EmptyState
                          title={success.title}
                          description={success.description}
                          icon={<Icon icon={CheckCircleIcon} size="lg" />}
                        />
                      ) : (
                        <VStack gap={4} hAlign="stretch" width="100%">
                          <VStack gap={1}>
                            <Text type="display-1" as="h2">
                              {props.title}
                            </Text>
                            <Text type="body" color="secondary" size="sm">
                              {props.subtitle}
                            </Text>
                          </VStack>

                          <VStack gap={2}>
                            {isSignup && (
                              <TextInput
                                label="Name"
                                isLabelHidden
                                placeholder="Name"
                                value={name}
                                onChange={(v: string) => {
                                  setName(v);
                                  setError(null);
                                }}
                                size="lg"
                                status={
                                  error?.field === "name"
                                    ? { type: "error", message: error.message }
                                    : undefined
                                }
                              />
                            )}
                            <TextInput
                              label="Email"
                              isLabelHidden
                              type="email"
                              placeholder="name@company.com"
                              value={email}
                              onChange={(v: string) => {
                                setEmail(v);
                                setError(null);
                              }}
                              size="lg"
                              status={
                                error?.field === "email"
                                  ? { type: "error", message: error.message }
                                  : undefined
                              }
                            />
                            <VStack gap={1}>
                              <TextInput
                                label="Password"
                                isLabelHidden
                                placeholder="Enter your password"
                                type="password"
                                value={password}
                                onChange={(v: string) => {
                                  setPassword(v);
                                  setError(null);
                                }}
                                size="lg"
                                status={
                                  error?.field === "password"
                                    ? { type: "error", message: error.message }
                                    : undefined
                                }
                              />
                              {error != null && !isSignup && (
                                <VStack hAlign="end">
                                  <Link
                                    href="/login"
                                    size="sm"
                                    color="secondary"
                                    type="supporting"
                                    onClick={(e: React.MouseEvent) => {
                                      e.preventDefault();
                                      void handleForgot();
                                    }}
                                  >
                                    Forgot your password?
                                  </Link>
                                </VStack>
                              )}
                            </VStack>
                          </VStack>

                          <Button
                            label={isSignup ? "Create an account" : "Login"}
                            variant="primary"
                            size="lg"
                            isLoading={isLoading}
                            onClick={() => {
                              void handleSubmit();
                            }}
                          />

                          <Divider label="Or continue with" />

                          <Button
                            label="Google"
                            variant="secondary"
                            icon={<GoogleMark />}
                            size="lg"
                            isLoading={isGoogleLoading}
                            onClick={() => {
                              void handleGoogle();
                            }}
                          />
                        </VStack>
                      )}
                    </Center>
                  </StackItem>

                  {!isSuccess && (
                    <Text type="supporting" color="secondary">
                      {props.swapLabel}{" "}
                      <Link href={props.swapHref} type="supporting">
                        {props.swapHref === "/login" ? "Log in" : "Sign up"}
                      </Link>
                    </Text>
                  )}
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
    </Theme>
  );
}
