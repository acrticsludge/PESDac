"use client";

// Standalone Settings dialog (spec llm-byok-settings §5.1): the
// OpenRouter BYOK connection. Same shell idiom as ProfileDialog
// (Dialog + Layout + DialogHeader). Providers render as one Card per
// provider with a status dot (success = connected, neutral = not);
// clicking a card expands the key form inline (Card > Collapsible is
// the documented Astryx pattern). Form controls reuse the profile
// password-form idioms — no new visual language.

import { useEffect, useState, type ReactNode } from "react";

import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { HStack, Layout, LayoutContent, VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Button } from "@astryxdesign/core/Button";
import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { useToast } from "@astryxdesign/core/Toast";

import {
  apiLlmDelete,
  apiLlmSave,
  LLM_DEFAULT_MODEL,
  maskKeyHint,
  OPENROUTER_KEYS_URL,
  useLlmStatus,
} from "../../lib/llm";
import { toUserMessage } from "../../lib/auth";
import OpenRouterLogo from "./OpenRouterLogo";

export default function SettingsDialog({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const { state, status } = useLlmStatus();
  const configured = state === "ready" && status?.configured === true;

  const [apiKey, setApiKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [cardOpen, setCardOpen] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // Fresh open resets the form and collapses the card; the header
  // buttons (Connect / Edit / Disconnect) own expansion from there.
  // Runs on `configured` too (not just open): the hook resolves
  // async *after* open, and without this a known key would show the
  // form. Safe while typing — `configured` only flips on
  // save/delete, which already reset the fields themselves.
  useEffect(() => {
    if (!isOpen) return;
    setApiKey("");
    setEditing(!configured);
    setCardOpen(false);
    setKeyError(null);
    setConfirmingRemove(false);
  }, [isOpen, configured]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    const key = apiKey.trim();
    if (!key || isSaving) {
      if (!key) setKeyError("Paste your OpenRouter key first.");
      return;
    }
    setIsSaving(true);
    setKeyError(null);
    try {
      // Model pick lives in the future chat-composer dropdown — the
      // server default rides along until then.
      await apiLlmSave(key, LLM_DEFAULT_MODEL);
      setApiKey("");
      setEditing(false);
      setCardOpen(false);
      toast({ body: "OpenRouter key connected.", type: "info" });
    } catch (error) {
      setKeyError(toUserMessage(error, "Couldn't save the key. Try again."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemove() {
    if (isRemoving) return;
    setIsRemoving(true);
    try {
      await apiLlmDelete();
      setConfirmingRemove(false);
      setEditing(true);
      toast({ body: "OpenRouter key removed.", type: "info" });
    } catch (error) {
      toast({
        body: toUserMessage(error, "Couldn't remove the key. Try again."),
        type: "error",
      });
    } finally {
      setIsRemoving(false);
    }
  }

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      width="min(640px, calc(100vw - 2rem))"
      maxHeight="80dvh"
    >
      <Layout
        header={
          <DialogHeader
            title="Settings"
            hasDivider
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent>
            <VStack gap={4}>
              <VStack gap={0.5}>
                <Heading level={2}>Model connection</Heading>
                <Text type="supporting" color="secondary">
                  PESDac chats with your own OpenRouter key.
                </Text>
              </VStack>
              <Badge
                variant={state === "invalid" ? "error" : undefined}
                // Solid green pill for Connected (the `success` tint is
                // near-invisible on dark) — theme token, white text.
                style={
                  configured
                    ? {
                        backgroundColor: "var(--color-border-green)",
                        color: "#ffffff",
                      }
                    : undefined
                }
                label={
                  state === "unknown"
                    ? "Checking…"
                    : configured
                      ? "Connected"
                      : state === "invalid"
                        ? "Needs attention"
                        : "Not connected"
                }
              />
              <VStack gap={1.5}>
                <Text type="supporting" weight="semibold" color="secondary">
                  Providers
                </Text>
                <Card
                  variant="muted"
                  padding={4}
                  width="100%"
                  // Border-only signal (no tint): theme token, scoped to
                  // this card — no global CSS, no theme edits.
                  style={
                    configured
                      ? { border: "1px solid var(--color-border-green)" }
                      : undefined
                  }
                >
                  <VStack gap={3}>
                    <HStack gap={3} vAlign="center" width="100%">
                      <OpenRouterLogo size={30} />
                      {configured && (
                        <StatusDot
                          variant="success"
                          label="OpenRouter connected"
                        />
                      )}
                      <VStack gap={0.5} style={{ flex: 1, minWidth: 0 }}>
                        <Text type="label">OpenRouter</Text>
                        <Text type="supporting" color="secondary">
                          {configured
                            ? `Connected and Selected · ${maskKeyHint(status?.keyHint ?? null)}`
                            : "Not connected — connect to start chatting."}
                        </Text>
                      </VStack>
                      {!configured ? (
                        <Button
                          label="Connect"
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            setCardOpen(true);
                            setEditing(false);
                            setApiKey("");
                            setKeyError(null);
                          }}
                        />
                      ) : (
                        <HStackGap>
                          <Button
                            label="Edit"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setCardOpen(true);
                              setEditing(true);
                              setApiKey("");
                              setKeyError(null);
                            }}
                          />
                          <Button
                            label="Disconnect"
                            variant="secondary"
                            size="sm"
                            onClick={() => setConfirmingRemove(true)}
                          />
                        </HStackGap>
                      )}
                    </HStack>
                    {cardOpen && (
                      configured && !editing ? (
                        <Text type="supporting" color="secondary">
                          To change the key, press Edit above — or Disconnect
                          to remove it. Model selection is coming to the chat
                          composer.
                        </Text>
                      ) : (
                        <VStack gap={3}>
                          <TextInput
                            label="API key"
                            type="password"
                            placeholder="sk-or-v1-…"
                            value={apiKey}
                            onChange={(value) => {
                              setApiKey(value);
                              if (keyError) setKeyError(null);
                            }}
                            status={
                              keyError != null
                                ? { type: "error", message: keyError }
                                : undefined
                            }
                            onEnter={() => void handleSave()}
                          />
                          <HStackGap>
                            <Button
                              label="Save key"
                              variant="primary"
                              size="sm"
                              isLoading={isSaving}
                              isDisabled={isSaving}
                              onClick={() => void handleSave()}
                            />
                            <Button
                              label="Get an OpenRouter key"
                              variant="secondary"
                              size="sm"
                              isDisabled={isSaving}
                              onClick={() => {
                                window.open(OPENROUTER_KEYS_URL, "_blank", "noopener");
                              }}
                            />
                            {configured && (
                              <Button
                                label="Cancel"
                                variant="secondary"
                                size="sm"
                                isDisabled={isSaving}
                                onClick={() => {
                                  setEditing(false);
                                  setCardOpen(false);
                                  setApiKey("");
                                  setKeyError(null);
                                }}
                              />
                            )}
                          </HStackGap>
                        </VStack>
                      )
                    )}
                  </VStack>
                </Card>
              </VStack>
              <Card variant="muted" padding={3} width="100%">
                <Text type="supporting" color="secondary">
                  Stored encrypted on our server. We never show it again —
                  to rotate, save a new key.
                </Text>
              </Card>
              <AlertDialog
                isOpen={confirmingRemove}
                onOpenChange={(open) => {
                  if (!open) setConfirmingRemove(false);
                }}
                title="Remove the OpenRouter key?"
                description="Chats will stop working until you connect a new key. This cannot be undone."
                actionLabel="Remove"
                isActionLoading={isRemoving}
                onAction={() => void handleRemove()}
              />
            </VStack>
          </LayoutContent>
        }
      />
    </Dialog>
  );
}

function HStackGap({ children }: { children: ReactNode }) {
  return (
    <HStack gap={2}>
      {children}
    </HStack>
  );
}
