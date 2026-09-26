"""Embedding providers (spec §7).

One provider active at a time — selected by RETRIEVAL_EMBED_PROVIDER,
no fallback chain (D4). Every failure surfaces as a displayable
envelope error (§6.1/§6.2), never a silent substitution.
"""

from __future__ import annotations

import hashlib
import math
import re
from typing import Protocol

from app import cache

EMBED_DIMS = 1024
EMBED_BATCH = 32


class EmbedMisconfigured(RuntimeError):
    """Missing/ wrong creds for the selected provider → 503."""


class EmbedUnreachable(RuntimeError):
    """Timeouts/5xx from the provider → 502."""


class EmbedProvider(Protocol):
    dims: int = EMBED_DIMS
    name: str = ""

    def embed(self, texts: list[str]) -> list[list[float]]: ...


_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _hash_embed_one(text: str) -> list[float]:
    tokens = _TOKEN_RE.findall((text or "").lower()) or [""]
    vec = [0.0] * EMBED_DIMS
    for token in tokens:
        for rep in range(32):
            digest = hashlib.sha256(f"{token}#{rep}".encode("utf-8")).digest()
            for b in range(32):
                idx = rep * 32 + b
                vec[idx] += digest[b] / 127.5 - 1.0
    norm = math.sqrt(sum(v * v for v in vec))
    if norm == 0.0:
        return vec
    return [v / norm for v in vec]


class HashProvider:
    """SHA256-token-bucket deterministic 1024d (spec §7).

    Selected explicitly for the test suite (no creds, shape-correct
    assertions) — never consulted implicitly.
    """

    dims: int = EMBED_DIMS
    name: str = "hash"
    model: str = "hash-1024"

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [_hash_embed_one(t) for t in texts]


def embed_texts(provider: EmbedProvider, texts: list[str]) -> list[list[float]]:
    """Embed with per-text result cache (a cache, not a fallback).

    Cache: SHA1(text)-keyed via `cache.py` primitives, TTL 86400 s.
    Dims guard: every vector must be 1024d or ValueError (startup
    refuses non-1024d providers by design — MiniLM 384d is refused,
    not adapted).
    """
    if getattr(provider, "dims", EMBED_DIMS) != EMBED_DIMS:
        raise ValueError(
            f"Embedding dims must be {EMBED_DIMS}, got {getattr(provider, 'dims', '?')}."
        )
    out: list[list[float] | None] = [None] * len(texts)
    missing: list[str] = []
    missing_idx: list[int] = []
    for i, t in enumerate(texts):
        key = cache.retrieval_emb_key(provider.name, t)
        outcome, cached = cache.get_json(key)
        if outcome == "HIT" and isinstance(cached, list) and len(cached) == EMBED_DIMS:
            out[i] = [float(v) for v in cached]
        else:
            missing.append(t)
            missing_idx.append(i)
    for batch_start in range(0, len(missing), EMBED_BATCH):
        batch = missing[batch_start:batch_start + EMBED_BATCH]
        idxs = missing_idx[batch_start:batch_start + EMBED_BATCH]
        vecs = provider.embed(batch)
        if len(vecs) != len(batch):
            raise EmbedUnreachable("Embedding service returned a short batch.")
        for text_value, orig_i, vec in zip(batch, idxs, vecs):
            if len(vec) != EMBED_DIMS:
                raise ValueError(
                    f"Embedding dims must be {EMBED_DIMS}, got {len(vec)}."
                )
            floats = [float(v) for v in vec]
            out[orig_i] = floats
            cache.set_json(
                cache.retrieval_emb_key(provider.name, text_value),
                floats,
                cache.TTL_RETRIEVAL_EMB,
            )
    return [v for v in out if v is not None]
