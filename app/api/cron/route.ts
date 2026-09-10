import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { replenishReadyQueue, runPublicationCycle } from "@/lib/news-update";
import { publicationSlotAt } from "@/lib/publication-queue";
import { assertCronExecutionAllowed, LocalOperationRefusedError } from "@/lib/environment-isolation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertCronExecutionAllowed();
  } catch (error) {
    if (error instanceof LocalOperationRefusedError) {
      return Response.json({ success: false, message: "Cron execution is disabled in local mode." }, { status: 403 });
    }
    throw error;
  }
  if (!(await isAuthorizedCronRequest(request))) {
    return Response.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    if (url.searchParams.get("mode") === "replenish") {
      const result = await replenishReadyQueue(undefined, [], { signal: request.signal });
      return Response.json({ success: true, message: "Queue replenishment completed.", replenishment: result });
    }
    const rawScheduledTime = url.searchParams.get("scheduledTime");
    const scheduledTime = rawScheduledTime?.trim() ? Number(rawScheduledTime) : NaN;
    const requestedSlot = Number.isFinite(scheduledTime) && scheduledTime > 0 ? new Date(scheduledTime) : new Date();
    const result = await runPublicationCycle(publicationSlotAt(requestedSlot), request.signal);
    return Response.json({ success: true, message: "Autonomous publication cycle completed.", ...result });
  } catch (error) {
    console.error("Scheduled news update failed:", error);
    return Response.json(
      { success: false, message: "Scheduled news update failed." },
      { status: 500 }
    );
  }
}
