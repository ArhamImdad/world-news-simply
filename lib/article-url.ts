import type { Article } from "@/types/article";

export function getArticlePath(article: Pick<Article, "id" | "slug">) {
  return `/article/${article.slug || article.id}`;
}
