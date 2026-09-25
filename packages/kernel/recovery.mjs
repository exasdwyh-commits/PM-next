import { createEvent } from '../contracts/events.mjs';

export function recoverStaleTasks(storage, now = new Date()) {
  const active=new Set(['RUNNING','VERIFYING']);
  const tasks=storage.list('task',{limit:10000});
  const recovered=[];
  for(const task of tasks){
    if(!active.has(task.status)) continue;
    const stale=!task.leaseUntil || new Date(task.leaseUntil) <= now;
    if(!stale) continue;
    const updated={
      ...task,
      status:'PAUSED',
      leaseUntil:null,
      updatedAt:now.toISOString(),
      metadata:{...(task.metadata??{}),recoveryReason:'stale-or-missing-lease'}
    };
    storage.put('task',updated);
    storage.appendEvent(createEvent({
      type:'TASK_PAUSED',
      actor:'runtime-recovery',
      projectId:task.projectId,
      taskId:task.id,
      payload:{reason:'stale-or-missing-lease',previousStatus:task.status}
    }));
    recovered.push(updated);
  }
  return recovered;
}
