"use client";

// Onboarding wizard (spec §F, plan item 21): required-purpose Dialog
// over /new that opens when GET /auth/me reports onboardingDone false
// (signup AND returning logins until completed — survives reload, no
// URL param). Single screen: Campus SegmentedControl + Semester/Branch
// Selectors + Subjects CheckboxList with Select-all. Save PATCHes
// /profiles/me with onboardingDone:true and mirrors the picks into the
// local session store (reads are local-only; fetch-without-seed would
// leave every consumer blank). Failure keeps the dialog open with a
// Banner. Triple lock: purpose="required" + controlled-open ignores
// closes + Pesdac Esc yields while active (via onActiveChange).

import { useEffect, useState } from "react";

import { Dialog } from "@astryxdesign/core/Dialog";
import { Button } from "@astryxdesign/core/Button";
import { Banner } from "@astryxdesign/core/Banner";
import { Heading, Text } from "@astryxdesign/core/Text";
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
  toUserMessage,
} from "../../lib/auth";
import { updateProfile as updateLocalProfile } from "../../lib/session";
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
  const [phase, setPhase] = useState<"checking" | "open" | "done">(
    "checking",
  );
  const [campus, setCampus] = useState("");
  const [semester, setSemester] = useState("");
  const [branch, setBranch] = useState("");
  const [subjects, setSubjects] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Mounts only once the server confirms onboarding is needed:
  // checking/done render nothing, so refreshes never flash a loader.
  // The open Dialog already dims + blurs the window behind it.
  const open = phase === "open";
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
  useEffect(() => {
    if (auth.status !== "authenticated") return;
    let cancelled = false;
    (async () => {
      try {
        const [me, profile] = await Promise.all([
          apiGetMe(),
          apiGetProfile(),
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
        setPhase("open");
      } catch {
        // Unknown state (network down): stay closed rather than block
        // the app on a guess. The next mount re-checks.
        if (!cancelled) setPhase("done");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.status]);

  if (auth.status !== "authenticated" || !open) return null;

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
    if (!canSave) return;
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
        institution: campus,
        semester,
        branch,
        subjects,
      });
      setPhase("done");
    } catch (error) {
      setFailure(toUserMessage(error, "Couldn't save. Try again."));
    } finally {
      setIsSaving(false);
    }
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
              {failure != null && (
                <Banner
                  status="error"
                  title="Couldn't save your profile"
                  description={failure}
                />
              )}
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
