import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { supabase, type Article } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

async function getArticle(id: string) {
  const { data, error } = await supabase
    .from("articles")
    .select("id,title,content,summary,image_url,source_url,category,created_at")
    .eq("id", id)
    .single();

  if (error) {
    console.error("Failed to load article:", error.message);
    return null;
  }

  return data as Article;
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const article = await getArticle(id);

  if (!article) {
    notFound();
  }

  const paragraphs = article.content
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <main className="min-h-screen bg-white text-zinc-950">
      <nav className="bg-zinc-950 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-8 sm:py-5">
          <Link href="/" className="text-base font-black tracking-tight sm:text-xl">
            World News Simply
          </Link>
          <Link href="/" className="text-xs font-semibold text-zinc-300 hover:text-white sm:text-sm">
            Back to homepage
          </Link>
        </div>
      </nav>

      <article className="mx-auto max-w-5xl px-4 py-5 sm:px-8 sm:py-8 lg:py-12">
        <div className="relative h-56 overflow-hidden rounded-lg bg-zinc-100 sm:h-[460px]">
          <Image
            src={article.image_url}
            alt={article.title}
            fill
            priority
            sizes="(max-width: 768px) 100vw, 960px"
            className="object-cover"
          />
        </div>

        <div className="mx-auto max-w-3xl py-6 sm:py-12">
          <div className="mb-4 flex flex-wrap items-center gap-2 sm:mb-5 sm:gap-3">
            <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
              {article.category}
            </span>
            <time className="text-xs text-zinc-500 sm:text-sm" dateTime={article.created_at}>
              {formatDate(article.created_at)}
            </time>
          </div>

          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-6xl">
            {article.title}
          </h1>

          <p className="mt-5 border-l-4 border-zinc-950 pl-4 text-base leading-7 text-zinc-600 sm:mt-6 sm:pl-5 sm:text-lg sm:leading-8">
            {article.summary}
          </p>

          <div className="mt-8 space-y-5 text-base leading-8 text-zinc-800 sm:mt-10 sm:space-y-6 sm:text-lg sm:leading-9">
            {paragraphs.length > 0 ? (
              paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))
            ) : (
              <p>{article.content}</p>
            )}
          </div>

          <div className="mt-10 flex flex-col gap-4 border-t border-zinc-200 pt-6 text-sm sm:mt-12 sm:flex-row sm:items-center sm:justify-between sm:pt-8 sm:text-base">
            <Link
              href="/"
              className="font-bold text-zinc-950 underline underline-offset-4"
            >
              Back to homepage
            </Link>
            {article.source_url ? (
              <a
                href={article.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-zinc-950 underline underline-offset-4"
              >
                Read original article
              </a>
            ) : null}
          </div>
        </div>
      </article>
    </main>
  );
}
