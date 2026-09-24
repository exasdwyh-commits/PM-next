import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import { NotFoundError } from "@/shared/errors";
import { ToolBroker } from "@/modules/governance";
import {
  fetchTrustedSource,
  type FetchedSource,
  type SourceRequest,
  type SourceResolver,
} from "./source-fetcher";
import { classifySourceUrl } from "./source-trust";

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export class SourceFetchExecutor {
  readonly #broker: ToolBroker;
  readonly #organizationId: string;
  readonly #fetcherIdentity: string;

  constructor(input: {
    organizationId: string;
    actorId: string;
    runId: string;
    resolver?: SourceResolver;
    request?: SourceRequest;
  }) {
    this.#organizationId = input.organizationId;
    this.#fetcherIdentity = "independent_verifier";
    this.#broker = new ToolBroker({
      identity: {
        actorId: input.actorId,
        organizationId: input.organizationId,
        agentCode: this.#fetcherIdentity,
        runId: input.runId,
      },
      authorizer: ({ identity, capability, resource }) =>
        identity.agentCode === this.#fetcherIdentity &&
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

  async fetchForEvidence(input: {
    evidenceId: string;
    taskRef: string;
    runId: string;
    url: string;
  }) {
    const evidence = await prisma.evidence.findUnique({
      where: { id: input.evidenceId },
      select: {
        id: true,
        project: { select: { organizationId: true } },
      },
    });
    if (
      !evidence ||
      evidence.project.organizationId !== this.#organizationId
    ) {
      throw new NotFoundError("Evidence not found");
    }

    const fetched = await this.fetch({
      taskRef: input.taskRef,
      runId: input.runId,
      url: input.url,
    });
    const injectionStatus = fetched.injectionScanResult.quarantined
      ? "QUARANTINED"
      : "CLEAN";

    return prisma.$transaction(async (tx) => {
      const capture = await tx.evidenceSourceCapture.create({
        data: {
          evidenceId: evidence.id,
          sourceUri: fetched.url,
          sourceType: fetched.sourceType,
          trustTier: fetched.trustTier,
          sourceOrganization: fetched.sourceOrganization,
          httpStatus: fetched.httpStatus,
          contentHash: fetched.contentHash,
          rawContentPreview: fetched.rawContentPreview,
          injectionStatus,
          injectionFlags: json(fetched.injectionScanResult.flags),
          fetchedAt: new Date(fetched.fetchedAt),
          fetcherIdentity: this.#fetcherIdentity,
          remoteAddress: fetched.remoteAddress,
          contentType: fetched.contentType,
          redirectCount: fetched.redirectCount,
        },
      });

      await tx.evidence.update({
        where: { id: evidence.id },
        data: {
          sourceType: fetched.sourceType,
          trustTier: fetched.trustTier,
          untrustedInput: true,
          fetchedAt: new Date(fetched.fetchedAt),
          sourceOrganization: fetched.sourceOrganization,
          injectionStatus,
          mimeType: fetched.contentType,
        },
      });

      return { fetched, capture };
    });
  }
}
