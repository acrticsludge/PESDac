"""Migration-chain integrity (audit §7 item 1, file-verifiable half).

No database needed: parses `revision` / `down_revision` assignments and
`upgrade` / `downgrade` definitions with `ast`, then asserts the chain
is linear with a single root and a single head. This pins the
0001→…→0010 ordering (including the two date-named perf/idempotency
migrations interleaved before 0009) and guarantees every migration is
reversible on paper.

What this does NOT prove (no live Postgres, no CI yet — §15): that
`upgrade head` + `downgrade -1` actually run against a real database.
That half stays deferred and is named in ADR-0004.
"""

from __future__ import annotations

import ast
from pathlib import Path

VERSIONS = Path(__file__).resolve().parent.parent / "alembic" / "versions"


def _load() -> dict[str, dict[str, object]]:
    chain: dict[str, dict[str, object]] = {}
    for path in sorted(VERSIONS.glob("*.py")):
        tree = ast.parse(path.read_text(), filename=path.name)
        rev: str | None = None
        down: str | None = "missing"
        defs = set()
        for node in tree.body:
            if isinstance(node, ast.Assign) and len(node.targets) == 1:
                target = node.targets[0]
                if isinstance(target, ast.Name) and target.id == "revision":
                    rev = ast.literal_eval(node.value)
                elif isinstance(target, ast.Name) and target.id == "down_revision":
                    down = ast.literal_eval(node.value)
            elif isinstance(node, ast.FunctionDef):
                defs.add(node.name)
        assert rev is not None, f"{path.name} has no revision assignment"
        assert down != "missing", f"{path.name} has no down_revision assignment"
        chain[rev] = {"down": down, "defs": defs, "file": path.name}
    return chain


def test_chain_is_linear_single_root_single_head():
    chain = _load()
    downs = {info["down"] for info in chain.values()}
    roots = [rev for rev, info in chain.items() if info["down"] is None]
    assert roots == ["0001_foundation"], roots
    heads = [rev for rev in chain if rev not in downs]
    assert heads == ["0010_llm_credentials"], heads
    # Linearity: every non-root revision's parent exists, and every
    # non-head revision is exactly one child's parent.
    for rev, info in chain.items():
        if info["down"] is not None:
            assert info["down"] in chain, f"{rev} points at missing {info['down']}"
    children: dict[str, int] = {}
    for info in chain.values():
        if info["down"] is not None:
            children[info["down"]] = children.get(info["down"], 0) + 1
    branched = {k: v for k, v in children.items() if v != 1}
    assert not branched, branched


def test_every_migration_is_reversible_on_paper():
    chain = _load()
    for rev, info in chain.items():
        defs = info["defs"]
        assert "upgrade" in defs, f"{rev} has no upgrade()"
        assert "downgrade" in defs, f"{rev} ({info['file']}) has no downgrade()"


def test_documented_rollback_anchor_0002_to_0001():
    chain = _load()
    assert chain["0002_campus_onboarding"]["down"] == "0001_foundation"
