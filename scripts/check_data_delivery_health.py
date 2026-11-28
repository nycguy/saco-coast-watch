#!/usr/bin/env python3
"""Fail a low-noise public workflow when independent delivery is stale."""
from __future__ import annotations

import argparse
import datetime as dt
import json

from verify_data_delivery import verify

UTC = dt.timezone.utc


def parse_time(value: str) -> dt.datetime:
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError(f"timestamp must include a timezone: {value}")
    return parsed.astimezone(UTC)


def check_freshness(manifest: dict, now: dt.datetime, max_manifest_age_minutes: int) -> dict:
    published = parse_time(manifest["published_at"])
    age_minutes = (now - published).total_seconds() / 60
    if age_minutes < -5:
        raise RuntimeError(f"manifest publication is future-dated by {abs(age_minutes):.1f} minutes")
    if age_minutes > max_manifest_age_minutes:
        raise RuntimeError(
            f"manifest publication is stale: {age_minutes:.1f} minutes old "
            f"(limit {max_manifest_age_minutes} minutes)"
        )
    datasets = manifest.get("datasets", {})
    if not datasets:
        raise RuntimeError("manifest contains no datasets")
    stale = []
    for logical, metadata in datasets.items():
        generated = metadata.get("generated_at")
        if not generated:
            stale.append(f"{logical}: missing generated_at")
            continue
        age = (now - parse_time(generated)).total_seconds() / 60
        threshold = float(metadata.get("max_age_minutes", 0))
        if age < -5 or age > threshold:
            stale.append(f"{logical}: {age:.1f} minutes old (limit {threshold:g})")
    if stale:
        raise RuntimeError("stale datasets: " + "; ".join(stale))
    return {
        "publication_id": manifest.get("publication_id"),
        "published_at": manifest["published_at"],
        "manifest_age_minutes": round(age_minutes, 1),
        "dataset_count": len(datasets),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("base")
    parser.add_argument("--max-manifest-age-minutes", type=int, default=30)
    args = parser.parse_args()
    manifest = verify(args.base)
    result = check_freshness(manifest, dt.datetime.now(UTC), args.max_manifest_age_minutes)
    print(json.dumps({"status": "healthy", **result}, sort_keys=True))


if __name__ == "__main__":
    main()

