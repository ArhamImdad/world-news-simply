import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { withRetry } from "@/lib/retry";
import { assertProviderCallsAllowed } from "@/lib/environment-isolation";

const FALLBACK_IMAGE = "/og-default.svg";
const APP_UTM = "utm_source=world_news_simply&utm_medium=referral";

export type ArticleImage = {
  url: string;
  photographerName: string | null;
  photographerProfileUrl: string | null;
  attributionUrl: string | null;
  downloadLocation: string | null;
};

export const localFallbackImage = (): ArticleImage => ({
  url: FALLBACK_IMAGE, photographerName: null, photographerProfileUrl: null,
  attributionUrl: null, downloadLocation: null,
});

function withAttributionUtm(value: string) {
  const url = new URL(value);
  url.searchParams.set("utm_source", "world_news_simply");
  url.searchParams.set("utm_medium", "referral");
  return url.toString();
}

export async function getUnsplashImage(query: string, accessKey = process.env.UNSPLASH_ACCESS_KEY): Promise<ArticleImage> {
  assertProviderCallsAllowed("Unsplash");
  if (!accessKey) return localFallbackImage();

  try {
    const response = await withRetry(() => fetchWithTimeout(
      `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=landscape`,
      { headers: { Authorization: `Client-ID ${accessKey}` } }
    ), { operation: "unsplash_image" });
    if (!response.ok) {
      console.error(`Unsplash request failed with status ${response.status}`);
      return localFallbackImage();
    }
    const data = (await response.json()) as {
      urls?: { regular?: string };
      user?: { name?: string; links?: { html?: string } };
      links?: { download_location?: string };
    };
    const imageUrl = data.urls?.regular;
    const downloadLocation = data.links?.download_location;
    const photographerName = data.user?.name;
    const profileUrl = data.user?.links?.html;
    if (!imageUrl || !downloadLocation || !photographerName || !profileUrl) return localFallbackImage();

    const trackingResponse = await withRetry(() => fetchWithTimeout(downloadLocation, {
      headers: { Authorization: `Client-ID ${accessKey}` }, cache: "no-store",
    }), { operation: "unsplash_download_tracking" });
    if (!trackingResponse.ok) {
      console.error(`Unsplash download tracking failed with status ${trackingResponse.status}`);
      return localFallbackImage();
    }
    return {
      url: imageUrl,
      photographerName,
      photographerProfileUrl: withAttributionUtm(profileUrl),
      attributionUrl: `https://unsplash.com/?${APP_UTM}`,
      downloadLocation,
    };
  } catch (error) {
    console.error("Unsplash request failed:", error);
    return localFallbackImage();
  }
}
