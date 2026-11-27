# SacoCast Zero-Cost Platform Register

Verified: 2026-11-27  
This register records published platform limits and the distinction between platform allowances and measured SacoCast usage. Limits can change; URLs are retained for re-verification.

## GitHub

| Service | Published constraint | SacoCast implication |
|---|---|---|
| Actions standard runners in public repositories | Standard GitHub-hosted runners are free and unlimited for public repositories. `ubuntu-latest` is a 4-CPU, 16-GB, 14-GB SSD runner in the current reference. | Keep computational work on standard public Ubuntu runners. Do not use larger runners. |
| Actions artifact storage | GitHub Free documents 500 MB of artifact storage, shared with GitHub Packages. | Keep diagnostic artifacts short-lived. Current Pages artifacts are one-day retention; failure screenshots are one-day retention. |
| Actions token API rate limit | GitHub documents 1,000 requests/hour/repository for `GITHUB_TOKEN` in Actions limits. | The new pre-deployment artifact poll performs at most 12 requests per run. |
| GitHub Pages | The source repository has a recommended 1 GB limit; Pages also has published bandwidth/build limits and is not a high-frequency API. | Keep Pages as static application hosting, not as a live observation API. |
| Git repository/raw delivery | GitHub recommends staying within repository limits and documents raw content delivery through `raw.githubusercontent.com`; push rate is recommended at no more than six pushes/minute/repository. | A future data branch must use atomic, infrequent updates and browser cache controls. It is not yet selected as the production data service. |

## Cloudflare

| Service | Published free constraint | SacoCast implication |
|---|---|---|
| Workers Free | 100,000 requests/day, 10 ms CPU/invocation, 128 MB memory, 50 subrequests/request, and five Cron Triggers/account. | The existing alert Worker remains lightweight. Do not move Python, FFmpeg, NetCDF, or bulk processing into it. |
| D1 Free | Free-tier daily row read/write and storage limits are enforced; exceeding daily limits causes D1 queries to fail until reset. | Preserve graceful notification degradation and do not use D1 for high-volume public observation delivery. |
| KV Free | Current KV limits document 1 GB/account and per-operation/platform limits; KV operations are metered and free usage is limited by the Workers plan. | Do not introduce KV writes for each observation or visitor request without measured capacity and account verification. |
| Cache | Cloudflare documents a 512 MB CDN cache limit on Free/Pro/Business. | Cache is suitable for small immutable snapshots, but cache invalidation and quota behavior require a tested design. |
| Spending protection | Cloudflare documents spending limits that can reject new invocations at a threshold, but a Workers Paid plan has a minimum charge. | No paid plan, billing-enabled trial, or automatic paid overage is authorized. |

## Email and external sources

- Resend's current Free plan documents 3,000 emails/month and 100 emails/day. The existing notification path must remain bounded by those limits and must fail closed rather than create paid overage.
- NOAA, NWS, NDBC, NHC, and WebCOOS/NERACOOS are treated as authoritative or source-appropriate public feeds already used by the application. Upstream reporting intervals are not guarantees of availability.
- No account-wide Cloudflare usage, D1 row totals, KV totals, Resend send totals, or GitHub billing configuration was available from the repository itself. Those values remain unverified and are listed as an owner-account verification item.

## Sources

- GitHub Actions limits: https://docs.github.com/en/actions/reference/limits
- GitHub Actions billing: https://docs.github.com/en/billing/concepts/product-billing/github-actions
- GitHub-hosted runners: https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- GitHub repository limits: https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare D1 FAQ: https://developers.cloudflare.com/d1/reference/faq/
- Cloudflare KV limits: https://developers.cloudflare.com/kv/platform/limits/
- Cloudflare cache limits: https://developers.cloudflare.com/cache/how-to/cache-rules/settings/
- Resend pricing: https://resend.com/pricing

## Phase 2 delivery addition

The independent snapshot uses the existing public GitHub repository and standard GitHub Actions runners. It introduces no paid service, billing-enabled feature, larger runner, KV namespace, Worker binding, or automatic overage. The branch is kept separate from durable history so generated refreshes do not rewrite the historical record. GitHub Actions contents write permission is limited to the repository workflow token and is used only for the validated data publication.

