"""Pure manifest parsing (spec §5, §6.1 steps 1-2+4, §6.1b).

No DB/HTTP — the validate leg reuses this verbatim. Chunk-indexed
error messages feed F1 inline display ("Chunk 14: ...").
"""

from __future__ import annotations

import re
from posixpath import normpath as _normpath
from urllib.parse import urlparse

from app.models.catalog import SUBJECT_CODES
from app.models.retrieval import CHUNK_KINDS, SOURCE_KINDS
from app.retrieval.embeddings import EMBED_DIMS

MAX_CHUNKS = 200
MAX_FIELD_CHARS = 8 * 1024
MAX_CONCEPTS = 20
MAX_CONCEPT_CHARS = 64
MAX_URL_CHARS = 2048

_UNIT_RE = re.compile(r"^[a-z0-9-]{1,32}$")


class ManifestError(ValueError):
    """Validation failure (route maps to 422 VALIDATION_ERROR)."""


def normalize_concepts(concepts: list) -> list[str]:
    seen: list[str] = []
    for raw in concepts or []:
        clean = str(raw).strip().lower()
        if not clean:
            continue
        if clean not in seen:
            seen.append(clean)
    return seen


def _origin(url: str) -> str:
    parts = urlparse(url)
    if not parts.scheme or not parts.netloc:
        return ""
    return f"{parts.scheme}://{parts.netloc}".lower()


def _check_asset_url(
    url: str | None, *, idx: int, field: str, base_origin: str, prefix: str,
    required: bool,
) -> str | None:
    if url is None:
        if required:
            raise ManifestError(f"Chunk {idx}: {field} is required.")
        return None
    if not isinstance(url, str) or not url:
        raise ManifestError(f"Chunk {idx}: {field} must be a URL.")
    if len(url) > MAX_URL_CHARS:
        raise ManifestError(f"Chunk {idx}: {field} exceeds 2048 chars.")
    if not url.startswith(("http://", "https://")):
        raise ManifestError(f"Chunk {idx}: {field} must be http(s).")
    if _origin(url) != base_origin:
        raise ManifestError(f"Chunk {idx}: {field} must share the media origin.")
    # Normalize before the prefix check: `..` segments and off-prefix
    # paths containing the prefix as a substring must not pass.
    path = _normpath(urlparse(url).path or "")
    if not path.startswith(prefix):
        raise ManifestError(
            f"Chunk {idx}: {field} must sit under {prefix}."
        )
    return url


def _check_text_cap(value: str | None, *, idx: int, field: str) -> None:
    if value is None:
        return
    if len(str(value).encode("utf-8")) > MAX_FIELD_CHARS:
        raise ManifestError(f"Chunk {idx}: {field} exceeds 8 KB.")


def parse_manifest(payload: dict, r2_public_base: str) -> dict:
    if not isinstance(payload, dict):
        raise ManifestError("Manifest must be an object.")
    if payload.get("manifest_version") != 1:
        raise ManifestError("manifest_version must be 1.")
    subject = payload.get("subject")
    if subject not in SUBJECT_CODES:
        raise ManifestError("Unknown subject.")
    unit = payload.get("unit")
    if not isinstance(unit, str) or not _UNIT_RE.match(unit):
        raise ManifestError("unit must match ^[a-z0-9-]{1,32}$.")
    source = payload.get("source")
    if not isinstance(source, dict):
        raise ManifestError("source is required.")
    # §6.1 request example nests subject/unit inside source too — when
    # present they must equal the top-level fields (never trusted over
    # the key, but inconsistency fails loudly instead of half-ingesting).
    for field, top in (("subject", subject), ("unit", unit)):
        if source.get(field) is not None and source.get(field) != top:
            raise ManifestError(f"source.{field} must match {field}.")
    kind = source.get("kind")
    if kind not in SOURCE_KINDS:
        raise ManifestError("source.kind is unknown.")
    title = source.get("title")
    if not isinstance(title, str) or not title.strip():
        raise ManifestError("source.title is required.")
    r2_key = source.get("r2_key")
    if not isinstance(r2_key, str) or not r2_key:
        raise ManifestError("source.r2_key is required.")
    expected_prefix = f"subjects/{subject}/{unit}/"
    if not r2_key.startswith(expected_prefix):
        raise ManifestError("source.r2_key must match subject/unit.")
    page_count = source.get("page_count", 0)
    if not isinstance(page_count, int) or page_count < 0:
        raise ManifestError("source.page_count must be a non-negative int.")
    base = (r2_public_base or "").strip()
    if not base:
        raise ManifestError("Server media base is not configured.")
    if not base.endswith("/"):
        base += "/"
    public_url = base + r2_key
    base_origin = _origin(base)
    prefix = f"/{expected_prefix}"

    chunks = payload.get("chunks")
    if not isinstance(chunks, list):
        raise ManifestError("chunks must be a list.")
    if len(chunks) > MAX_CHUNKS:
        raise ManifestError(f"Too many chunks (max {MAX_CHUNKS}).")
    warnings: list[str] = []
    normalized: list[dict] = []
    for idx, raw in enumerate(chunks):
        if not isinstance(raw, dict):
            raise ManifestError(f"Chunk {idx}: must be an object.")
        ckind = raw.get("kind")
        if ckind not in CHUNK_KINDS:
            raise ManifestError(f"Chunk {idx}: unknown kind.")
        for field in ("text", "table_md", "caption"):
            _check_text_cap(raw.get(field), idx=idx, field=field)
        concepts_raw = raw.get("concepts", [])
        if concepts_raw is None:
            concepts_raw = []
        if not isinstance(concepts_raw, list):
            raise ManifestError(f"Chunk {idx}: concepts must be a list.")
        if len(concepts_raw) > MAX_CONCEPTS:
            raise ManifestError(f"Chunk {idx}: too many concepts (max 20).")
        for c in concepts_raw:
            if len(str(c)) > MAX_CONCEPT_CHARS:
                raise ManifestError(f"Chunk {idx}: concept exceeds 64 chars.")
        concepts = normalize_concepts(concepts_raw)
        emb = raw.get("embedding", None)
        if emb is not None and (not isinstance(emb, list) or len(emb) != EMBED_DIMS):
            raise ManifestError(f"Chunk {idx}: embedding must be 1024d or null.")
        page = raw.get("page")
        if ckind == "transcript":
            if page is not None:
                raise ManifestError("Chunk {idx}: page must be null.".format(idx=idx))
        elif page is None or not isinstance(page, int):
            raise ManifestError(f"Chunk {idx}: page is required.")

        thumb_required = ckind in ("diagram", "equation")
        page_url_required = ckind != "transcript"
        thumb_url = _check_asset_url(
            raw.get("thumb_url"), idx=idx, field="thumb_url",
            base_origin=base_origin, prefix=prefix, required=thumb_required,
        )
        page_url = _check_asset_url(
            raw.get("page_url"), idx=idx, field="page_url",
            base_origin=base_origin, prefix=prefix, required=page_url_required,
        )
        text = raw.get("text", "")
        latex = raw.get("latex")
        table_md = raw.get("table_md")
        caption = raw.get("caption")
        if ckind == "text" and not (text or "").strip():
            raise ManifestError(f"Chunk {idx}: text is required.")
        if ckind == "equation" and not (latex or "").strip():
            raise ManifestError(f"Chunk {idx}: latex is required.")
        if ckind == "table" and not (table_md or "").strip():
            raise ManifestError(f"Chunk {idx}: table_md is required.")
        if ckind == "diagram":
            if not (caption or "").strip():
                raise ManifestError(f"Chunk {idx}: caption is required.")
            if not concepts_raw:
                warnings.append(f"Chunk {idx}: empty concepts.")
        if ckind == "page":
            if not (caption or "").strip() or not (text or "").strip():
                raise ManifestError(f"Chunk {idx}: caption and text are required.")
        if ckind == "transcript":
            if not (text or "").strip():
                raise ManifestError(f"Chunk {idx}: text is required.")
            vs, ve = raw.get("video_start"), raw.get("video_end")
            if not isinstance(vs, (int, float)) or not isinstance(ve, (int, float)):
                raise ManifestError(f"Chunk {idx}: video_start/end are required.")
        if ckind == "equation" and raw.get("bbox") is None:
            warnings.append(f"Chunk {idx}: missing bbox on equation.")
        normalized.append({
            "kind": ckind,
            "page": page,
            "bbox": raw.get("bbox"),
            "text": text or "",
            "latex": latex,
            "table_md": table_md,
            "caption": caption,
            "concepts": concepts,
            "video_start": raw.get("video_start"),
            "video_end": raw.get("video_end"),
            "thumb_url": thumb_url,
            "page_url": page_url,
            "embedding": emb,
        })
    return {
        "subject": subject,
        "unit": unit,
        "source": {
            "subject": subject,
            "unit": unit,
            "kind": kind,
            "title": title.strip(),
            "r2_key": r2_key,
            "public_url": public_url,
            "page_count": page_count,
        },
        "chunks": normalized,
        "chunk_count": len(normalized),
        "warnings": warnings,
    }
