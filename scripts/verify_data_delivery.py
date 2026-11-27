#!/usr/bin/env python3
"""Verify the public cross-origin data-delivery branch and its manifest."""
from __future__ import annotations

import argparse
import hashlib
import json
import urllib.request


def fetch(url):
    request = urllib.request.Request(url, headers={"Origin": "https://nycguy.github.io", "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=15) as response:
        headers = {key.lower(): value for key, value in response.headers.items()}
        if response.status != 200:
            raise RuntimeError(f"{url}: HTTP {response.status}")
        if headers.get("access-control-allow-origin") not in ("*", "https://nycguy.github.io"):
            raise RuntimeError(f"{url}: browser CORS header is missing")
        return response.read(), headers


def verify(base):
    raw, headers = fetch(base.rstrip("/") + "/manifest.json")
    manifest = json.loads(raw)
    if manifest.get("manifest_schema_version") != 1:
        raise RuntimeError("unsupported independent manifest schema")
    cache = headers.get("cache-control", "")
    if "max-age=" not in cache:
        raise RuntimeError("manifest cache policy is not observable")
    for logical, meta in manifest.get("datasets", {}).items():
        data, _ = fetch(base.rstrip("/") + "/" + meta["path"].removeprefix("current/"))
        if hashlib.sha256(data).hexdigest() != meta.get("sha256"):
            raise RuntimeError(f"{logical}: SHA-256 does not match manifest")
        json.loads(data)
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("base")
    args = parser.parse_args()
    result = verify(args.base)
    print(f"Independent data delivery verified: {result['publication_id']} ({len(result['datasets'])} datasets)")
