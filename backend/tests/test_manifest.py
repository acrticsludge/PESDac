"""Manifest T7: pure parse_manifest (spec §5, §6.1 steps 1-2+4).

No DB/HTTP — also serves the validate leg. Chunk-indexed error
messages feed F1 inline display.
"""

from __future__ import annotations

import pytest

BASE = "https://media.example/"


def _valid_payload():
    return {
        "manifest_version": 1,
        "subject": "CN",
        "unit": "unit-1",
        "source": {
            "kind": "slides",
            "title": "Unit 1 slides",
            "r2_key": "subjects/CN/unit-1/slides.pdf",
            "public_url": "https://evil.example/x.pdf",
            "page_count": 48,
        },
        "chunks": [
            {
                "kind": "text", "page": 1,
                "text": "Ohm's law",
                "page_url": "https://media.example/subjects/CN/unit-1/pages/slides-p001.png",
            }
        ],
    }


def test_valid_manifest_recomputes_source_url_and_normalizes():
    from app.retrieval.manifest import parse_manifest

    parsed = parse_manifest(_valid_payload(), BASE)
    assert parsed["source"]["public_url"] == (
        "https://media.example/subjects/CN/unit-1/slides.pdf"
    )
    assert parsed["chunk_count"] == 1
    assert parsed["chunks"][0]["text"] == "Ohm's law"


def test_unknown_subject_rejected_with_known_copy():
    from app.retrieval.manifest import ManifestError, parse_manifest

    bad = _valid_payload()
    bad["subject"] = "XX"
    with pytest.raises(ManifestError, match="Unknown subject"):
        parse_manifest(bad, BASE)


def test_bad_unit_slug_rejected():
    from app.retrieval.manifest import ManifestError, parse_manifest

    bad = _valid_payload()
    bad["unit"] = "Unit 1!!"
    with pytest.raises(ManifestError, match="unit"):
        parse_manifest(bad, BASE)


def test_r2_key_mismatch_rejected():
    from app.retrieval.manifest import ManifestError, parse_manifest

    bad = _valid_payload()
    bad["source"]["r2_key"] = "subjects/OS/unit-1/slides.pdf"
    with pytest.raises(ManifestError, match="r2_key"):
        parse_manifest(bad, BASE)


def test_unknown_manifest_version_rejected():
    from app.retrieval.manifest import ManifestError, parse_manifest

    bad = _valid_payload()
    bad["manifest_version"] = 2
    with pytest.raises(ManifestError, match="manifest_version"):
        parse_manifest(bad, BASE)
    bad2 = _valid_payload()
    del bad2["manifest_version"]
    with pytest.raises(ManifestError, match="manifest_version"):
        parse_manifest(bad2, BASE)


def test_chunk_cap_200():
    from app.retrieval.manifest import ManifestError, parse_manifest

    bad = _valid_payload()
    bad["chunks"] = [
        {"kind": "text", "page": 1, "text": "x",
         "page_url": "https://media.example/subjects/CN/unit-1/pages/p.png"}
        for _ in range(201)
    ]
    with pytest.raises(ManifestError, match="200"):
        parse_manifest(bad, BASE)


def test_oversize_text_rejected_with_chunk_index():
    from app.retrieval.manifest import ManifestError, parse_manifest

    bad = _valid_payload()
    bad["chunks"][0]["text"] = "x" * (8 * 1024 + 1)
    with pytest.raises(ManifestError, match="Chunk 0"):
        parse_manifest(bad, BASE)


def test_concepts_normalized_and_capped():
    from app.retrieval.manifest import ManifestError, parse_manifest

    good = _valid_payload()
    good["chunks"] = [{
        "kind": "diagram", "page": 42,
        "caption": "Bridge rectifier",
        "concepts": [" Diode ", "diode", "", "bridge rectifier"],
        "thumb_url": "https://media.example/subjects/CN/unit-1/diagrams/b.png",
        "page_url": "https://media.example/subjects/CN/unit-1/pages/slides-p042.png",
    }]
    parsed = parse_manifest(good, BASE)
    assert parsed["chunks"][0]["concepts"] == ["diode", "bridge rectifier"]
    bad = _valid_payload()
    bad["chunks"] = [{
        "kind": "diagram", "page": 42,
        "caption": "c",
        "concepts": [f"c{i}" for i in range(21)],
        "thumb_url": "https://media.example/subjects/CN/unit-1/diagrams/b.png",
        "page_url": "https://media.example/subjects/CN/unit-1/pages/slides-p042.png",
    }]
    with pytest.raises(ManifestError, match="Chunk 0"):
        parse_manifest(bad, BASE)


def test_foreign_origin_asset_url_rejected():
    from app.retrieval.manifest import ManifestError, parse_manifest

    bad = _valid_payload()
    bad["chunks"][0]["page_url"] = "https://evil.example/pages/p.png"
    with pytest.raises(ManifestError, match="Chunk 0"):
        parse_manifest(bad, BASE)


def test_dotdot_and_offprefix_asset_paths_rejected():
    from app.retrieval.manifest import ManifestError, parse_manifest

    traversal = _valid_payload()
    traversal["chunks"][0]["page_url"] = (
        "https://media.example/subjects/CN/unit-1/../../other/p.png"
    )
    with pytest.raises(ManifestError, match="Chunk 0"):
        parse_manifest(traversal, BASE)
    offprefix = _valid_payload()
    offprefix["chunks"][0]["page_url"] = (
        "https://media.example/x/subjects/CN/unit-1/p.png"
    )
    with pytest.raises(ManifestError, match="Chunk 0"):
        parse_manifest(offprefix, BASE)


def test_embedding_dim_mismatch_rejected():
    from app.retrieval.manifest import ManifestError, parse_manifest

    bad = _valid_payload()
    bad["chunks"][0]["embedding"] = [0.1, 0.2]
    with pytest.raises(ManifestError, match="Chunk 0"):
        parse_manifest(bad, BASE)


def test_diagram_missing_thumb_rejected_with_index():
    from app.retrieval.manifest import ManifestError, parse_manifest

    bad = _valid_payload()
    bad["chunks"] = [{
        "kind": "diagram", "page": 42,
        "caption": "Bridge rectifier",
        "concepts": ["diode"],
        "page_url": "https://media.example/subjects/CN/unit-1/pages/slides-p042.png",
    }]
    with pytest.raises(ManifestError, match="Chunk 0"):
        parse_manifest(bad, BASE)


def test_warnings_for_empty_concepts_and_missing_bbox():
    from app.retrieval.manifest import parse_manifest

    payload = _valid_payload()
    payload["chunks"] = [{
        "kind": "equation", "page": 42,
        "latex": "\\frac{V}{I}=R",
        "text": "Ohm's law",
        "thumb_url": "https://media.example/subjects/CN/unit-1/pages/eq1.png",
        "page_url": "https://media.example/subjects/CN/unit-1/pages/slides-p042.png",
    }]
    parsed = parse_manifest(payload, BASE)
    assert any("bbox" in w for w in parsed["warnings"])
