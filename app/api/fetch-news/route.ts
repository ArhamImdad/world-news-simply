import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { updateNews } from "@/lib/news-update";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) {
    return Response.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await updateNews();
    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error("News update failed:", error);
    return Response.json(
      { success: false, message: "News update failed." },
      { status: 500 }
    );
  }
}
