export type MarketTickerItem = {
  label: string;
  value: string;
  change: number;
};

export default function StockTicker({ markets }: { markets: MarketTickerItem[] }) {
  if (markets.length === 0) return null;

  return (
    <section className="market-ticker" aria-label="Market ticker">
      <div className="market-track">
        {[...markets, ...markets].map((market, index) => {
          const isUp = market.change >= 0;
          return (
            <span key={`${market.label}-${index}`} className={isUp ? "market-up" : "market-down"}>
              <strong>{market.label}</strong>
              {market.value}
              <em>
                {isUp ? "up" : "down"} {Math.abs(market.change).toFixed(2)}%
              </em>
            </span>
          );
        })}
      </div>
    </section>
  );
}
