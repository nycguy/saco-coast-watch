# SacoCast Architecture Decision Register

Updated: 2026-11-27

## ADR-001: Keep GitHub Pages as static hosting

Status: Accepted. GitHub Pages remains the application host and preserves the existing production URL, PWA, SacoCast, and EastCast assets.

## ADR-002: Keep computational processing on public standard Actions runners

Status: Accepted. Python, NetCDF, FFmpeg, history capture, briefing generation, artifact validation, and browser acceptance remain on standard public Ubuntu runners. Larger runners and paid services are excluded. Runners are pinned to Ubuntu 24.04 because the repository's pinned Playwright toolchain rejected Chromium installation on the newly resolved Ubuntu 26.04 `ubuntu-latest` image.

## ADR-003: Keep durable history on the dedicated branch

Status: Accepted. Existing captured history and Ferry Beach archive records remain on `coastal-history`. No historical records were deleted or rewritten.

## ADR-004: Keep notification Worker/D1 separate from Pages publication

Status: Accepted. The existing Worker, D1 schema, VAPID identity, subscriber rows, and notification preferences are not modified by this stabilization. Worker release remains manual and preflight-gated.

## ADR-005: Add bounded Pages artifact registration polling

Status: Implemented. Run `45727373906` demonstrated a successful artifact finalization followed immediately by a zero-result metadata lookup from `deploy-pages`. The Pages workflow now verifies artifact visibility before deployment, with a bounded 60-second wait.

## ADR-006: Do not remove scheduled Pages publication yet

Status: Deferred. The observed GitHub schedule is much less frequent than the configured ten- and fifteen-minute intervals. A separate data branch or Worker-backed delivery path may improve freshness, but it must first be validated for CORS, cache behavior, rate limits, atomic publication, mobile latency, and failure fallback. The current Pages path remains the known-good delivery mechanism until that evidence exists.

## ADR-007: Publish generated JSON on a dedicated data branch in parallel

Status: Implemented in parallel. The validated candidate is committed as one atomic update to `data-delivery/current`, with a manifest containing dataset hashes, timestamps, schema versions, and source-specific freshness thresholds. Browser loaders retain the same-origin Pages snapshot as fallback. Pages publication and durable history are not removed.

## ADR-008: Do not use GitHub Contents API for browser polling

Status: Rejected. It supports browser CORS but its unauthenticated rate limit and base64/API response overhead are poor fits for repeated mobile refreshes and severe-storm traffic. Raw delivery is preferred for the small public snapshot, subject to continued endpoint verification.


