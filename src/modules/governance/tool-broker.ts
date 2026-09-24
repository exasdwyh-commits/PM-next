import {
  PROTECTED_CAPABILITIES,
  denyAllCapabilities,
  type CapabilityAuthorizer,
  type ToolIdentity,
} from "./capability-policy";
import type { ApprovalService } from "./approval-service";

export class ToolBrokerDeniedError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "ToolBrokerDeniedError";
  }
}

type ToolHandler<I = unknown, O = unknown> = (input: I) => Promise<O>;

export class ToolBroker {
  readonly #tools: Readonly<Record<string, ToolHandler>>;
  readonly #identity: ToolIdentity;
  readonly #authorizer: CapabilityAuthorizer;
  readonly #approvalService: ApprovalService | null;

  constructor(input: {
    identity: ToolIdentity;
    tools: Record<string, ToolHandler>;
    authorizer?: CapabilityAuthorizer;
    approvalService?: ApprovalService | null;
  }) {
    this.#identity = Object.freeze({ ...input.identity });
    this.#tools = Object.freeze({ ...input.tools });
    this.#authorizer = input.authorizer ?? denyAllCapabilities;
    this.#approvalService = input.approvalService ?? null;
  }

  async call<I, O>(request: {
    tool: string;
    capability: string;
    resource: string;
    taskRef: string;
    runId: string;
    input: I;
    actionHash?: string | null;
    approvalGrantId?: string | null;
  }): Promise<O> {
    const handler = this.#tools[request.tool] as ToolHandler<I, O> | undefined;
    if (!handler) throw new ToolBrokerDeniedError("tool-not-registered");

    const allowed = await this.#authorizer({
      identity: this.#identity,
      capability: request.capability,
      resource: request.resource,
      taskRef: request.taskRef,
    });
    if (!allowed) throw new ToolBrokerDeniedError("capability-denied");

    if (PROTECTED_CAPABILITIES.has(request.capability as never)) {
      if (!this.#approvalService) {
        throw new ToolBrokerDeniedError("approval-service-required");
      }
      if (!request.approvalGrantId || !request.actionHash) {
        throw new ToolBrokerDeniedError("approval-grant-required");
      }
      try {
        await this.#approvalService.consume(request.approvalGrantId, {
          organizationId: this.#identity.organizationId,
          taskRef: request.taskRef,
          capability: request.capability,
          resource: request.resource,
          actionHash: request.actionHash,
          runId: request.runId,
        });
      } catch {
        throw new ToolBrokerDeniedError("approval-grant-invalid");
      }
    }

    return handler(request.input);
  }
}
