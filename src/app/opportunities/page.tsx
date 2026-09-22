import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSessionFromContext } from "@/modules/identity/session";
import { listOrganizationSignals, listAvailableSources } from "@/modules/signal/manual-signal";
import { getRuntimeStatus } from "@/shared/runtime-status";
import { toSessionView } from "@/shared/session-view";
import OpportunitiesClient from "./opportunities-client";
import { mapAutomationTracesByAggregate } from "@/modules/automation-trace";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  const headerList = await headers();
  const cookieStore = await cookies();

  let session: any = null;
  try {
    session = await getServerSessionFromContext(headerList, cookieStore);
  } catch {
    redirect("/login");
  }

  const [signals, sources] = await Promise.all([
    listOrganizationSignals(session),
    listAvailableSources(),
  ]);
  const automationTraces = await mapAutomationTracesByAggregate(
    session,
    "SignalItem",
    signals.map((signal) => signal.id)
  );

  return (
    <OpportunitiesClient
      signals={JSON.parse(JSON.stringify(signals))}
      sources={JSON.parse(JSON.stringify(sources))}
      automationTraces={JSON.parse(JSON.stringify(automationTraces))}
      currentSession={toSessionView(session)}
      runtime={getRuntimeStatus()}
    />
  );
}
