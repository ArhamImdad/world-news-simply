# World News Simply

World News Simply is an independent Next.js publication that turns attributed public reporting into concise news briefings. It uses Supabase for article data, Groq for server-side drafting assistance, optional Unsplash images, and Cloudflare Workers through OpenNext for production hosting.

## Local setup

Requirements: a current Node.js release compatible with Next.js 16 and npm.

```bash
npm ci
copy .env.example .env.local
npm run dev
```

The local site is available at `http://localhost:3000`.

Required environment variable names:

- `GROQ_API_KEY` — server-only Groq key.
- `NEXT_PUBLIC_SUPABASE_URL` — public Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public, read-only Supabase anon key.
- `SUPABASE_SERVICE_ROLE_KEY` — server-only Supabase key used by ingestion.
- `UNSPLASH_ACCESS_KEY` — optional server-only image API key.
- `NEXT_PUBLIC_SITE_URL` — public origin with no path, such as the current `workers.dev` URL.
- `CRON_SECRET` — long random server-only bearer secret for ingestion routes.
- `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` — optional Analytics measurement ID.
- `GOOGLE_SITE_VERIFICATION` — optional Search Console verification token.

Never expose the service-role, Groq, Unsplash, or cron values through a `NEXT_PUBLIC_` variable. `.env.local` and `.dev.vars*` are ignored; `.env.example` contains placeholders only.

## Checks and builds

```bash
npm run lint
npm run typecheck
npm run build
npm run cf:build
npm run cf:dry-run
```

`npm run cf:dry-run` expects `.open-next` output, so run `npm run cf:build` first.

## Cloudflare Workers / OpenNext

Production uses the Worker `world-news-simply`. `WORKER_SELF_REFERENCE` must remain bound to that exact service name. The generated OpenNext handler remains in `.open-next/worker.js`; `custom-worker.ts` wraps it to add a scheduled event handler.

- Build only: `npm run cf:build`
- Preview: `npm run preview`
- Deploy: `npm run deploy`

The repository does not deploy automatically from local commands in this setup. If Cloudflare Workers Builds is connected to GitHub, configure the build/deploy command according to the selected Workers Builds workflow; the project deployment command is `npm run deploy`. Keep production variables and secrets in Cloudflare, with `keep_vars` enabled as currently configured.

## Scheduled news updates

`wrangler.jsonc` declares `0 8 * * *` (08:00 UTC daily). Cloudflare invokes `custom-worker.ts`, which internally calls the protected `/api/cron` route. `/api/cron` and `/api/fetch-news` share the same `updateNews()` server function and require `Authorization: Bearer <CRON_SECRET>` for manual calls.

After the next deployment, verify the Cron Trigger in Cloudflare Workers & Pages → `world-news-simply` → Triggers. Do not create a second trigger for the same schedule.

## Database

Run `supabase-articles-extra-columns.sql` in the Supabase SQL editor after reviewing it. Public/anon access should be SELECT-only. Ingestion uses `SUPABASE_SERVICE_ROLE_KEY` on the server; never grant public INSERT, UPDATE, or DELETE access.

## Search and site URL

- Sitemap: `/sitemap.xml`
- Robots rules: `/robots.txt`
- Article canonicals and structured data use `NEXT_PUBLIC_SITE_URL`.

When a custom domain is ready, attach it to the Worker, set `NEXT_PUBLIC_SITE_URL=https://your-domain.example` in Cloudflare, redeploy, and submit the new sitemap URL to Search Console. No application source URL needs to change.
