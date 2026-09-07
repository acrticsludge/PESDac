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
// Link / EmptyState), exactly like the reference.
//
// Email + password (BetterAuth sign-in/sign-up) sits above the Google
// button. No email-based forgot-password: the server has no email sender
// configured, so password changes live in My Profile > Authentication
// instead.
//
// D1: Google + email (no Apple button). D4: no legal line.
// D5: muted cover (see COVER_IMAGE_URL).

import { useEffect, useState, type CSSProperties } from "react";
import { VStack, HStack, StackItem } from "@astryxdesign/core/Layout";
import { Grid } from "@astryxdesign/core/Grid";
import { Center } from "@astryxdesign/core/Center";
import { Card } from "@astryxdesign/core/Card";
import { Section } from "@astryxdesign/core/Section";
import { Text } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { SparklesIcon } from "@heroicons/react/24/outline";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Button } from "@astryxdesign/core/Button";
import { Link } from "@astryxdesign/core/Link";
import { Divider } from "@astryxdesign/core/Divider";
import { LayerProvider } from "@astryxdesign/core/Layer";
import { Theme } from "@astryxdesign/core/theme";
import { PESDacMockupTheme } from "../../theme/PESDacMockupTheme";
import { navigate } from "astro:transitions/client";
import {
  useAuth,
  signIn,
  signUp,
  signInWithGoogle,
  verifySignInTwoFactor,
  toUserMessage,
  MIN_PASSWORD_LENGTH,
} from "../../lib/auth";

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

// Google "G" brand logo — matches the Playground reference. Only Astryx primitives + inline SVG.
function GoogleLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="11" fill="#fff" />
      <path
        d="M21.8 12.22c0-.68-.06-1.35-.18-2h-8.82v3.8h5.04c-.22 1.2-.88 2.2-1.88 2.88v2.34h3.04c1.78-1.64 2.8-4.06 2.8-6.92z"
        fill="#4285F4"
      />
      <path
        d="M12.82 21.42c2.54 0 4.68-.84 6.24-2.28l-3.04-2.34c-.84.56-1.92.9-3.2.9-2.46 0-4.54-1.66-5.28-3.9H4.38v2.46c1.58 3.12 4.82 5.16 8.44 5.16z"
        fill="#34A853"
      />
      <path
        d="M7.54 13.8c-.38-.84-.6-1.78-.6-2.78s.22-1.94.6-2.78V5.78H4.38c-.9 1.82-1.42 3.86-1.42 6.22 0 2.36.52 4.4 1.42 6.22l3.16-2.46z"
        fill="#FBBC05"
      />
      <path
        d="M12.82 7.66c1.38 0 2.64.48 3.62 1.42l2.7-2.7C17.1 4.88 15.08 4 12.82 4c-3.62 0-6.86 2.04-8.44 5.16l3.16 2.46c.74-2.24 2.82-3.9 5.28-3.9z"
        fill="#EA4335"
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
  field: "name" | "email" | "password" | "code" | "form";
  message: string;
};

/**
 * Server failure → user-safe copy. Sign-in stays non-enumerating (the
 * server answers the same INVALID_EMAIL_OR_PASSWORD for unknown email
 * and wrong password, and the copy never distinguishes them). Sign-up
 * names the already-registered case because the server itself reveals
 * it — and "log in instead" is the fix.
 */
function toEmailAuthMessage(error: unknown, isSignup: boolean): string {
  let haystack = "";
  if (typeof error === "object" && error !== null) {
    const e = error as { code?: unknown; message?: unknown };
    haystack = `${String(e.code ?? "")} ${String(e.message ?? "")}`;
  }
  if (isSignup && (/EXISTS/.test(haystack) || /already/i.test(haystack))) {
    return "That email is already registered. Log in instead.";
  }
  return isSignup
    ? "Couldn't create your account. Try again."
    : "Couldn't sign in with those details. Check your email and password and try again.";
}

export default function AuthLayout(props: AuthLayoutProps) {
  const isSignup = props.pathname === "sign-up";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<FieldError | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Google is its own flag because redirecting-via-window.location races
  // the React paint; a shared isLoading would be cleared before the
  // user ever sees the spinner. BetterAuth's redirectPlugin moves the
  // page before paint can land — see handleGoogleSignIn comment.
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  // Second step when the account has 2FA on: email sign-in answers
  // twoFactorRedirect instead of a session, and this code finishes it.
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  const [totpCode, setTotpCode] = useState("");

  const auth = useAuth();

  // Logged-in users don't need this page.
  useEffect(() => {
    if (auth.status === "authenticated") navigate("/new");
  }, [auth.status]);

  // Field-level failures paint the field itself (Astryx renders the
  // message box from status.message); server failures have no single
  // field, so they render as plain copy under the form instead.
  function statusFor(field: FieldError["field"]) {
    return error?.field === field
      ? { type: "error" as const, message: error.message }
      : undefined;
  }

  // Google sign-in (T10). Promise ownership: we AWAIT the OAuth call so
  // any rejection (invalid_client, redirect mismatch, network failure,
  // popup blocked, cancelled by user) lands in our local try/catch and
  // surfaces a typed message — instead of escaping to the global
  // unhandled-rejection safety net as a generic toast. BetterAuth's
  // redirectPlugin usually navigates the browser before the promise
  // settles; the finally still runs so re-entry is safe, but the
  // loading flag also stays set via the redirect in flight.
  async function handleGoogleSignIn() {
    if (isGoogleLoading || isLoading) return;
    setIsGoogleLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
      // BetterAuth's redirectPlugin triggers window.location.href
      // navigation before this line; if we reach it, the call settled
      // without redirecting (rare — popup blocked, server misconfigured).
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : "";
      const haystack = `${raw}`.toLowerCase();
      let message = "Google sign-in failed. Try again.";
      if (
        haystack.includes("invalid_client") ||
        haystack.includes("client_id") ||
        haystack.includes("oauth_client")
      ) {
        message = "Google sign-in isn't set up. Contact support.";
      } else if (
        haystack.includes("redirect_uri") ||
        haystack.includes("redirect_mismatch")
      ) {
        message = "Google sign-in redirect was blocked. Try again.";
      } else if (
        haystack.includes("access_denied") ||
        haystack.includes("user_cancelled") ||
        haystack.includes("canceled") ||
        haystack.includes("cancelled")
      ) {
        message = "Google sign-in was cancelled. Try again when you're ready.";
      } else if (
        haystack.includes("state") ||
        haystack.includes("invalid_request") ||
        haystack.includes("expired")
      ) {
        message = "Google sign-in link expired. Try again.";
      } else if (
        haystack.includes("network") ||
        haystack.includes("failed to fetch") ||
        haystack.includes("timeout")
      ) {
        message = "Couldn't reach Google. Check your connection and try again.";
      }
      setError({ field: "form", message });
    } finally {
      setIsGoogleLoading(false);
    }
  }

  async function handleEmailAuth() {
    if (isLoading) return;
    const cleanEmail = email.trim();
    if (isSignup && !name.trim()) {
      setError({ field: "name", message: "Enter your name." });
      return;
    }
    if (!/.+@.+\..+/.test(cleanEmail)) {
      setError({ field: "email", message: "Enter a valid email address." });
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError({
        field: "password",
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = isSignup
        ? await signUp(cleanEmail, password, name.trim())
        : await signIn(cleanEmail, password);
      if (res.error) {
        setError({ field: "form", message: toEmailAuthMessage(res.error, isSignup) });
        return;
      }
      if (
        res.data != null &&
        typeof res.data === "object" &&
        (res.data as { twoFactorRedirect?: unknown }).twoFactorRedirect === true
      ) {
        setTotpCode("");
        setNeedsTwoFactor(true);
        return;
      }
      navigate("/new");
    } catch (e: unknown) {
      setError({
        field: "form",
        message: toUserMessage(e, "Something went wrong. Try again."),
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVerifySecondFactor() {
    if (isLoading) return;
    if (totpCode.trim().length < 6) {
      setError({
        field: "code",
        message: "Enter the 6-digit code from your authenticator app.",
      });
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await verifySignInTwoFactor(totpCode);
      navigate("/new");
    } catch (e: unknown) {
      setError({
        field: "code",
        message: toUserMessage(e, "That code didn't work. Try again."),
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
    <LayerProvider toast={{ position: "topEnd", maxVisible: 3 }}>
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

                          {needsTwoFactor ? (
                            <VStack gap={2}>
                              <Text type="body" color="secondary" size="sm">
                                This account uses two-factor authentication.
                                Enter the 6-digit code from your authenticator
                                app.
                              </Text>
                              <TextInput
                                label="Authenticator code"
                                placeholder="6-digit code"
                                value={totpCode}
                                onChange={setTotpCode}
                                status={statusFor("code")}
                                onEnter={() => {
                                  void handleVerifySecondFactor();
                                }}
                              />
                              {error?.field === "form" && (
                                <Text type="supporting">{error.message}</Text>
                              )}
                              <Button
                                label="Verify and log in"
                                variant="primary"
                                size="lg"
                                isLoading={isLoading}
                                isDisabled={isLoading}
                                clickAction={() => {
                                  void handleVerifySecondFactor();
                                }}
                              />
                              <Button
                                label="Back"
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  setNeedsTwoFactor(false);
                                  setError(null);
                                }}
                              />
                            </VStack>
                          ) : (
                            <VStack gap={2}>
                              {isSignup && (
                              <TextInput
                                label="Name"
                                isLabelHidden
                                placeholder="Your name"
                                value={name}
                                onChange={setName}
                                status={statusFor("name")}
                                size="lg"
                              />
                              )}
                              <TextInput
                                label="Email"
                                isLabelHidden
                                type="email"
                                placeholder="name@college.com"
                                value={email}
                                onChange={setEmail}
                                status={statusFor("email")}
                                size="lg"
                              />
                              <TextInput
                                label="Password"
                                isLabelHidden
                                type="password"
                                placeholder={
                                  isSignup ? "Choose your password" : "Enter your password"
                                }
                                description={
                                  isSignup
                                    ? `At least ${MIN_PASSWORD_LENGTH} characters`
                                    : undefined
                                }
                                value={password}
                                onChange={setPassword}
                                status={statusFor("password")}
                                onEnter={() => {
                                  void handleEmailAuth();
                                }}
                                size="lg"
                              />
                              {error?.field === "form" && (
                                <Text type="supporting">{error.message}</Text>
                              )}
                              <Button
                                label={
                                  isLoading
                                    ? isSignup
                                      ? "Creating account…"
                                      : "Signing in…"
                                    : isSignup
                                      ? "Create account"
                                      : "Log in"
                                }
                                variant="primary"
                                size="lg"
                                isLoading={isLoading}
                                isDisabled={isLoading || isGoogleLoading}
                                clickAction={() => {
                                  void handleEmailAuth();
                                }}
                              />
                              <Divider label="Or continue with" />
                              <Button
                                label="Google"
                                variant="secondary"
                                size="lg"
                                isLoading={isGoogleLoading}
                                isDisabled={isLoading || isGoogleLoading}
                                icon={<GoogleLogo />}
                                clickAction={() => {
                                  void handleGoogleSignIn();
                                }}
                              />
                              {isGoogleLoading && (
                                <Text type="supporting" color="secondary">
                                  Redirecting to Google…
                                </Text>
                              )}
                            </VStack>
                          )}
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
    </LayerProvider>
    </Theme>
  );
}
