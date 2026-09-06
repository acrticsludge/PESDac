// Shared option lists for the profile + onboarding flows. Backend
// enforces the same enums in Pydantic; keeping a single source here
// (mirrored, not auto-generated) means OnboardingDialog and the
// Profile tab render the same options and validators, and the
// server never accepts a value the UI didn't offer.
//
// Order is the order the user sees in selectors; labels are the human
// strings; the value is what the API stores. A `""` entry means
// "unset" and is the only one the PATCH validator accepts in
// addition to the explicit values.

// Mutable arrays (Astryx Selector takes a mutable options array), with
// explicit literal unions so validators and consumers keep narrow types.
export type SemesterValue = "" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";
export const SEMESTERS: { value: SemesterValue; label: string }[] = [
  { value: "", label: "Select semester" },
  { value: "1", label: "Semester 1" },
  { value: "2", label: "Semester 2" },
  { value: "3", label: "Semester 3" },
  { value: "4", label: "Semester 4" },
  { value: "5", label: "Semester 5" },
  { value: "6", label: "Semester 6" },
  { value: "7", label: "Semester 7" },
  { value: "8", label: "Semester 8" },
];

export type BranchValue =
  | ""
  | "CSE"
  | "ECE"
  | "EEE"
  | "ME"
  | "CE"
  | "BT"
  | "Other";
export const BRANCHES: { value: BranchValue; label: string }[] = [
  { value: "", label: "Select branch" },
  { value: "CSE", label: "Computer Science (CSE)" },
  { value: "ECE", label: "Electronics & Communication (ECE)" },
  { value: "EEE", label: "Electrical & Electronics (EEE)" },
  { value: "ME", label: "Mechanical (ME)" },
  { value: "CE", label: "Civil (CE)" },
  { value: "BT", label: "Biotechnology (BT)" },
  { value: "Other", label: "Other" },
];

// D7: Institution became Campus with exactly 2 options. The
// Profile.institution key in session.ts stays (L3: legacy free-text
// values map to "" on read), but the only legal API values are RR, EC,
// or blank. Keep the labels here as the source for the profile
// selector and the onboarding SegmentedControl.
export type CampusValue = "" | "RR" | "EC";
export const CAMPUSES: { value: CampusValue; label: string }[] = [
  { value: "", label: "Select campus" },
  { value: "RR", label: "RR Campus" },
  { value: "EC", label: "EC Campus" },
];

export function isCampus(v: string | undefined): v is CampusValue {
  return v === "" || v === "RR" || v === "EC";
}

// F6: 5 subject codes + "Select all" item lives in the dialog, not
// here — "Select all" is a UI affordance, not a stored value.
export type SubjectValue = "CN" | "OS" | "DLCD" | "DSA" | "Math";
export const SUBJECTS: { value: SubjectValue; label: string }[] = [
  { value: "CN", label: "Computer Networks" },
  { value: "OS", label: "Operating Systems" },
  { value: "DLCD", label: "Digital Logic" },
  { value: "DSA", label: "Data Structures" },
  { value: "Math", label: "Mathematics" },
];

export function isSubject(v: string | undefined): v is SubjectValue {
  return (SUBJECTS as { value: string }[]).some((s) => s.value === v);
}

// Validators used by both the onboarding dialog and the profile tab.
// Each returns null on success, a human message on failure.

export function validateSemester(v: string): string | null {
  if (v === "") return "Pick a semester.";
  if (!SEMESTERS.some((s) => s.value === v)) return "Unknown semester.";
  return null;
}

export function validateBranch(v: string): string | null {
  if (v === "") return "Pick a branch.";
  if (!BRANCHES.some((b) => b.value === v)) return "Unknown branch.";
  return null;
}

export function validateCampus(v: string): string | null {
  if (!isCampus(v)) return "Campus must be RR or EC.";
  return null;
}

export function validateSubjects(values: string[]): string | null {
  if (values.length === 0) return "Pick at least one subject.";
  if (values.length > 5) return "At most 5 subjects.";
  for (const v of values) {
    if (!isSubject(v)) return `Unknown subject: ${v}`;
  }
  return null;
}
