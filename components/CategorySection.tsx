import Link from "next/link";
import ArticleCard from "@/components/ArticleCard";
import type { Article } from "@/types/article";

export default function CategorySection({
  category,
  articles,
}: {
  category: string;
  articles: Article[];
}) {
  if (articles.length === 0) return null;

  return (
    <section className="category-section">
      <div className="category-section-header">
        <h2>{category}</h2>
        <Link href={`/?category=${category}`} className="see-all-link">
          See all {category} -&gt;
        </Link>
      </div>
      <div className="category-card-grid">
        {articles.slice(0, 3).map((article) => (
          <ArticleCard key={article.id} article={article} />
        ))}
      </div>
    </section>
  );
}
