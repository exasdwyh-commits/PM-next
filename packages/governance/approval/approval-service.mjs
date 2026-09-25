import { createHmac, timingSafeEqual } from 'node:crypto';
import { createApprovalGrant } from '../../kernel/contracts/artifacts.mjs';

function canonical(grant){
  return JSON.stringify({
    id:grant.id,
    issuer:grant.issuer,
    approvedBy:grant.approvedBy,
    taskId:grant.taskId,
    capability:grant.capability,
    resource:grant.resource,
    actionHash:grant.actionHash,
    singleUse:grant.singleUse,
    issuedAt:grant.issuedAt,
    validUntil:grant.validUntil,
    channel:grant.channel
  });
}

function signatureFor(secret,grant){
  return createHmac('sha256',secret).update(canonical(grant)).digest('hex');
}

export class ApprovalService {
  constructor({storage,secret,principal,issuer='approval-service-v1'}){
    if(!storage?.putApproval || !storage?.getApproval) throw new TypeError('approval storage required');
    if(!secret || String(secret).length < 16) throw new TypeError('approval secret must be at least 16 characters');
    if(!principal) throw new TypeError('approval principal is required');
    this.storage=storage;
    this.secret=String(secret);
    this.principal=principal;
    this.issuer=issuer;
  }

  issue({
    approvedBy,
    taskId,
    capability,
    resource,
    actionHash,
    validUntil,
    channel='local-ui'
  },now=new Date()){
    if(approvedBy !== this.principal) throw new Error('approval-principal-mismatch');
    if(!taskId) throw new Error('approval-task-required');
    if(!actionHash) throw new Error('approval-action-hash-required');
    if(!validUntil || new Date(validUntil) <= now) throw new Error('approval-expiry-required');
    const grant=createApprovalGrant({
      approvedBy,
      taskId,
      capability,
      resource,
      actionHash,
      singleUse:true,
      issuedAt:now.toISOString(),
      validUntil,
      issuer:this.issuer,
      channel
    },now);
    grant.signature=signatureFor(this.secret,grant);
    this.storage.putApproval(grant);
    return grant;
  }

  verify(grant,{taskId,capability,resource,actionHash,now=new Date()}={}){
    if(!grant?.signature || grant.issuer!==this.issuer) return false;
    if(grant.approvedBy!==this.principal) return false;
    if(!grant.singleUse) return false;
    if(!grant.taskId || grant.taskId!==taskId) return false;
    if(grant.capability!==capability || grant.resource!==resource) return false;
    if(!grant.actionHash || grant.actionHash!==actionHash) return false;
    if(!grant.validUntil || new Date(grant.validUntil)<=now) return false;
    if(grant.usedAt) return false;

    const expected=Buffer.from(signatureFor(this.secret,grant),'hex');
    const actual=Buffer.from(String(grant.signature),'hex');
    return expected.length===actual.length && timingSafeEqual(expected,actual);
  }
}
