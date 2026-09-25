import fs from 'node:fs';

function matchResource(pattern, resource) {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) return String(resource).startsWith(pattern.slice(0, -1));
  return pattern === resource;
}

function validApproval(grant, { capability, resource, taskId, actionHash, now = new Date() }) {
  if (!grant) return false;
  if (!grant.approvedBy) return false;
  if (grant.capability !== capability) return false;
  if (grant.taskId && (!taskId || grant.taskId !== taskId)) return false;
  if (!grant.resource || !matchResource(grant.resource, resource)) return false;
  if (grant.actionHash && (!actionHash || grant.actionHash !== actionHash)) return false;
  if (grant.singleUse && grant.usedAt) return false;
  if (grant.validUntil && new Date(grant.validUntil) < now) return false;
  return true;
}

export class CapabilityGateway {
  constructor(path, { auditSink = null } = {}) {
    this.policy = JSON.parse(fs.readFileSync(path, 'utf8'));
    this.audit = [];
    this.auditSink = auditSink;
    this.validatePolicy();
  }

  validatePolicy() {
    for (const capability of this.policy.approvalRequired ?? []) {
      const rules=this.policy.resourceRules?.[capability];
      if (!Array.isArray(rules) || rules.length===0) {
        throw new Error(`policy-resource-rule-required:${capability}`);
      }
    }
  }

  requiresApproval(capability) {
    return (this.policy.approvalRequired ?? []).includes(capability);
  }

  check({
    identity,
    capability,
    resource,
    taskId = null,
    actionHash = null,
    unattended = false,
    approvalGrant = null
  }) {
    if (!identity?.role) throw new TypeError('gateway identity.role is required');
    if (!capability) throw new TypeError('gateway capability is required');
    if (!resource) throw new TypeError('gateway resource is required');

    const { role, actor = 'unknown-user', agent = 'unknown-agent' } = identity;
    const grants = this.policy.roles[role] ?? [];
    const granted = grants.includes('*') || grants.includes(capability);

    const resourceRules = this.policy.resourceRules?.[capability] ?? [];
    const resourceAllowed = resourceRules.some(pattern => matchResource(pattern, resource));
    const approvalRequired = this.requiresApproval(capability);
    const unattendedDenied = unattended && (this.policy.denyUnattended ?? []).includes(capability);
    const approved = !approvalRequired || validApproval(approvalGrant, { capability, resource, taskId, actionHash });

    let allowed = granted && resourceAllowed && !unattendedDenied && approved;
    let reason = 'granted';
    if (!granted) reason = 'capability-not-granted';
    else if (!resourceAllowed) reason = 'resource-not-granted';
    else if (unattendedDenied) reason = 'denied-for-unattended-run';
    else if (!approved) reason = 'approval-grant-required-or-invalid';

    const row = {
      at: new Date().toISOString(), actor, agent, role, capability, resource,
      taskId, unattended, approvalGrantId: approvalGrant?.id ?? null, allowed, reason
    };
    this.audit.push(row);
    this.auditSink?.(row);
    return row;
  }
}
