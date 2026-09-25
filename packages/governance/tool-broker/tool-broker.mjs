export class ToolBroker {
  #gateway;
  #identity;
  #storage;
  #tools;
  #approvalService;

  constructor({ gateway, identity, storage, tools = {}, approvalService = null }) {
    if (!identity?.role) throw new TypeError('ToolBroker requires a runtime-bound identity');
    if (!storage) throw new TypeError('ToolBroker requires durable storage');
    this.#gateway = gateway;
    this.#identity = Object.freeze({ ...identity });
    this.#storage = storage;
    this.#tools = Object.freeze({ ...tools });
    this.#approvalService = approvalService;
  }

  get identity() { return { ...this.#identity }; }

  async call({
    tool,
    capability,
    resource,
    taskId = null,
    runId = null,
    actionHash = null,
    unattended = false,
    approvalGrantId = null,
    input
  }) {
    const fn = this.#tools[tool];
    if (!fn) return { status: 'blocked', reason: 'tool-not-registered' };
    if (!resource) return { status:'blocked', reason:'resource-required' };

    const approvalGrant = approvalGrantId ? this.#storage.getApproval(approvalGrantId) : null;
    if(this.#gateway.requiresApproval(capability)){
      if(!this.#approvalService) return {status:'blocked',reason:'approval-service-required'};
      const integrityOk=this.#approvalService.verify(approvalGrant,{
        taskId,capability,resource,actionHash
      });
      if(!integrityOk) return {status:'blocked',reason:'approval-integrity-invalid'};
    }

    const gate = this.#gateway.check({
      identity: this.#identity,
      capability,
      resource,
      taskId,
      actionHash,
      unattended,
      approvalGrant
    });
    if (!gate.allowed) return { status: 'blocked', gate };

    if (this.#gateway.requiresApproval(capability) && approvalGrant?.singleUse) {
      const consumed=this.#storage.consumeApproval(approvalGrant.id, runId ?? taskId);
      if (!consumed) return {
        status:'blocked',
        gate:{...gate,allowed:false,reason:'approval-grant-already-consumed'}
      };
    }

    const output = await fn(input);
    return { status: 'ok', gate, output };
  }
}
