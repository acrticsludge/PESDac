"""R2 uploader (spec §5 layout): local-creds boto3, multipart + resume.

Keys never enter the repo or `.env.example` values — credentials live
on the curator's machine (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
+ `R2_ACCOUNT_ID`, or a shared-credentials profile). boto3 multipart
is automatic via `upload_file` (8 MB chunks); the checkpoint file maps
local path → ETag so reruns skip uploaded bytes.

Usage (from `backend/`):
  python scripts/r2_sync.py --unit-dir ./media/CN/unit-1 --bucket pesdac-media

Exit: 0 all uploaded, 1 config/IO failure.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def file_md5(path: str) -> str:
    digest = hashlib.md5()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_checkpoint(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except OSError:
        return {}


def save_checkpoint(path: str, state: dict) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2)


def r2_client():
    try:
        import boto3
    except ImportError:
        raise SystemExit("r2_sync needs `boto3` (pip install boto3) on the curator machine.")
    account = os.environ.get("R2_ACCOUNT_ID", "")
    if not account:
        raise SystemExit("R2_ACCOUNT_ID is not set (curator machine only, never the repo).")
    endpoint = f"https://{account}.r2.cloudflarestorage.com"
    session_kwargs: dict = {}
    profile = os.environ.get("AWS_PROFILE", "")
    if profile:
        session_kwargs["profile_name"] = profile
    import boto3 as _boto3

    session = _boto3.session.Session(**session_kwargs)
    return session.client(
        "s3",
        endpoint_url=endpoint,
        region_name="auto",
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync a unit dir to R2.")
    parser.add_argument("--unit-dir", required=True)
    parser.add_argument("--bucket", default="pesdac-media")
    parser.add_argument("--prefix", default="")
    parser.add_argument("--checkpoint", default="")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    checkpoint_path = args.checkpoint or os.path.join(args.unit_dir, ".r2_sync.ckpt")
    state = load_checkpoint(checkpoint_path)
    files: list[str] = []
    for root, _dirs, names in os.walk(args.unit_dir):
        for name in sorted(names):
            if name.startswith("."):
                continue
            files.append(os.path.join(root, name))
    if not files:
        print(f"No files in {args.unit_dir}.", file=sys.stderr)
        return 1
    if args.dry_run:
        for path in files:
            rel = os.path.relpath(path, args.unit_dir).replace(os.sep, "/")
            print(f"would upload {rel} ({os.path.getsize(path)} bytes)")
        return 0
    client = r2_client()
    uploaded = skipped = 0
    for path in files:
        rel = os.path.relpath(path, args.unit_dir).replace(os.sep, "/")
        key = f"{args.prefix}{rel}" if not args.prefix.endswith("/") or not args.prefix else f"{args.prefix}{rel}"
        digest = file_md5(path)
        if state.get(rel) == digest:
            skipped += 1
            continue
        client.upload_file(path, args.bucket, key)
        state[rel] = digest
        save_checkpoint(checkpoint_path, state)
        uploaded += 1
    print(f"r2_sync: {uploaded} uploaded, {skipped} skipped ({len(files)} total).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
