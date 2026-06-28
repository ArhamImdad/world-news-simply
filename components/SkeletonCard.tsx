export default function SkeletonCard() {
  return (
    <article className="story-card card-skeleton animate-pulse">
      <div className="story-card-image skeleton" />
      <div className="story-card-body">
        <div className="skeleton skeleton-line skeleton-line-short" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line skeleton-line-medium" />
      </div>
    </article>
  );
}
