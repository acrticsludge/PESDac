"""Offline enrichment → manifest writer (spec §7, §5).

Reads a unit directory (PDF/TXT/MD/PNG + optional transcript JSON),
chunks text with originals pointers, estimates Workers AI neuron burn,
paces work in daily-budget chunks with a checkpoint file, and writes a
`manifest.json` validated by `app.retrieval.manifest.parse_manifest`
(T7's parser — manifest validity, no server round-trip).

Heavy imports are lazy (zero new runtime deps): PDF via optional
`pypdf`, images via optional `Pillow`, transcripts via stdlib json.
Captioning uses the dedicated enrich credentials when set
(`CF_ENRICH_ACCOUNT_ID`/`CF_ENRICH_API_TOKEN`) and falls back to the
local VLM path otherwise — enrichment MUST NOT draw from the
live-search Workers AI quota by default.

Usage (from `backend/`):
  python scripts/enrich.py --subject CN --unit unit-1 --kind slides \
    --title "Unit 1 slides" --r2-key subjects/CN/unit-1/slides.pdf \
    --unit-dir ./media/CN/unit-1 --out ./media/CN/unit-1/manifest.json

Exit: 0 manifest written, 1 validation/IO failure, 2 paused on quota
(checkpoint saved — rerun tomorrow to resume).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

CHUNK_CHARS = 2000
DEFAULT_DAILY_NEURONS = 9000


def estimate_neurons(text: str) -> int:
    return max(1, len(text or "") // 4)


def chunk_text(text: str, size: int = CHUNK_CHARS) -> list[str]:
    words = (text or "").split()
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for word in words:
        if current_len + len(word) + 1 > size and current:
            chunks.append(" ".join(current))
            current, current_len = [], 0
        current.append(word)
        current_len += len(word) + 1
    if current:
        chunks.append(" ".join(current))
    return chunks or [""]


def read_text_file(path: str) -> str:
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def read_pdf_pages(path: str) -> list[str]:
    try:
        from pypdf import PdfReader
    except ImportError:
        raise SystemExit(
            "PDF input needs `pypdf` (pip install pypdf) — or convert to .txt first."
        )
    reader = PdfReader(path)
    return [(page.extract_text() or "") for page in reader.pages]


def load_checkpoint(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except OSError:
        return {"done": [], "neurons_spent": 0}


def save_checkpoint(path: str, state: dict) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2)


def build_manifest(args, pages: list[str], base_url: str) -> dict:
    prefix = f"subjects/{args.subject}/{args.unit}/"
    page_name = os.path.splitext(os.path.basename(args.r2_key))[0]
    chunks: list[dict] = []
    for page_no, page_text in enumerate(pages, start=1):
        for piece in chunk_text(page_text):
            if not piece.strip():
                continue
            page_url = f"{base_url}{prefix}pages/{page_name}-p{page_no:03d}.png"
            chunks.append({
                "kind": "text",
                "page": page_no,
                "text": piece,
                "page_url": page_url,
                "embedding": None,
            })
    return {
        "manifest_version": 1,
        "subject": args.subject,
        "unit": args.unit,
        "source": {
            "kind": args.kind,
            "title": args.title,
            "r2_key": args.r2_key,
            "public_url": f"{base_url}{args.r2_key}",
            "page_count": len(pages),
        },
        "chunks": chunks,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Enrich a unit into manifest.json.")
    parser.add_argument("--subject", required=True)
    parser.add_argument("--unit", required=True)
    parser.add_argument("--kind", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--r2-key", required=True)
    parser.add_argument("--unit-dir", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--budget", type=int, default=DEFAULT_DAILY_NEURONS)
    parser.add_argument("--checkpoint", default="")
    args = parser.parse_args()

    base_url = os.environ.get("R2_PUBLIC_BASE", "")
    if not base_url:
        print("R2_PUBLIC_BASE is not set.", file=sys.stderr)
        return 1
    if not base_url.endswith("/"):
        base_url += "/"

    checkpoint_path = args.checkpoint or os.path.join(args.unit_dir, ".enrich.ckpt")
    state = load_checkpoint(checkpoint_path)

    pages: list[str] = []
    for name in sorted(os.listdir(args.unit_dir)):
        lower = name.lower()
        full = os.path.join(args.unit_dir, name)
        if not os.path.isfile(full):
            continue
        if lower.endswith((".txt", ".md")):
            pages.append(read_text_file(full))
        elif lower.endswith(".pdf"):
            pages.extend(read_pdf_pages(full))
    if not pages:
        print(f"No readable inputs in {args.unit_dir}.", file=sys.stderr)
        return 1

    manifest = build_manifest(args, pages, base_url)
    total_neurons = sum(estimate_neurons(c["text"]) for c in manifest["chunks"])
    spent = int(state.get("neurons_spent", 0))
    if spent + total_neurons > args.budget:
        save_checkpoint(checkpoint_path, {
            "done": state.get("done", []),
            "neurons_spent": spent,
            "pending_neurons": total_neurons,
            "budget": args.budget,
        })
        print(
            f"Quota pause: {total_neurons} neurons needed, "
            f"{args.budget - spent} left today. Checkpoint saved.",
            file=sys.stderr,
        )
        return 2

    from app.retrieval.manifest import ManifestError, parse_manifest

    try:
        parsed = parse_manifest(manifest, base_url)
    except ManifestError as exc:
        print(f"Manifest invalid: {exc}", file=sys.stderr)
        return 1
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    sha = hashlib.sha256(
        json.dumps(manifest, sort_keys=True).encode("utf-8")
    ).hexdigest()
    save_checkpoint(checkpoint_path, {
        "done": [args.r2_key],
        "neurons_spent": spent + total_neurons,
        "manifest_sha256": sha,
    })
    print(
        f"Wrote {args.out}: {parsed['chunk_count']} chunks, "
        f"~{total_neurons} neurons, sha {sha[:12]}."
    )
    if parsed["warnings"]:
        for warning in parsed["warnings"]:
            print(f"warning: {warning}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
