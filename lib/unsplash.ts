import { fetchWithTimeout } from "@/lib/fetch-timeout";

const FALLBACK_IMAGE = "/og-default.svg";

export async function getUnsplashImage(query: string) {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;

  if (!accessKey) {
    return FALLBACK_IMAGE;
  }

  try {
    const response = await fetchWithTimeout(
      `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=landscape`,
      { headers: { Authorization: `Client-ID ${accessKey}` } }
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
