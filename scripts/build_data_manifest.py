#!/usr/bin/env python3
"""Build and validate the independently delivered coastal-data manifest.

The manifest is deliberately small and self-describing.  A data publication is
valid only when every required JSON document is present, parseable, and passes
its dataset-specific schema contract.  The publisher copies the validated
documents and this manifest into one commit on the data-delivery branch.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path

UTC = dt.timezone.utc
SCHEMA_VERSION = 1
DATASETS = {
    "data/wind.json": {"schema_version": None, "max_age_minutes": 45},
    "data/coastal-alerts.json": {"schema_version": None, "max_age_minutes": 45},
    "data/hazards.json": {"schema_version": 1, "max_age_minutes": 45},
    "data/coastal-briefing.json": {"schema_version": 2, "max_age_minutes": 45},
    "data/coastal-history.json": {"schema_version": 2, "max_age_minutes": 24 * 60},
    "data/webcams/webcams.json": {"schema_version": 1, "max_age_minutes": 45},
    "eastcast/data/snapshot.json": {"schema_version": 2, "max_age_minutes": 90},
}


def iso_now() -> str:
    return dt.datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_time(value):
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(UTC) if parsed.tzinfo else None
    except ValueError:
        return None


def dataset_timestamp(doc):
    for key in ("generated_at", "generatedAt", "captured_at", "updated_at"):
        parsed = parse_time(doc.get(key)) if isinstance(doc, dict) else None
        if parsed:
            return parsed
    return None


def validate_dataset(path: Path, relative: str):
    contract = DATASETS[relative]
    if not path.is_file() or path.stat().st_size == 0:
        raise ValueError(f"{relative}: missing or empty")
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"{relative}: malformed JSON") from exc
    if not isinstance(doc, dict):
        raise ValueError(f"{relative}: top-level JSON value must be an object")
    expected = contract["schema_version"]
    if expected is not None and doc.get("schema_version") != expected:
        raise ValueError(f"{relative}: expected schema_version {expected}")
    if relative == "data/wind.json" and not isinstance(doc.get("stations"), dict):
        raise ValueError(f"{relative}: stations must be an object")
    if relative == "data/coastal-alerts.json" and not isinstance(doc.get("features"), list):
        raise ValueError(f"{relative}: features must be a list")
    if relative == "data/hazards.json":
        required = ("active_modes", "alerts", "marine_alerts", "hourly", "hourly_full", "errors")
        if not all(isinstance(doc.get(key), list if key != "errors" else dict) for key in required):
            raise ValueError(f"{relative}: required collections have invalid shapes")
    if relative == "data/coastal-briefing.json" and not isinstance(doc.get("current_snapshot"), dict):
        raise ValueError(f"{relative}: current_snapshot must be an object")
    if relative == "data/coastal-history.json":
        if doc.get("thresholds_ft_mllw") != {"minor": 12.0, "moderate": 13.0, "major": 14.0}:
            raise ValueError(f"{relative}: Portland threshold contract is invalid")
        if not isinstance(doc.get("snapshots"), list) or not doc["snapshots"]:
            raise ValueError(f"{relative}: timestamped snapshots are required")
    if relative == "data/webcams/webcams.json" and not isinstance(doc.get("cameras"), dict):
        raise ValueError(f"{relative}: cameras must be an object")
    return doc


def build(data_root: Path, output: Path, published_at: str | None = None):
    published_at = published_at or iso_now()
    if not parse_time(published_at):
        raise ValueError("published_at must be an ISO-8601 timestamp")
    datasets = {}
    for relative, contract in DATASETS.items():
        doc = validate_dataset(data_root / relative, relative)
        file_path = data_root / relative
        datasets[relative] = {
            "path": f"current/{relative}",
            "bytes": file_path.stat().st_size,
            "sha256": hashlib.sha256(file_path.read_bytes()).hexdigest(),
            "schema_version": doc.get("schema_version"),
            "generated_at": next((doc.get(key) for key in ("generated_at", "generatedAt", "captured_at", "updated_at") if doc.get(key)), None),
            "max_age_minutes": contract["max_age_minutes"],
        }
    manifest = {
        "manifest_schema_version": SCHEMA_VERSION,
        "publication_id": hashlib.sha256((published_at + json.dumps(datasets, sort_keys=True)).encode()).hexdigest()[:16],
        "published_at": published_at,
        "delivery": {"provider": "GitHub raw content", "branch": "data-delivery", "consistency": "single-commit publication", "fallback": "same-origin Pages snapshot and in-session last-known-good"},
        "datasets": datasets,
        "source_health": {relative: {"status": "published", "generated_at": meta["generated_at"], "max_age_minutes": meta["max_age_minutes"]} for relative, meta in datasets.items()},
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--published-at")
    args = parser.parse_args()
    manifest = build(args.data_root, args.output, args.published_at)
    print(f"Validated {len(manifest['datasets'])} datasets for publication {manifest['publication_id']}")


if __name__ == "__main__":
    main()
