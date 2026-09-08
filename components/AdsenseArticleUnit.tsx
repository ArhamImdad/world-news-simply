import Script from "next/script";
import { canRenderAdsense, readAdsenseRuntimeConfig } from "@/lib/adsense";
import { getArticlePath } from "@/lib/article-url";
import type { Article } from "@/types/article";

export default function AdsenseArticleUnit({ article }: { article: Article }) {
  const config = readAdsenseRuntimeConfig();
  const pathname = getArticlePath(article);

  if (!canRenderAdsense({ article, pathname, config })) return null;

  return (
    <aside className="article-ad" aria-label="Advertisement">
      <Script
        id="google-adsense-loader"
        async
        strategy="afterInteractive"
        crossOrigin="anonymous"
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${config.clientId}`}
      />
      <ins
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={config.clientId!}
        data-ad-slot={config.articleSlot!}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
      <Script id={`google-adsense-article-${article.id}`} strategy="afterInteractive">
        {`(window.adsbygoogle = window.adsbygoogle || []).push({});`}
      </Script>
    </aside>
  );
}
