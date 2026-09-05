"""Profile schemas. PATCH accepts any subset; response is always the full row
(merge-over-defaults, so old clients stay valid when new keys are added)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, field_validator

from app.models.catalog import SUBJECT_CODES
from app.models import profiles as _p


def _text(max_len: int):
    def _v(cls: type, v: str | None) -> str:
        if v is None:
            raise ValueError("Must be a string.")
        v = v.strip()
        if len(v) > max_len:
            raise ValueError(f"Must be at most {max_len} characters.")
        return v

    return _v


class ProfileOut(BaseModel):
    displayName: str = ""
    email: str = ""
    institution: str = ""
    semester: str = ""
    branch: str = ""
    subjects: list[str] = []
    examMonth: str = ""
    weeklyGoal: str = "5 days"
    difficulty: str = "medium"
    depth: str = "auto"
    verbosity: str = "balanced"
    proactiveQuiz: bool = True
    followUps: bool = True
    citations: str = "on request"
    retention: str = "forever"
    language: str = "en-US"
    region: str = "IN"
    campus: str = ""
    onboardingDone: bool = False
    timezone: str = "IST"
    shortcutNewChat: bool = True
    shortcutCancel: bool = True
    shortcutFocus: bool = True


class ProfilePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    displayName: str | None = None
    email: str | None = None
    institution: str | None = None
    semester: str | None = None
    branch: str | None = None
    subjects: list[str] | None = None
    examMonth: str | None = None
    weeklyGoal: str | None = None
    difficulty: str | None = None
    depth: str | None = None
    verbosity: str | None = None
    proactiveQuiz: bool | None = None
    followUps: bool | None = None
    citations: str | None = None
    retention: str | None = None
    language: str | None = None
    region: str | None = None
    campus: str | None = None
    onboardingDone: bool | None = None
    timezone: str | None = None
    shortcutNewChat: bool | None = None
    shortcutCancel: bool | None = None
    shortcutFocus: bool | None = None

    _t80 = field_validator("displayName", mode="before")(lambda cls, v: v if v is None else _text(80)(cls, v))
    _t254 = field_validator("email", mode="before")(lambda cls, v: v if v is None else _text(254)(cls, v))
    _t120a = field_validator("institution", "examMonth", mode="before")(
        lambda cls, v: v if v is None else _text(120)(cls, v)
    )

    @field_validator("semester")
    @classmethod
    def _semester(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if v not in _p.SEMESTERS:
            raise ValueError("Unknown semester.")
        return v

    @field_validator("branch")
    @classmethod
    def _branch(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if v not in _p.BRANCHES:
            raise ValueError("Unknown branch.")
        return v

    @field_validator("subjects")
    @classmethod
    def _subjects(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        if len(v) > 5:
            raise ValueError("At most 5 subjects.")
        for s in v:
            if s not in SUBJECT_CODES:
                raise ValueError(f"Unknown subject: {s}.")
        return v

    @field_validator("weeklyGoal")
    @classmethod
    def _goal(cls, v: str | None) -> str | None:
        if v is not None and v not in _p.WEEKLY_GOALS:
            raise ValueError("Unknown weekly goal.")
        return v

    @field_validator("difficulty")
    @classmethod
    def _diff(cls, v: str | None) -> str | None:
        if v is not None and v not in _p.DIFFICULTIES:
            raise ValueError("Unknown difficulty.")
        return v

    @field_validator("depth")
    @classmethod
    def _depth(cls, v: str | None) -> str | None:
        if v is not None and v not in _p.DEPTHS:
            raise ValueError("Unknown depth.")
        return v

    @field_validator("verbosity")
    @classmethod
    def _verb(cls, v: str | None) -> str | None:
        if v is not None and v not in _p.VERBOSITIES:
            raise ValueError("Unknown verbosity.")
        return v

    @field_validator("citations")
    @classmethod
    def _cit(cls, v: str | None) -> str | None:
        if v is not None and v not in _p.CITATIONS:
            raise ValueError("Unknown citations setting.")
        return v

    @field_validator("retention")
    @classmethod
    def _ret(cls, v: str | None) -> str | None:
        if v is not None and v not in _p.RETENTIONS:
            raise ValueError("Unknown retention.")
        return v

    @field_validator("language")
    @classmethod
    def _lang(cls, v: str | None) -> str | None:
        if v is not None and v not in _p.LANGUAGES:
            raise ValueError("Unknown language.")
        return v

    @field_validator("region")
    @classmethod
    def _region(cls, v: str | None) -> str | None:
        if v is not None and v not in _p.REGIONS:
            raise ValueError("Unknown region.")
        return v

    @field_validator("campus")
    @classmethod
    def _campus(cls, v: str | None) -> str | None:
        if v is not None and v not in _p.CAMPUSES:
            raise ValueError("Campus must be RR, EC, or blank.")
        return v

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str | None) -> str | None:
        if v is not None and v not in _p.TIMEZONES:
            raise ValueError("Unknown timezone.")
        return v


# model field <-> API (camelCase) mapping; single source for to/out + patch apply.
PROFILE_FIELDS: tuple[tuple[str, str], ...] = (
    ("display_name", "displayName"),
    ("email", "email"),
    ("institution", "institution"),
    ("semester", "semester"),
    ("branch", "branch"),
    ("subjects", "subjects"),
    ("exam_month", "examMonth"),
    ("weekly_goal", "weeklyGoal"),
    ("difficulty", "difficulty"),
    ("depth", "depth"),
    ("verbosity", "verbosity"),
    ("proactive_quiz", "proactiveQuiz"),
    ("follow_ups", "followUps"),
    ("citations", "citations"),
    ("retention", "retention"),
    ("language", "language"),
    ("region", "region"),
    ("campus", "campus"),
    ("onboarding_done", "onboardingDone"),
    ("timezone", "timezone"),
    ("shortcut_new_chat", "shortcutNewChat"),
    ("shortcut_cancel", "shortcutCancel"),
    ("shortcut_focus", "shortcutFocus"),
)


def profile_to_out(profile) -> dict:
    return {api: getattr(profile, field) for field, api in PROFILE_FIELDS}
