"""Auth schemas — validation at the boundary (arch §9)."""

from __future__ import annotations

from pydantic import BaseModel, field_validator

from app import security


class SignupIn(BaseModel):
    email: str
    password: str
    displayName: str = ""

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = security.normalize_email(v)
        if not security.valid_email(v):
            raise ValueError("Enter a valid email address.")
        return v

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        if not 12 <= len(v) <= 128:
            raise ValueError("Password must be 12–128 characters.")
        return v

    @field_validator("displayName")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if len(v) > 80:
            raise ValueError("Display name must be at most 80 characters.")
        return v


class LoginIn(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return security.normalize_email(v)


class UserOut(BaseModel):
    id: str
    email: str
    displayName: str


class PasswordRequestIn(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return security.normalize_email(v)


class PasswordConfirmIn(BaseModel):
    token: str
    newPassword: str

    @field_validator("newPassword")
    @classmethod
    def _password(cls, v: str) -> str:
        if not 12 <= len(v) <= 128:
            raise ValueError("Password must be 12–128 characters.")
        return v
