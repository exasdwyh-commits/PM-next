import { ToolBroker } from '../../governance/tool-broker/tool-broker.mjs';

export class ResearchExecutor {
  #provider;
  #broker;

  constructor({ gateway, storage, provider, actor = 'system-user' }) {
    if (!provider?.id || typeof provider.research !== 'function') throw new TypeError('research provider is required');
    this.#provider = provider;
    this.#broker = new ToolBroker({
      gateway,
      storage,
      identity: { role:'RESEARCH', actor, agent:'research-worker' },
      tools: { research: input => provider.research(input) }
    });
  }

  async run({ taskId, runId = null, idea, context = '', dataClass = 'INTERNAL' }) {
    if (!(this.#provider.allowedDataClasses ?? ['PUBLIC']).includes(dataClass)) {
      return {
        status:'blocked',
        provider:{ id:this.#provider.id, external:Boolean(this.#provider.external) },
        reason:`provider-not-allowed-for-data-class:${dataClass}`,
        externalAttempted:false
      };
    }

    const resource=`provider:${this.#provider.id}`;
    try {
      const result=await this.#broker.call({
        tool:'research',
        capability:'research.run',
        resource,
        taskId,
        runId,
        input:{idea,context}
      });
      if (result.status !== 'ok') {
        return {
          status:'blocked',
          provider:{ id:this.#provider.id, external:Boolean(this.#provider.external) },
          reason:result.gate?.reason ?? result.reason ?? 'research-blocked',
          externalAttempted:false,
          gate:result.gate ?? null
        };
      }
      return {
        status:'ok',
        provider:{ id:this.#provider.id, external:Boolean(this.#provider.external) },
        output:result.output,
        externalAttempted:Boolean(this.#provider.external),
        gate:result.gate
      };
    } catch (error) {
      return {
        status:'failed',
        provider:{ id:this.#provider.id, external:Boolean(this.#provider.external) },
        reason:error.message,
        externalAttempted:Boolean(this.#provider.external)
      };
    }
  }
}
