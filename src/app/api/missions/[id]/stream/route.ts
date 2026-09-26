/**
 * GET /api/missions/[id]/stream — Server-Sent Events for the 「过程」 timeline.
 *
 * Polls the append-only event table (1s) so it works across worker processes
 * without a pub/sub dependency. Resumes from `Last-Event-ID` (or ?after=).
 * Heartbeat every 15s; closes when the mission is terminal and drained, or
 * after 5 minutes (EventSource reconnects automatically with Last-Event-ID).
 */
import { NextRequest } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { assertMissionOwner, formatSseEvent, listMissionEventsUnchecked } from "@/modules/supervisor";
import { handleApiError } from "@/shared/api-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_MS = 1000;
const HEARTBEAT_MS = 15_000;
const MAX_MS = 5 * 60_000;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  let id: string;
  try {
    session = await getServerSession(req);
    id = (await params).id;
    await assertMissionOwner(session, id);
  } catch (error) {
    return handleApiError(error, req);
  }
  const orgId = session.organizationId;
  const s = session;
  const header = req.headers.get("last-event-id") ?? req.nextUrl.searchParams.get("after") ?? "0";
  let cursor = Math.max(0, Number.parseInt(header, 10) || 0);
  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastBeat = Date.now();
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", close);
      controller.enqueue(encoder.encode(`retry: 2000\n: connected\n\n`));
      while (!closed) {
        try {
          const events = await listMissionEventsUnchecked(orgId, id, cursor);
          for (const e of events) {
            controller.enqueue(encoder.encode(formatSseEvent(e)));
            cursor = e.seq;
          }
          if (!events.length) {
            const { finished } = await assertMissionOwner(s, id);
            if (finished) {
              controller.enqueue(encoder.encode(`event: end\ndata: {"lastSeq":${cursor}}\n\n`));
              break;
            }
          }
          if (Date.now() - lastBeat > HEARTBEAT_MS) {
            controller.enqueue(encoder.encode(`: heartbeat\n\n`));
            lastBeat = Date.now();
          }
          if (Date.now() - startedAt > MAX_MS) break;
        } catch {
          break;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
