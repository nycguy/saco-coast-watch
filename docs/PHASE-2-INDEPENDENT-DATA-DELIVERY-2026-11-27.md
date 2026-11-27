# SacoCast Phase 2: Independent Data Delivery

Date: 2026-11-27 UTC  
Status: Implemented in parallel; Pages publication remains active

## Outcome

Phase 2 adds a validated, independently publishable JSON snapshot on the public
`data-delivery` branch. The publication contains one manifest and seven coastal
datasets. A complete candidate is committed atomically, then checked through the
public raw endpoint for JSON validity, CORS, cache headers, and SHA-256 integrity.
Duplicate publications are skipped when all dataset hashes are unchanged.

The existing GitHub Pages data path remains in place. Browser loaders use the
independent snapshot when its manifest and dataset-specific freshness contracts
pass, then fall back to the existing same-origin Pages snapshot and finally to a
small local last-known-good cache. No Worker, D1, email, Web Push, subscription,
or notification path was changed.

## Option evaluation

| Option | Result | Decision |
|---|---|---|
| Dedicated GitHub data branch + raw content | Public CORS works; raw responses are `text/plain` but valid JSON; cache is observable and bounded by provider headers; one commit gives atomic branch state | Selected for Phase 2 parallel delivery |
| GitHub Contents/API delivery | CORS works and JSON is typed, but unauthenticated rate limit is only 60 requests/hour per IP and contents responses add base64/API overhead | Rejected for browser runtime |
| Cloudflare Worker proxy/cache | Can provide explicit CORS, cache control, and stale-while-revalidate behavior, but would couple this change to Worker release and add operational blast radius | Future option if raw delivery evidence fails |
| Cloudflare KV | Durable, but requires a KV binding and Worker deployment; unnecessary for these small payloads | Deferred |
| Existing Pages snapshots | Same-origin, already validated, and the current last-known-good path | Retained as fallback and rollback path |
| Direct NOAA/NWS/NDBC/NHC browser requests | Authoritative and already working for live observations and forecasts | Retained unchanged |

## Publication contract

The manifest records publication ID, publication time, logical dataset paths,
schema versions, generated timestamps, freshness thresholds, byte sizes, hashes,
provider, branch, consistency model, source-health metadata, and fallback order.
The publisher validates every dataset before copying it. It never pushes a
partial candidate. The branch is not used as durable historical storage; durable
history remains on `coastal-history`.

## Measured delivery behavior

The live Pages snapshot returned HTTP 200, `access-control-allow-origin: *`, and
`cache-control: max-age=600` during the Phase 2 baseline check. GitHub raw content
returned HTTP 200, browser CORS support, `cache-control: max-age=300`, and a stable
ETag. GitHub Contents returned CORS support but `cache-control: public, max-age=60,
s-maxage=60` and an unauthenticated `x-ratelimit-limit: 60`, making it unsuitable
for repeated mobile polling. Final branch-specific measurements are performed by
the post-publication endpoint verification step and retained in the workflow log.

## Tests and limitations

Added manifest schema/hash tests, interrupted and missing-publication tests,
workflow atomicity and duplicate-publication contracts, and a live delivery
verifier. The application-level browser fallback is covered by the existing
smoke suites plus the explicit two-stage loader contract. Mobile payload limits
remain enforced by the assembled artifact validator.

The independent branch is not a replacement for Pages until several successful
scheduled publications have been observed. Raw GitHub cache invalidation is
provider-controlled, not application-controlled. Versioned dataset paths and
manifest hashes make a new publication unambiguous, while the Pages snapshot
continues to provide the immediate rollback target.
