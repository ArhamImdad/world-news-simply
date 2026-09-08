import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { replenishReadyQueue } from "@/lib/news-update";
import { assertCronExecutionAllowed, LocalOperationRefusedError } from "@/lib/environment-isolation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertCronExecutionAllowed();
  } catch (error) {
    if (error instanceof LocalOperationRefusedError) {
      return Response.json({ success: false, message: "News generation is disabled in local mode." }, { status: 403 });
    }
    throw error;
  }
  if (!(await isAuthorizedCronRequest(request))) {
    return Response.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await replenishReadyQueue(undefined, [], { signal: request.signal });
    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error("News update failed:", error);
    return Response.json(
      { success: false, message: "News update failed." },
      { status: 500 }
    );
  }
}
