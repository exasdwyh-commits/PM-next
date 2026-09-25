export class MemoryStorage {
  constructor() {
    this.records = new Map();
    this.events = [];
    this.audit = [];
    this.approvals = new Map();
    this.idempotency = new Map();
    this.meta = new Map();
  }
  key(kind,id){ return `${kind}:${id}`; }
  put(kind,record){ this.records.set(this.key(kind,record.id),structuredClone(record)); return record; }
  get(kind,id){ const v=this.records.get(this.key(kind,id)); return v ? structuredClone(v) : null; }
  list(kind,{projectId=null,taskId=null,status=null,limit=100}={}){
    return [...this.records.entries()]
      .filter(([k])=>k.startsWith(`${kind}:`)).map(([,v])=>v)
      .filter(v=>!projectId||v.projectId===projectId)
      .filter(v=>!taskId||v.taskId===taskId)
      .filter(v=>!status||v.status===status)
      .slice(-limit).reverse().map(v=>structuredClone(v));
  }
  transaction(fn){ return fn(this); }
  appendEvent(event,{idempotencyKey=null}={}){
    if(idempotencyKey){
      const existing=this.getIdempotent('event',idempotencyKey);
      if(existing) return existing;
    }
    this.events.push(structuredClone(event));
    if(idempotencyKey) this.setIdempotent('event',idempotencyKey,event);
    return event;
  }
  listEvents({taskId=null,correlationId=null,limit=200}={}){
    return this.events.filter(e=>!taskId||e.taskId===taskId)
      .filter(e=>!correlationId||e.correlationId===correlationId)
      .slice(-limit).map(e=>structuredClone(e));
  }
  appendAudit(entry){ this.audit.push(structuredClone(entry)); return entry; }
  listAudit(limit=200){ return this.audit.slice(-limit).reverse().map(e=>structuredClone(e)); }
  putApproval(grant){ this.approvals.set(grant.id,structuredClone(grant)); return grant; }
  getApproval(id){ const v=this.approvals.get(id); return v?structuredClone(v):null; }
  consumeApproval(id,runId,usedAt=new Date().toISOString()){
    const grant=this.approvals.get(id);
    if(!grant) return null;
    if(!grant.singleUse) return structuredClone(grant);
    if(grant.usedAt) return null;
    grant.usedAt=usedAt; grant.usedByRunId=runId??null;
    this.approvals.set(id,grant);
    return structuredClone(grant);
  }
  setIdempotent(namespace,key,result){ this.idempotency.set(`${namespace}:${key}`,structuredClone(result)); return result; }
  getIdempotent(namespace,key){ const v=this.idempotency.get(`${namespace}:${key}`); return v?structuredClone(v):null; }
  setMeta(key,value){ this.meta.set(key,structuredClone(value)); }
  getMeta(key){ const v=this.meta.get(key); return v===undefined?null:structuredClone(v); }
  close(){}
}
