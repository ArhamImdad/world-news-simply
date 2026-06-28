import ArticleCard from "@/components/ArticleCard";
import type { Article } from "@/types/article";

export default function HeroSection({ articles }: { articles: Article[] }) {
  if (articles.length === 0) return null;

  return (
    <section className="hero-grid" aria-label="Top stories">
      {articles.slice(0, 3).map((article) => (
        <ArticleCard key={article.id} article={article} />
      ))}
    </section>
  );
}
