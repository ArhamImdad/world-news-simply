import { getServerEnv } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

const FALLBACK_IMAGE = "https://source.unsplash.com/random";

export async function getUnsplashImage(query: string) {
  const env = getServerEnv();

  if (!env.UNSPLASH_ACCESS_KEY) {
    return FALLBACK_IMAGE;
  }

  try {
    const response = await fetchWithTimeout(
      `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=landscape`,
      { headers: { Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}` } }
    );

    if (!response.ok) {
      console.error(`Unsplash request failed with status ${response.status}`);
      return FALLBACK_IMAGE;
    }

    const data = (await response.json()) as { urls?: { regular?: string } };
    return data.urls?.regular || FALLBACK_IMAGE;
  } catch (error) {
    console.error("Unsplash request failed:", error);
    return FALLBACK_IMAGE;
  }
}
