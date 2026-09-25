import { ToolBroker } from '../../governance/tool-broker/tool-broker.mjs';
import { fetchSource } from './source-fetcher.mjs';
import { classifySourceUrl } from './source-trust.mjs';

export class SourceFetchExecutor {
  #broker;

  constructor({gateway,storage,actor='principal',resolver,requestImpl}) {
    this.#broker=new ToolBroker({
      gateway,
      storage,
      identity:{role:'VERIFIER',actor,agent:'source-fetcher'},
      tools:{fetchSource:input=>fetchSource({...input,resolver,requestImpl})}
    });
  }

  async fetch({taskId,runId,url}) {
    const classified=classifySourceUrl(url);
    if(!classified.host) return {status:'blocked',reason:'invalid-source-url'};
    if(!['OFFICIAL','PRIMARY','REPUTABLE'].includes(classified.trustTier)){
      return {
        status:'blocked',
        reason:'source-domain-not-allowlisted',
        source:{host:classified.host,trustTier:classified.trustTier}
      };
    }
    try {
      return await this.#broker.call({
        tool:'fetchSource',
        capability:'source.fetch',
        resource:`source:${classified.host}`,
        taskId,
        runId,
        input:{url}
      });
    } catch (error) {
      return {status:'failed',reason:error.message};
    }
  }
}
