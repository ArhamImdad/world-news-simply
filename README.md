# World News Simply

World News Simply is a Next.js publication that transforms permitted official material into concise, attributed news briefings. It uses Supabase for the private preparation queue and public articles, Groq for isolated generation and validation, optional Unsplash images, and Cloudflare Workers through OpenNext.

## Local setup

Requirements: a current Node.js release compatible with Next.js 16 and npm.

```bash
npm ci
copy .env.example .env.local
npm run dev
```

Normal local development uses `APP_ENV=local`, localhost, and the production
Supabase URL plus its publishable/anon key. It can read only rows already public
under production RLS. Service-role, cron, Groq, and Unsplash secrets must be
empty; startup fails closed if any is present, and application mutation/provider
boundaries independently refuse local execution. AdSense is forced off.

Local environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`: `https://mgfnosozkomhinsaztbs.supabase.co`.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: production publishable/anon key.
- `NEXT_PUBLIC_SITE_URL`: `http://localhost:3000`.
- `NEXT_PUBLIC_CANONICAL_SITE_URL`: optional production HTTPS canonical used by metadata while local robots remain no-index.

Production-only environment variables:

- `GROQ_API_KEY`: server-only Groq key.
- `NEXT_PUBLIC_SUPABASE_URL`: public Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: public, read-only Supabase anon key.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only Supabase key used by the queue.
- `UNSPLASH_ACCESS_KEY`: optional server-only image API key.
- `NEXT_PUBLIC_SITE_URL`: public origin with no path.
- `CRON_SECRET`: long random server-only bearer secret for scheduled routes.
- `READY_QUEUE_TARGET` / `READY_QUEUE_MINIMUM` / `READY_QUEUE_MAXIMUM`: reserve thresholds (defaults 18 / 8 / 30).
- `MAX_GROQ_CANDIDATES_CRITICAL` / `LOW` / `NORMAL`: per-run expensive-candidate ceilings (defaults 3 / 2 / 1).
- `GROQ_RUN_TOKEN_BUDGET` / `GROQ_DAILY_TOKEN_BUDGET`: fail-closed approximate token ceilings (defaults 45,000 / 180,000). `GROQ_DAILY_TOKENS_USED` can seed an externally observed daily total.
- `REPLENISH_NORMAL_CANDIDATES` / `REPLENISH_LOW_CANDIDATES` / `REPLENISH_CRITICAL_CANDIDATES`: bounded per-run candidate limits (defaults 6 / 12 / 18).
- `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` and `GOOGLE_SITE_VERIFICATION`: optional public integrations.
- `NEXT_PUBLIC_ADSENSE_ENABLED`: explicit AdSense runtime switch; defaults to `false`.
- `NEXT_PUBLIC_ADSENSE_CONSENT_READY`: operator assertion that the production consent/CMP configuration is ready; defaults to `false`.
- `NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT`: the real AdSense client identifier supplied by Google. Malformed or absent values fail closed.
- `NEXT_PUBLIC_GOOGLE_ADSENSE_ARTICLE_SLOT`: the real article ad-unit slot supplied by Google. Malformed or absent values fail closed.

Never expose service-role, Groq, Unsplash, or cron values through `NEXT_PUBLIC_`.
Keep production values in the deployment secret store or the ignored
`.env.production.local`; `.env.local`, `.env.production.local`, and `.dev.vars*`
are ignored. Staging remains available only for the existing guarded diagnostic
commands and is not part of normal local development.

## Checks and builds

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run build:production
npm run cf:build
npm run cf:dry-run
```

The dry-run expects `.open-next` output, so run the Cloudflare build first.

## Autonomous publication

Preparation and publication are separate failure domains. Before generating new material, replenishment scans the pending null-metadata draft backlog by category under the existing database lease. It processes a bounded batch, verifies that the original URL is still permitted and fresh, rebuilds independent source evidence, performs the deterministic and Groq quality reviews, and updates a valid row in place with the complete ready metadata. Invalid rows are retained as rejected records with reasons, while transient failures remain pending for a later retry. Queue replenishment then discovers permitted material, corroborates it across at least two independent domains, builds a compact traceable evidence model and deterministic article plan, ranks candidates before Groq, generates from evidence rather than webpage structure, runs a deterministic originality precheck, and independently audits only surviving drafts. One targeted revision is permitted. Sanitized token accounting and run/daily governors bound provider spend. The pipeline obtains a compliant image or local fallback and persists only fully ready rows. It targets 18 ready articles, warns below 8, and never exceeds 30 through the database enqueue lock.

Every scheduled trigger runs the same full cycle. It first attempts the current publication slot, processes pending drafts and replenishes the ready queue, then retries an empty slot so an article prepared during that run can publish immediately. A database function protected by an advisory transaction lock and unique two-hour publication-slot key revalidates expiry, current registry IDs, source permissions, structured sources, validation evidence, image attribution, score, and duplicates. It ranks eligible content and publishes at most one row per slot. The offset trigger (`15,45 * * * *`) provides automatic retries for a missed or failed primary trigger; the database slot lock prevents duplicate publication.

Automatic publication is fail-closed and requires no admin action. A row needs an overall quality score of at least 90; factual completeness, originality, usefulness, meaningful context, headline quality, and added-value scores of at least 90; two permitted independent source domains; a structured primary source; all commercial-reuse/AI-processing/transformation permissions; duplicate and source-overlap passes; complete attribution; no unsupported claims, invented quotes/statistics, excessive paraphrase, speculative content, or hard warnings; modern pipeline metadata; unexpired freshness metadata; and a compliant image. The database rechecks the same automated editorial evidence before changing `editorial_state` to `published`.

Enabled pools use documented official text from BLS, GOV.UK, SEC, U.S. Census, ONS, and NASA, plus curated BLS/ONS methodology pairs for evergreen explainers. Publisher feeds with unknown or restrictive reuse terms remain registry-disabled. Publisher images are never ingested.

## Cloudflare Workers / OpenNext

Production uses the Worker `world-news-simply`. `WORKER_SELF_REFERENCE` must remain bound to that exact service name. `custom-worker.ts` wraps the generated OpenNext handler with scheduled events. Production commands optionally load the ignored `.env.production.local` when it exists. Without that file, they use the existing process environment, including Cloudflare dashboard build variables. The runner always sets and validates `APP_ENV=production`, preserves nested environment locks, and rejects missing public configuration, the wrong Supabase project, and invalid canonical origins (including localhost, `workers.dev`, `vercel.app`, and `supabase.co`).

Configure these variables in the Cloudflare **build environment**, not only the deployed Worker's runtime settings:

| Variable | Build value |
| --- | --- |
| `APP_ENV` | `production` (also enforced by the production scripts) |
| `NEXT_PUBLIC_SITE_URL` | The publication's real custom HTTPS origin, without a path |
| `NEXT_PUBLIC_SUPABASE_URL` | The production project's public URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The production publishable/anon key |
| `NEXT_PUBLIC_ADSENSE_ENABLED` | `false` while advertising is disabled |
| `NEXT_PUBLIC_ADSENSE_CONSENT_READY` | `false` while advertising is disabled |

AdSense client and article-slot IDs may remain absent while advertising is disabled. Public build configuration is embedded by Next.js; it must match the intended production environment. Keep the application environment and public configuration available at runtime as well.

`SUPABASE_SERVICE_ROLE_KEY` (server article metadata and queue access), `GROQ_API_KEY` (generation), and `CRON_SECRET` (scheduled endpoint authorization) are runtime secrets, not build requirements. `UNSPLASH_ACCESS_KEY` is an optional runtime image-provider secret. Configure these as Worker secrets; do not prefix them with `NEXT_PUBLIC_` or place them in committed files. If provided through the CI process environment, the runner preserves them without logging their values. Cloudflare deployment authentication is separate from these application secrets.

Existing env files retain their isolated loading behavior; `npm run dev` still loads `.env.local`, staging commands still load their specified file, and the test runner's `-` sentinel still clears inherited database configuration. When a requested file is absent, inherited values are validated and unrelated local dotenv files cannot fill in missing values. No environment files need to be committed for `cf:build`, `deploy`, or `cf:dry-run`.

- Build only: `npm run cf:build`
- Preview: `npm run preview`
- Deploy: `npm run deploy`

After deployment, verify both cron triggers in Cloudflare. Do not create duplicate triggers for either schedule.

## Database

Review and apply the ordered files in `supabase/migrations` before deploying. The autonomous queue migration adds private lifecycle/evidence fields and service-role-only RPCs; builds do not execute migrations and the migration does not rewrite legacy rows. Public/anon access remains approved-row SELECT-only. The 892 quarantined legacy rows remain hidden unless the bounded backlog processor can independently prove that a row meets every current source, quality, freshness, attribution, and publication requirement; otherwise the row remains stored with an explicit rejection reason.

There is no public admin login or CMS. Protected cron endpoints and service-role database functions are the only mutation path. Publication moves directly from generated draft through automated editorial checks to the ready queue and scheduled public release. Failed drafts remain rejected or quarantined without blocking the queue for admin action.

## Search and site URL

- Sitemap: `/sitemap.xml`
- Robots rules: `/robots.txt`
- Article canonicals and structured data use `NEXT_PUBLIC_SITE_URL`.

When a custom domain is ready, attach it to the Worker, update `NEXT_PUBLIC_SITE_URL`, redeploy, and submit the new sitemap URL.

## AdSense readiness (disabled)

AdSense is disabled by default. If Google approves the site and the operator later enables the runtime and consent flags, ads remain limited to published articles that pass the automated content, freshness, source, attribution, originality, and quality gates. Homepage, policy, loading, error, API, and other non-article routes contain no ad component.

Before enabling AdSense:

1. Complete the remaining staging reserve validation, connect the custom HTTPS domain, deploy, and publish a representative body of automatically qualified articles.
2. Create the AdSense account and use the real client and article-slot values supplied by Google. Setting the client value makes `/ads.txt` and the optional account-verification metadata use that same real publisher identity; absent or malformed values return no declaration.
3. Configure a Google-certified CMP/TCF integration for applicable EEA, UK, and Switzerland traffic. Set `NEXT_PUBLIC_ADSENSE_CONSENT_READY=true` only after that production configuration is verified.
4. Set `NEXT_PUBLIC_ADSENSE_ENABLED=true` only after Google has approved the site. If any flag, identifier, automated eligibility gate, or consent prerequisite is missing, the page remains ad-free without a placeholder or layout hole.

Google Analytics is configured independently. If it is enabled for a jurisdiction where consent is required, include it in the production consent design rather than treating the AdSense flag as analytics consent.
