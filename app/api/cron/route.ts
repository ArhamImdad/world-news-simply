import { fetchWithTimeout } from "@/lib/fetch-timeout";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const fetchNewsUrl = new URL("/api/fetch-news", request.url);
    const response = await fetchWithTimeout(fetchNewsUrl, { cache: "no-store" });
    const result = await response.json().catch(() => null);

    if (!response.ok) {
      return Response.json(
        {
          success: false,
          message: "News fetch failed.",
          details: result,
        },
        { status: response.status }
      );
    }

    return Response.json({
      success: true,
      message: "Cron completed successfully.",
      details: result,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        message: "Cron request failed.",
        error: String(error),
      },
      { status: 500 }
    );
  }
}
