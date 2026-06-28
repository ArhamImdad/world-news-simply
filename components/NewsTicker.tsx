export default function NewsTicker({ headlines }: { headlines: string[] }) {
  if (headlines.length === 0) return null;

  const tickerText = headlines.slice(0, 10).join("  /  ");

  return (
    <section className="news-ticker" aria-label="Breaking headlines">
      <div className="breaking-label">Breaking</div>
      <div className="ticker-viewport">
        <div className="ticker-track">
          <span>{tickerText}</span>
          <span aria-hidden="true">{tickerText}</span>
        </div>
      </div>
    </section>
  );
}
