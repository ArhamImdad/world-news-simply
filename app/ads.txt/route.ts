import { adsTxtRecord, readAdsenseRuntimeConfig } from "@/lib/adsense";

export const dynamic = "force-dynamic";

export function GET() {
  const record = adsTxtRecord(readAdsenseRuntimeConfig().clientId);
  if (!record) {
    return new Response("Not configured\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  return new Response(`${record}\n`, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
