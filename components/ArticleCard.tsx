import Link from "next/link";
import Image from "next/image";
import type { Article } from "@/types/article";

export default function ArticleCard({ article }: { article: Article }) {
  return (
    <article className="story-card">
      <Link href={`/article/${article.id}`} className="story-card-link">
        <div className="story-card-image">
          <Image
            src={article.image_url}
            alt={article.title}
            fill
            sizes="(max-width: 768px) 90vw, 320px"
            loading="lazy"
          />
        </div>
        <div className="story-card-body">
          <div className="article-meta article-meta-compact">
            <span className="category-badge">{article.category}</span>
          </div>
          <h3>{article.title}</h3>
          <p>{article.summary}</p>
        </div>
      </Link>
    </article>
  );
}
