"use client";

// Onboarding wizard (spec §F, plan item 21): required-purpose Dialog
// over /new that opens when GET /auth/me reports onboardingDone false
// (signup AND returning logins until completed — survives reload, no
// URL param). Single screen: Campus SegmentedControl + Semester/Branch
// Selectors + Subjects CheckboxList with Select-all. Save PATCHes
// /profiles/me with onboardingDone:true and mirrors the picks into the
// local session store (reads are local-only; fetch-without-seed would
// leave every consumer blank). Failure keeps the dialog open and
// surfaces the message inline under the form.
// Triple lock: purpose="required" + controlled-open ignores
// closes + Pesdac Esc yields while active (via onActiveChange).

import { useEffect, useState } from "react";

import { Dialog } from "@astryxdesign/core/Dialog";
import { Button } from "@astryxdesign/core/Button";
import { Banner } from "@astryxdesign/core/Banner";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Layout, LayoutContent, VStack } from "@astryxdesign/core/Layout";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import {
  CheckboxList,
  CheckboxListItem,
} from "@astryxdesign/core/CheckboxList";

import {
  useAuth,
  apiGetMe,
  apiGetProfile,
  apiUpdateProfile,
  onboardingRetryDecision,
  refreshProfile,
  toUserMessage,
} from "../../lib/auth";
import {
  apiLlmSave,
  apiLlmStatus,
  LLM_DEFAULT_MODEL,
  maskKeyHint,
  OPENROUTER_KEYS_URL,
} from "../../lib/llm";
import {
  isLogoutTransition,
  isTransitionNoise,
} from "../../lib/logout-guard";
import { seedOnboardingFields as updateLocalProfile } from "../../lib/session";
import {
  BRANCHES,
  CAMPUSES,
  SEMESTERS,
  SUBJECTS,
  isCampus,
  isSubject,
  validateBranch,
  validateCampus,
  validateSemester,
  validateSubjects,
} from "../../lib/profile-options";

// F6: "Select all" is a UI affordance, never a stored value — it is
// stripped before save and derived for display.
const SELECT_ALL = "__all";
const ALL_SUBJECTS = SUBJECTS.map((s) => s.value);
// SegmentedControl takes exactly the 2 campuses (no blank placeholder).
const CAMPUS_CHOICES = CAMPUSES.filter((c) => c.value !== "");

export default function OnboardingDialog({
  onActiveChange,
}: {
  /** Reports whether the wizard is currently open (Pesdac yields Esc). */
  onActiveChange?: (active: boolean) => void;
}) {
  const auth = useAuth();
  const [phase, setPhase] = useState<"checking" | "open" | "done" | "error">(
    "checking",
  );
  const [campus, setCampus] = useState("");
  const [semester, setSemester] = useState("");
  const [branch, setBranch] = useState("");
  const [subjects, setSubjects] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Optional BYOK slot (spec llm-byok-settings §5.2): never blocks save.
  // Empty + save asks once via the warning banner, then proceeds keyless.
  const [llmKey, setLlmKey] = useState("");
  const [llmSaving, setLlmSaving] = useState(false);
  const [llmFailure, setLlmFailure] = useState<string | null>(null);
  const [llmHint, setLlmHint] = useState<string | null>(null);
  const [showKeyWarn, setShowKeyWarn] = useState(false);
  // Set only via the banner's explicit action: proceed keyless even
  // though a (bad) key is still typed — e.g. after a rejected save.
  const [keylessConfirmed, setKeylessConfirmed] = useState(false);

  // Mounts only once the server confirms onboarding is needed:
  // checking/done render nothing, so refreshes never flash a loader.
  // The open Dialog already dims + blurs the window behind it.
  const open = phase === "open" || phase === "error";
  useEffect(() => {
    onActiveChange?.(open);
  }, [open, onActiveChange]);
  // Unmount (route change) must not leave Pesdac yielding Esc forever.
  useEffect(() => {
    return () => {
      onActiveChange?.(false);
    };
  }, [onActiveChange]);

  // Resolve once per session: needs onboarding? Prefill from the server
  // row so returning users see their saved picks, not a blank form.
  // A failed check used to resolve to `done` and leave the user
  // permanently un-onboarded with no signal (audit G4) — it now opens
  // an error state with a retry instead.
  const [attempt, setAttempt] = useState(0);
  // Stable identity key: a cross-tab user switch (BetterAuth
  // revalidates and the auth hook returns the new user) re-runs the
  // effect so the wizard pre-fills the new row, not the old one.
  const authUserId = auth.status === "authenticated" ? auth.user.id : "";
  useEffect(() => {
    if (auth.status !== "authenticated") return;
    let cancelled = false;
    const userId = auth.user.id;
    (async () => {
      // Bounded silent retry (auth-loading-flash fix, S2): transient
      // failures (cold backend) retry per onboardingRetryDecision while
      // `checking` keeps rendering null — no dialog swap mid-retry. The
      // loop restarts whenever this effect re-runs (identity change via
      // authUserId, manual retry via attempt), so attempts never leak
      // across identities. Exhaustion falls into the error path below,
      // unchanged.
      let attemptsUsed = 0;
      for (;;) {
        try {
          const [me, profile] = await Promise.all([
            apiGetMe(userId),
            apiGetProfile(userId),
          ]);
          if (cancelled) return;
          if (me.onboardingDone) {
            setPhase("done");
            return;
          }
          setCampus(isCampus(profile.campus) ? profile.campus : "");
          setSemester(
            typeof profile.semester === "string" ? profile.semester : "",
          );
          setBranch(typeof profile.branch === "string" ? profile.branch : "");
          setSubjects(
            Array.isArray(profile.subjects)
              ? profile.subjects.filter(isSubject)
              : [],
          );
          // BYOK prefill (best-effort, never blocks): a returning user
          // with a key sees the hint row instead of the input. Failure
          // resolves to "no key" — the slot simply shows empty.
          try {
            const llm = await apiLlmStatus(userId);
            if (cancelled) return;
            if (llm.configured) setLlmHint(llm.keyHint);
          } catch {
            if (cancelled) return;
          }
          setPhase("open");
          return;
        } catch (error) {
          if (cancelled) return;
          attemptsUsed += 1;
          // Logout flight (logout/relogin fix): the epoch-killed check
          // rejects here while navigation to /login is already
          // guaranteed — stay silent instead of opening the error dialog
          // over the transition. identity-changed is never a genuine
          // failure (stale resolve after a user switch), so it stays
          // silent outside the window too. Runs on EVERY attempt's
          // failure, including silent retries, not just the first.
          if (isLogoutTransition() || isTransitionNoise(error)) {
            setPhase("done");
            return;
          }
          const decision = onboardingRetryDecision(error, attemptsUsed);
          if (decision.retry) {
            await new Promise((resolve) =>
              setTimeout(resolve, decision.delayMs),
            );
            if (cancelled) return;
            continue;
          }
          setFailure(
            toUserMessage(error, "Couldn't load your profile. Try again."),
          );
          setPhase("error");
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.status, authUserId, attempt]);

  if (auth.status !== "authenticated" || phase === "done" || phase === "checking") return null;

  if (phase === "error") {
    return (
      <Dialog
        isOpen
        onOpenChange={() => {}}
        purpose="required"
        aria-label="Couldn't load your profile"
        width="min(440px, calc(100vw - 2rem))"
      >
        <Layout
          content={
            <LayoutContent>
              <VStack gap={4}>
                <VStack gap={1}>
                  <Heading level={2}>Couldn't load your profile</Heading>
                  <Text type="supporting" color="secondary">
                    We couldn't reach the server to check your setup. Nothing
                    was lost — try again.
                  </Text>
                </VStack>
                {failure != null && <Text type="supporting">{failure}</Text>}
                <VStack hAlign="stretch">
                  <Button
                    label="Try again"
                    variant="primary"
                    onClick={() => {
                      setFailure(null);
                      setPhase("checking");
                      setAttempt((a) => a + 1);
                    }}
                  />
                </VStack>
              </VStack>
            </LayoutContent>
          }
        />
      </Dialog>
    );
  }

  // validateCampus allows blank (PATCH accepts it); the wizard
  // requires an actual pick, hence the separate campus !== "".
  const canSave =
    !isSaving &&
    validateCampus(campus) === null &&
    campus !== "" &&
    validateSemester(semester) === null &&
    validateBranch(branch) === null &&
    validateSubjects(subjects) === null;

  async function handleSave() {
    if (!canSave || isSaving || llmSaving) return;
    // Skippable key slot: a keyless save first raises the warning
    // banner — the next save confirms the skip and proceeds.
    if (llmHint == null && !keylessConfirmed && llmKey.trim() === "" && !showKeyWarn) {
      setShowKeyWarn(true);
      return;
    }
    setIsSaving(true);
    setFailure(null);
    try {
      await apiUpdateProfile({
        campus,
        semester,
        branch,
        subjects,
        onboardingDone: true,
      });
      // Mirror into the local store: every consumer (profile tab,
      // welcome, responder scoping) reads local-only. The server is
      // source of truth; this is the explicit seed the spec requires.
      updateLocalProfile({
        campus,
        semester,
        branch,
        subjects,
      });
      // Best-effort key save: failure stays visible inline (dialog
      // stays open) — Settings remains the authoritative surface and
      // the banner offers the explicit keyless path.
      if (llmHint == null && !keylessConfirmed && llmKey.trim() !== "") {
        setLlmSaving(true);
        setLlmFailure(null);
        try {
          const saved = await apiLlmSave(llmKey.trim(), LLM_DEFAULT_MODEL);
          if (saved.configured) setLlmHint(saved.keyHint);
        } catch (error) {
          setLlmFailure(
            toUserMessage(error, "Couldn't save the key. You can add it later in Settings."),
          );
          setShowKeyWarn(true);
          return;
        } finally {
          setLlmSaving(false);
        }
      }
      // The cached /auth/me still says onboardingDone:false — drop it so
      // the next reader sees the saved state instead of a stale flag.
      refreshProfile();
      setPhase("done");
    } catch (error) {
      setFailure(toUserMessage(error, "Couldn't save. Try again."));
    } finally {
      setIsSaving(false);
    }
  }

  function handleContinueWithoutKey() {
    setKeylessConfirmed(true);
    setLlmKey("");
    setLlmFailure(null);
    void handleSave();
  }

  const allSelected = subjects.length === ALL_SUBJECTS.length;
  return (
    <Dialog
      isOpen
      onOpenChange={() => {}}
      purpose="required"
      aria-label="Set up your profile"
      width="min(560px, calc(100vw - 2rem))"
    >
      <Layout
        content={
          <LayoutContent>
            <VStack gap={4}>
              <VStack gap={1}>
                <Heading level={2}>Set up your profile</Heading>
                <Text type="supporting" color="secondary">
                  Three quick picks so PESDac scopes answers to your course.
                </Text>
              </VStack>
              {failure != null && <Text type="supporting">{failure}</Text>}
              <VStack gap={1}>
                <Text type="label">Campus</Text>
                <SegmentedControl
                  label="Campus"
                  value={campus}
                  onChange={(value) => setCampus(value)}
                >
                  {CAMPUS_CHOICES.map((c) => (
                    <SegmentedControlItem
                      key={c.value}
                      value={c.value}
                      label={c.label}
                    />
                  ))}
                </SegmentedControl>
              </VStack>
              <VStack gap={1}>
                <Text type="label">Semester</Text>
                <Selector
                  label="Semester"
                  options={SEMESTERS}
                  value={semester || null}
                  hasClear
                  placeholder="Select semester"
                  onChange={(value) => setSemester(value ?? "")}
                />
              </VStack>
              <VStack gap={1}>
                <Text type="label">Branch</Text>
                <Selector
                  label="Branch"
                  options={BRANCHES}
                  value={branch || null}
                  hasClear
                  placeholder="Select branch"
                  onChange={(value) => setBranch(value ?? "")}
                />
              </VStack>
              <VStack gap={1}>
                <Text type="label">
                  Which subjects do you plan to study mainly?
                </Text>
                <CheckboxList
                  label="Subjects"
                  value={allSelected ? [...subjects, SELECT_ALL] : subjects}
                  onChange={(values) => {
                    if (values.includes(SELECT_ALL)) {
                      setSubjects(allSelected ? [] : [...ALL_SUBJECTS]);
                    } else {
                      setSubjects(values.filter((v) => v !== SELECT_ALL));
                    }
                  }}
                >
                  <CheckboxListItem label="Select all" value={SELECT_ALL} />
                  {SUBJECTS.map((s) => (
                    <CheckboxListItem
                      key={s.value}
                      label={s.label}
                      value={s.value}
                    />
                  ))}
                </CheckboxList>
              </VStack>
              <VStack gap={1}>
                <Text type="label">Model key (optional)</Text>
                {llmHint != null ? (
                  <Text type="supporting" color="secondary">
                    OpenRouter key connected ({maskKeyHint(llmHint)}). You can
                    change it anytime in Settings.
                  </Text>
                ) : (
                  <>
                    <TextInput
                      label="OpenRouter API key"
                      isLabelHidden
                      type="password"
                      placeholder="sk-or-v1-…"
                      value={llmKey}
                      onChange={(value) => {
                        setLlmKey(value);
                        if (llmFailure) setLlmFailure(null);
                      }}
                      status={
                        llmFailure != null
                          ? { type: "error", message: llmFailure }
                          : undefined
                      }
                    />
                    <Text type="supporting" color="secondary">
                      Create one at openrouter.ai, then paste it here — or
                      skip and add it later in Settings.
                    </Text>
                    <VStack hAlign="start">
                      <Button
                        label="Get an OpenRouter key"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          window.open(OPENROUTER_KEYS_URL, "_blank", "noopener");
                        }}
                      />
                    </VStack>
                  </>
                )}
              </VStack>
              {showKeyWarn && (
                <Banner
                  status="warning"
                  title="Chats need an API key"
                  description="Without an OpenRouter key you can browse and set up, but starting a chat will ask you to connect one — anytime in Settings."
                  endContent={
                    <Button
                      label="Continue without key"
                      variant="secondary"
                      size="sm"
                      onClick={() => handleContinueWithoutKey()}
                    />
                  }
                  onDismiss={() => setShowKeyWarn(false)}
                  dismissLabel="Back to the form"
                />
              )}
              <VStack hAlign="stretch">
                <Button
                  label="Start studying"
                  variant="primary"
                  isDisabled={!canSave}
                  isLoading={isSaving}
                  onClick={() => void handleSave()}
                />
              </VStack>
            </VStack>
          </LayoutContent>
        }
      />
    </Dialog>
  );
}
