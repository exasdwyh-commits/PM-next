import { ToolBroker } from "@/modules/governance";
import {
  fetchTrustedSource,
  type FetchedSource,
  type SourceRequest,
  type SourceResolver,
} from "./source-fetcher";
import { classifySourceUrl } from "./source-trust";

export class SourceFetchExecutor {
  readonly #broker: ToolBroker;

  constructor(input: {
    organizationId: string;
    actorId: string;
    runId: string;
    resolver?: SourceResolver;
    request?: SourceRequest;
  }) {
    this.#broker = new ToolBroker({
      identity: {
        actorId: input.actorId,
        organizationId: input.organizationId,
        agentCode: "independent_verifier",
        runId: input.runId,
      },
      authorizer: ({ identity, capability, resource }) =>
        identity.agentCode === "independent_verifier" &&
        capability === "source.fetch" &&
        resource.startsWith("source:"),
      tools: {
        fetch: async (payload: unknown) => {
          const url = String((payload as { url?: unknown })?.url ?? "");
          return fetchTrustedSource({
            url,
            resolver: input.resolver,
            request: input.request,
          });
        },
      },
    });
  }

  async fetch(input: {
    taskRef: string;
    runId: string;
    url: string;
  }): Promise<FetchedSource> {
    const classified = classifySourceUrl(input.url);
    if (!classified.host) throw new Error("invalid-source-url");
    return this.#broker.call({
      tool: "fetch",
      capability: "source.fetch",
      resource: `source:${classified.host}`,
      taskRef: input.taskRef,
      runId: input.runId,
      input: { url: input.url },
    });
  }
}
