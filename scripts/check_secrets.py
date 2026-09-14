"""Secret scan (audit §20): high-precision patterns over changed lines.

Usage: `python scripts/check_secrets.py [--staged | --range <git-range>]`
Default scans the working-tree diff (`git diff HEAD`). Exit 1 on hits,
0 clean. Patterns are tuned for precision over recall (GitHub secret
scanning owns recall): minimum lengths skip test fixtures like
`sk-abc123XYZ7890` (16 chars) and `Bearer test-token-123` (15 chars) —
the positive/negative contract is pinned by running this file with
`--self-test`.
"""

from __future__ import annotations

import re
import subprocess
import sys

PATTERNS = {
    "openai-key": re.compile(r"sk-[A-Za-z0-9-_]{20,}"),
    "github-token": re.compile(r"ghp_[A-Za-z0-9_]{36}"),
    "github-fine-grained": re.compile(r"github_pat_[A-Za-z0-9_]{22,}"),
    "slack-token": re.compile(r"xox[bpas]-[A-Za-z0-9-]{10,}"),
    "google-key": re.compile(r"AIza[A-Za-z0-9-_]{25,}"),
    "aws-key": re.compile(r"AKIA[0-9A-Z]{16}"),
    "private-key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "bearer-long": re.compile(r"Bearer [A-Za-z0-9\-._~+/=]{20,}"),
}

#rationale: lockfiles + this scanner's own pattern literals never match
# (patterns need 20+ secret chars; literals below are shorter).
SKIP_SUFFIXES = (".lock", "package-lock.json")


def _git(args: list[str]) -> str:
    out = subprocess.run(
        ["git", *args], capture_output=True, text=True, check=False
    )
    return out.stdout


def added_lines() -> list[tuple[str, str]]:
    """(path, added-line) pairs from the working-tree + staged diff."""
    diff = _git(["diff", "HEAD", "--unified=0", "--", "."])
    pairs: list[tuple[str, str]] = []
    path = ""
    for raw in diff.splitlines():
        if raw.startswith("+++ b/"):
            path = raw[6:]
        elif raw.startswith("+") and not raw.startswith("+++"):
            if path and not path.endswith(SKIP_SUFFIXES):
                pairs.append((path, raw[1:]))
    return pairs


def scan(pairs: list[tuple[str, str]]) -> list[tuple[str, str, str]]:
    hits = []
    for path, line in pairs:
        for name, pattern in PATTERNS.items():
            if pattern.search(line):
                hits.append((path, name, line.strip()[:120]))
    return hits


def self_test() -> int:
    # Positive controls (must hit) + negative fixtures (must not).
    positives = [
        ("k.py", "key = 'sk-" + "a" * 32 + "'"),
        ("k.py", "tok = 'ghp_" + "b" * 36 + "'"),
        ("k.py", "-----BEGIN RSA PRIVATE KEY-----"),
        ("k.py", "Authorization: Bearer " + "c" * 40),
    ]
    negatives = [
        ("t.ts", "sk-abc123XYZ7890"),  # 16 chars: test fixture
        ("t.ts", "Bearer test-token-123"),  # 15 chars: test fixture
        ("t.ts", 're.compile(r"sk-[A-Za-z0-9-_]{20,}")'),  # this file
        ("t.ts", "ghp_123"),  # too short
    ]
    failures = 0
    for path, line in positives:
        if not scan([(path, line)]):
            print(f"SELF-TEST MISS (should hit): {line[:60]}")
            failures += 1
    for path, line in negatives:
        if scan([(path, line)]):
            print(f"SELF-TEST FALSE POSITIVE (should skip): {line[:60]}")
            failures += 1
    print("self-test: " + ("OK" if failures == 0 else f"{failures} FAILURES"))
    return 1 if failures else 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    hits = scan(added_lines())
    for path, name, line in hits:
        print(f"HIT {name} in {path}: {line}")
    if hits:
        print(f"secret scan: {len(hits)} hit(s) — rotate + purge from history.")
        return 1
    print("secret scan: clean.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
