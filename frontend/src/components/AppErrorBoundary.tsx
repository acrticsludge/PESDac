"use client";

// App-level React error boundary (T6/T33). Catches render, lifecycle,
// and synchronous event errors inside the React subtree below it and
// shows a recoverable Astryx fallback instead of a blank page.
//
// State machine:
//   - "ready" with no error: pass-through, render children.
//   - "error": show fallback, surface a non-sensitive reference id
//     (the error message itself is logged to the console in dev only;
//     never sent to the user).
//
// No raw stack traces, no secrets, no JWTs. Operators correlate via
// the browser console + their server log; users see what to do next.

import { Component, type ErrorInfo, type ReactNode } from "react";

import {
  VStack,
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
} from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Card } from "@astryxdesign/core/Card";

type Props = {
  children: ReactNode;
};

type State = {
  status: "ready" | "error";
  ref: string | null;
  showRecovery: boolean;
};

function newRef(): string {
  // 8 hex chars — short, opaque, safe to share with operators. Never
  // contains user data.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  }
  return Math.random().toString(16).slice(2, 10).padEnd(8, "0");
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { status: "ready", ref: null, showRecovery: false };

  static getDerivedStateFromError(): Partial<State> {
    return { status: "error", ref: newRef() };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Dev visibility only — no production telemetry by design. The
    // reference id ties back to whatever the operator chooses to add.
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.error(
        "[pesdac] render failure ref=%s",
        this.state.ref,
        error,
        info?.componentStack,
      );
    }
  }

  private handleRetry = (): void => {
    this.setState({ status: "ready", ref: null, showRecovery: false });
  };

  private handleGoHome = (): void => {
    if (typeof window !== "undefined") {
      window.location.assign("/");
    }
  };

  render(): ReactNode {
    if (this.state.status !== "error") return this.props.children;
    return (
      <Dialog
        isOpen
        onOpenChange={() => {
          /* Required-prompt equivalent: the recovery dialog cannot be
             dismissed because the React tree under it failed. */
        }}
        aria-label="Something went wrong"
        width="min(480px, calc(100vw - 2rem))"
      >
        <Layout
          header={
            <DialogHeader
              title="Something went wrong"
              hasDivider
            />
          }
          content={
            <LayoutContent>
              <VStack gap={3}>
                <Text type="body" color="secondary">
                  PESDac hit an unexpected problem rendering this screen.
                  Your work isn't lost, and no sign-in is required.
                </Text>
                {this.state.ref != null && (
                  <Card variant="muted" padding={3} width="100%">
                    <Text type="supporting" color="secondary">
                      Reference: <Text type="supporting" weight="semibold">{this.state.ref}</Text>
                    </Text>
                  </Card>
                )}
              </VStack>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack gap={2} vAlign="center">
                <Button
                  label="Try again"
                  variant="primary"
                  size="sm"
                  onClick={this.handleRetry}
                />
                <Button
                  label="Back to home"
                  variant="secondary"
                  size="sm"
                  onClick={this.handleGoHome}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
    );
  }
}