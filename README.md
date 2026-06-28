# World News Simply

World News Simply is a Next.js news blog that turns global headlines into clear, readable briefings. It includes category coverage, regional filters, opinion pieces, long reads, video news, weather, market widgets, search, and article detail pages.

![World News Simply screenshot placeholder](public/og-default.svg)

## Tech Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Supabase
- Groq
- RSS Parser
- Unsplash API
- Open-Meteo API

## Features

- Editorial homepage with hero, breaking news, editor picks, category sections, opinion, video, and long reads
- Article detail pages with related articles, metadata, structured data, and share buttons
- Supabase-backed search using case-insensitive `ilike`
- Persistent dark mode with system preference fallback
- Mobile full-screen navigation menu
- Regional filters for Asia, Europe, Middle East, Americas, and Africa
- Category load-more pagination
- Weather and market sidebar widgets
- Dynamic sitemap and robots.txt
- Production loading, error, and 404 states

## Getting Started

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env.local
```

Fill in the required values:

```bash
GROQ_API_KEY=your_groq_api_key_from_console_groq_com
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_public_key
UNSPLASH_ACCESS_KEY=your_unsplash_access_key
```

Run the development server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

- `GROQ_API_KEY`: Server-side key used to rewrite RSS articles.
- `NEXT_PUBLIC_SUPABASE_URL`: Public Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Public Supabase anon key for reads/search.
- `UNSPLASH_ACCESS_KEY`: Server-side key used to fetch article images.

## Database Setup

Run `supabase-articles-extra-columns.sql` in the Supabase SQL Editor to add optional article metadata columns and indexes.

## Deploy to Vercel

1. Push the repository to GitHub.
2. Import the project in Vercel.
3. Add the environment variables listed above.
4. Deploy.
5. Configure any scheduled job to call `/api/cron`.

## License

MIT
