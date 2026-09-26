"""Embedding providers (spec §7).

One provider active at a time — selected by RETRIEVAL_EMBED_PROVIDER,
no fallback chain (D4). Every failure surfaces as a displayable
envelope error (§6.1/§6.2), never a silent substitution.
"""

from __future__ import annotations

import hashlib
import logging
import math
import os
import re
from typing import Protocol

import httpx

from app import cache

logger = logging.getLogger("pesdac")

EMBED_DIMS = 1024
EMBED_BATCH = 32
EMBED_TIMEOUT_S = 10.0

NVIDIA_BGE_M3 = "baai/bge-m3"
LOCAL_BGE_M3 = "BAAI/bge-m3"


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


def _default_client() -> httpx.Client:
    # Fast-fail 10 s, never hang (mirrors llm.py provider validation).
    return httpx.Client(timeout=httpx.Timeout(EMBED_TIMEOUT_S))


def _post_json(client: httpx.Client, url: str, headers: dict, payload: dict) -> dict:
    try:
        resp = client.post(url, headers=headers, json=payload)
    except Exception as exc:
        logger.warning("embed_unreachable category=%s", type(exc).__name__)
        raise EmbedUnreachable("Couldn't reach the embedding service.")
    if resp.status_code >= 500 or resp.status_code in (408, 425, 429):
        logger.warning("embed_unreachable status=%d", resp.status_code)
        raise EmbedUnreachable("Couldn't reach the embedding service.")
    if resp.status_code != 200:
        logger.warning("embed_unreachable status=%d", resp.status_code)
        raise EmbedUnreachable("Couldn't reach the embedding service.")
    try:
        data = resp.json()
    except Exception as exc:
        logger.warning("embed_unreachable category=%s", type(exc).__name__)
        raise EmbedUnreachable("Couldn't reach the embedding service.")
    if not isinstance(data, dict):
        raise EmbedUnreachable("Couldn't reach the embedding service.")
    return data


class WorkersAiProvider:
    """Cloudflare Workers AI BGE-M3 (spec §7): default provider."""

    dims: int = EMBED_DIMS
    name: str = "workers-ai"
    model: str = NVIDIA_BGE_M3

    def __init__(
        self,
        account_id: str | None = None,
        api_token: str | None = None,
        base_url: str | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        account_id = account_id or os.environ.get("CF_ACCOUNT_ID")
        api_token = api_token or os.environ.get("CF_API_TOKEN")
        if not (account_id or "").strip() or not (api_token or "").strip():
            raise EmbedMisconfigured("Embedding isn't configured on this server.")
        self.account_id = account_id.strip()
        self.api_token = api_token.strip()
        base = (base_url or "https://api.cloudflare.com/client/v4").rstrip("/")
        self.url = f"{base}/accounts/{self.account_id}/ai/run/@cf/baai/bge-m3"
        self._client = client

    def _http(self) -> httpx.Client:
        return self._client or _default_client()

    def embed(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for start in range(0, len(texts), EMBED_BATCH):
            batch = texts[start:start + EMBED_BATCH]
            data = _post_json(
                self._http(),
                self.url,
                {"Authorization": f"Bearer {self.api_token}"},
                {"text": batch},
            )
            try:
                rows = data["result"]["data"]
                vecs = [row["embedding"] for row in rows]
            except (KeyError, TypeError):
                raise EmbedUnreachable("Couldn't reach the embedding service.")
            if len(vecs) != len(batch):
                raise EmbedUnreachable("Couldn't reach the embedding service.")
            for vec in vecs:
                if len(vec) != EMBED_DIMS:
                    raise ValueError(
                        f"Embedding dims must be {EMBED_DIMS}, got {len(vec)}."
                    )
                out.append([float(v) for v in vec])
        return out


class NvidiaProvider:
    """NVIDIA OpenAI-compat BGE-M3 (spec §7): only `baai/bge-m3` permitted."""

    dims: int = EMBED_DIMS
    name: str = "nvidia"

    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        model = model or os.environ.get("NVIDIA_EMBED_MODEL") or NVIDIA_BGE_M3
        if model != NVIDIA_BGE_M3:
            raise EmbedMisconfigured(
                "Only baai/bge-m3 is supported (1024d)."
            )
        api_key = api_key or os.environ.get("NVIDIA_API_KEY")
        if not (api_key or "").strip():
            raise EmbedMisconfigured("Embedding isn't configured on this server.")
        self.model = model
        self.api_key = api_key.strip()
        base = (
            base_url
            or os.environ.get("NVIDIA_API_BASE")
            or "https://integrate.api.nvidia.com"
        ).rstrip("/")
        self.url = f"{base}/v1/embeddings"
        self._client = client

    def _http(self) -> httpx.Client:
        return self._client or _default_client()

    def embed(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for start in range(0, len(texts), EMBED_BATCH):
            batch = texts[start:start + EMBED_BATCH]
            data = _post_json(
                self._http(),
                self.url,
                {"Authorization": f"Bearer {self.api_key}"},
                {"model": self.model, "input": batch},
            )
            try:
                vecs = [row["embedding"] for row in data["data"]]
            except (KeyError, TypeError):
                raise EmbedUnreachable("Couldn't reach the embedding service.")
            if len(vecs) != len(batch):
                raise EmbedUnreachable("Couldn't reach the embedding service.")
            for vec in vecs:
                if len(vec) != EMBED_DIMS:
                    raise ValueError(
                        f"Embedding dims must be {EMBED_DIMS}, got {len(vec)}."
                    )
                out.append([float(v) for v in vec])
        return out


class LocalProvider:
    """Local BGE-M3 weights (spec §7): exact model `BAAI/bge-m3`.

    Same weights as prod, so the embedding space is identical (offline
    dev, not a different space). CPU-OK. Dims must equal 1024 or
    startup refuses.
    """

    dims: int = EMBED_DIMS
    name: str = "local"

    def __init__(self, model: str | None = None) -> None:
        model = model or LOCAL_BGE_M3
        if model != LOCAL_BGE_M3:
            raise EmbedMisconfigured(
                "Local provider requires BAAI/bge-m3 (same space as prod)."
            )
        self.model = model
        self._model = None

    def _load(self):
        if self._model is None:
            try:
                from sentence_transformers import SentenceTransformer
            except ImportError:
                raise EmbedMisconfigured(
                    "Local embedding model isn't installed on this server."
                )
            self._model = SentenceTransformer(self.model)
        return self._model

    def embed(self, texts: list[str]) -> list[list[float]]:
        model = self._load()
        out: list[list[float]] = []
        for start in range(0, len(texts), EMBED_BATCH):
            batch = texts[start:start + EMBED_BATCH]
            try:
                vecs = model.encode(batch, normalize_embeddings=False)
            except Exception as exc:
                logger.warning("embed_unreachable category=%s", type(exc).__name__)
                raise EmbedUnreachable("Couldn't reach the embedding service.")
            for vec in vecs:
                if len(vec) != EMBED_DIMS:
                    raise ValueError(
                        f"Embedding dims must be {EMBED_DIMS}, got {len(vec)}."
                    )
                out.append([float(v) for v in vec])
        return out


def select_provider(
    name: str | None = None,
    *,
    account_id: str | None = None,
    api_token: str | None = None,
    api_key: str | None = None,
    model: str | None = None,
    base_url: str | None = None,
    client: httpx.Client | None = None,
) -> WorkersAiProvider | NvidiaProvider | LocalProvider | HashProvider:
    """Explicit selection, NO chain (D4).

    `name` defaults to RETRIEVAL_EMBED_PROVIDER (``workers-ai``). Any
    provider failure at use time raises EmbedMisconfigured (503) or
    EmbedUnreachable (502) — never a silent substitution.
    """
    resolved = (name or os.environ.get("RETRIEVAL_EMBED_PROVIDER") or "workers-ai").strip()
    if resolved == "hash":
        return HashProvider()
    if resolved == "workers-ai":
        return WorkersAiProvider(
            account_id=account_id, api_token=api_token,
            base_url=base_url, client=client,
        )
    if resolved == "nvidia":
        return NvidiaProvider(
            api_key=api_key, model=model, base_url=base_url, client=client
        )
    if resolved == "local":
        return LocalProvider(model=model or LOCAL_BGE_M3)
    raise EmbedMisconfigured("Embedding isn't configured on this server.")
