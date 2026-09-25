import { createHash } from 'node:crypto';
import { createProject, createTask } from '../contracts/domain.mjs';
import { createEvidence, createReport } from '../contracts/artifacts.mjs';
import { createEvent } from '../contracts/events.mjs';
import { KnowledgeDebtService } from '../../knowledge/knowledge-debt/knowledge-debt-service.mjs';

function event(repositories, input, options) {
  const e=createEvent(input);
  repositories.events.append(e, options);
  return e;
}

function lease(minutes=5){ return new Date(Date.now()+minutes*60*1000).toISOString(); }

function updateTask(repositories, task, patch) {
  const next={...task,...patch,updatedAt:new Date().toISOString()};
  repositories.tasks.save(next);
  return next;
}

function hashText(text){
  return createHash('sha256').update(String(text ?? ''),'utf8').digest('hex');
}

function recoverExistingStart(repositories, started, idempotencyKey){
  const project=repositories.projects.get(started.projectId);
  let task=repositories.tasks.get(started.taskId);
  if(task && !['COMPLETED','FAILED','CANCELLED'].includes(task.status)){
    task=updateTask(repositories,task,{status:'PAUSED',leaseUntil:null});
    event(repositories,{
      type:'TASK_PAUSED',actor:'department-assistant',
      projectId:task.projectId,taskId:task.id,
      payload:{reason:'idempotent-retry-requires-resume'}
    });
  }
  return {project,task,recoveryRequired:true,idempotencyKey};
}

async function collectSourceEvidence({
  claim,
  claimIndex,
  project,
  task,
  runId,
  repositories,
  sourceFetchExecutor
}) {
  const records=[];
  if(!sourceFetchExecutor?.fetch) return records;

  const urls=[...(claim.sourceUrls ?? [])].slice(0,2);
  for(const url of urls){
    const fetched=await sourceFetchExecutor.fetch({
      taskId:task.id,
      runId:`VERIFY-${runId}`,
      url
    });

    if(fetched.status !== 'ok') {
      event(repositories,{
        type:'SOURCE_FETCHED',
        actor:'source-fetcher',
        projectId:project.id,
        taskId:task.id,
        payload:{url,status:fetched.status,reason:fetched.reason ?? fetched.gate?.reason ?? 'unavailable'}
      });
      continue;
    }

    const source=fetched.output;
    const evidence=createEvidence({
      title:`Fetched source for claim ${claimIndex+1}`,
      sourceType:source.sourceType,
      sourceUri:source.url,
      sourceName:source.host,
      trustTier:source.trustTier,
      dataClass:'PUBLIC',
      untrustedInput:true,
      projectId:project.id,
      taskId:task.id,
      fetchedAt:source.fetchedAt,
      fetcherRunId:`VERIFY-${runId}`,
      httpStatus:source.httpStatus,
      contentHash:source.contentHash,
      rawContentPreview:source.rawContentPreview,
      injectionScanResult:source.injectionScanResult,
      metadata:{requestedUrl:source.requestedUrl,claimIndex}
    });
    repositories.evidence.save(evidence);
    records.push(evidence);

    event(repositories,{
      type:'SOURCE_FETCHED',
      actor:'source-fetcher',
      projectId:project.id,
      taskId:task.id,
      payload:{
        evidenceId:evidence.id,
        url:evidence.sourceUri,
        httpStatus:evidence.httpStatus,
        trustTier:evidence.trustTier
      }
    });

    if(source.injectionScanResult?.quarantined){
      event(repositories,{
        type:'INJECTION_SUSPECT',
        actor:'sentinel',
        projectId:project.id,
        taskId:task.id,
        payload:{
          evidenceId:evidence.id,
          sourceUri:evidence.sourceUri,
          flags:source.injectionScanResult.flags
        }
      });
    }
  }
  return records;
}

export async function runProductRndSlice({
  idea,
  repositories,
  decisionPlane,
  researchExecutor,
  sourceFetchExecutor=null,
  verifier,
  actor='user',
  dataClass='INTERNAL',
  idempotencyKey=null
}) {
  if (!idea?.trim()) throw new TypeError('idea is required');
  if (!repositories?.projects || !repositories?.tasks) throw new TypeError('typed repositories are required');
  if (!researchExecutor?.run) throw new TypeError('researchExecutor is required');
  if (!verifier?.verify) throw new TypeError('independent verifier is required');

  if(idempotencyKey){
    const completed=repositories.idempotency.get('product-rnd-result',idempotencyKey);
    if(completed) return completed;
    const started=repositories.idempotency.get('product-rnd-start',idempotencyKey);
    if(started) return recoverExistingStart(repositories,started,idempotencyKey);
  }

  const project=createProject({
    title:`Product R&D: ${idea.slice(0,80)}`,
    goal:'Evaluate market, formulation, cost and compliance opportunity.',
    owner:actor,
    dataClass
  });
  const runId=`RUN-${project.id}`;
  let task=createTask({
    projectId:project.id,
    title:'Product opportunity evaluation',
    request:idea,
    mode:'DELEGATION',
    status:'INTAKE',
    stage:'INTAKE',
    origin:'USER',
    autonomyLevel:'A0',
    risk:'MEDIUM',
    priority:'HIGH',
    dataClass,
    attempt:1,
    runId
  });

  let concurrentStart=null;
  repositories.transaction(tx=>{
    if(idempotencyKey){
      concurrentStart=tx.idempotency.get('product-rnd-start',idempotencyKey);
      if(concurrentStart) return;
    }
    tx.projects.save(project);
    tx.tasks.save(task);
    if(idempotencyKey) tx.idempotency.set('product-rnd-start',idempotencyKey,{projectId:project.id,taskId:task.id});
    event(tx,{type:'TASK_CREATED',actor,projectId:project.id,taskId:task.id,payload:{title:task.title}});
  });
  if(concurrentStart) return recoverExistingStart(repositories,concurrentStart,idempotencyKey);

  task=updateTask(repositories,task,{status:'PLANNED',stage:'PLAN',lastCheckpointStage:'INTAKE'});
  const route=await decisionPlane.route({
    prompt:`Research product opportunity: ${idea}`,
    contextTokens:4000,
    dataClass
  },'balanced');
  event(repositories,{
    type:'ROUTER_RECOMMENDED',
    actor:'department-assistant',
    projectId:project.id,
    taskId:task.id,
    payload:route
  });

  task=updateTask(repositories,task,{
    status:'RUNNING',stage:'EXECUTE',lastCheckpointStage:'PLAN',leaseUntil:lease()
  });
  event(repositories,{
    type:'TASK_STARTED',
    actor:'department-assistant',
    projectId:project.id,
    taskId:task.id,
    payload:{runId}
  });

  const execution=await researchExecutor.run({
    taskId:task.id,
    runId,
    idea,
    context:'Evaluate market, formulation, cost and compliance.',
    dataClass
  });

  if (execution.externalAttempted) {
    event(repositories,{
      type:'EXTERNAL_DISCLOSURE',
      actor:'department-assistant',
      projectId:project.id,
      taskId:task.id,
      payload:{provider:execution.provider.id,dataClass,purpose:'product-rnd-research'}
    });
  }

  let providerError=null;
  let research;
  if (execution.status === 'ok') {
    research=execution.output;
  } else {
    providerError=execution.reason ?? 'research-unavailable';
    research={
      summary:'Specialist research failed or was blocked; no completion is claimed.',
      claims:[],
      unknowns:['Specialist research unavailable'],
      suggestedNextActions:[],
      securityFlags:[],
      quarantinedItems:[]
    };
  }

  if((research.securityFlags ?? []).length){
    event(repositories,{
      type:'INJECTION_SUSPECT',
      actor:'sentinel',
      projectId:project.id,
      taskId:task.id,
      payload:{provider:execution.provider.id,flags:research.securityFlags,quarantinedItems:research.quarantinedItems ?? []}
    });
  }

  const modelEvidenceByClaim=[];
  const sourceEvidenceByClaim=[];
  const allEvidence=[];

  for (const [index,claim] of (research.claims ?? []).entries()) {
    const quarantined=Boolean(claim.quarantined);
    const modelEvidence=createEvidence({
      title:`Consultant claim: ${claim.area ?? 'general'}`,
      sourceType:execution.provider.external ? 'MODEL_OUTPUT' : 'MOCK',
      sourceName:execution.provider.id,
      trustTier:quarantined ? 'QUARANTINED' : 'ADVISORY',
      dataClass,
      untrustedInput:true,
      projectId:project.id,
      taskId:task.id,
      sourceUri:null,
      contentHash:hashText(claim.claim),
      injectionScanResult:{
        quarantined,
        flags:claim.securityFlags ?? []
      },
      metadata:{
        claim:claim.claim,
        sourceUrls:claim.sourceUrls ?? [],
        securityFlags:claim.securityFlags ?? []
      }
    });
    repositories.evidence.save(modelEvidence);
    allEvidence.push(modelEvidence);
    modelEvidenceByClaim[index]=[modelEvidence];

    event(repositories,{
      type:'EVIDENCE_ADDED',
      actor:'department-assistant',
      projectId:project.id,
      taskId:task.id,
      payload:{evidenceId:modelEvidence.id,trustTier:modelEvidence.trustTier}
    });

    if(quarantined){
      sourceEvidenceByClaim[index]=[];
      continue;
    }

    const sourceEvidence=await collectSourceEvidence({
      claim,claimIndex:index,project,task,runId,repositories,sourceFetchExecutor
    });
    sourceEvidenceByClaim[index]=sourceEvidence;
    allEvidence.push(...sourceEvidence);
  }

  const debtService=new KnowledgeDebtService({repositories});
  const debts=[];
  const unknowns=[...(research.unknowns ?? [])];

  if ((research.quarantinedItems ?? []).length) {
    unknowns.push('Some research content was quarantined because it resembled instructions or exfiltration attempts.');
  }
  if (providerError) unknowns.unshift(`Provider failure/block: ${providerError}`);

  for (const topic of research.unknowns ?? []) {
    const {record:debt,merged}=debtService.createOrMerge({
      topic,
      reason:'Product R&D workflow could not verify this point with primary/authoritative evidence.',
      importance:'HIGH',
      projectId:project.id,
      taskId:task.id,
      suggestedExperts:['research-specialist']
    });
    debts.push(debt);
    event(repositories,{
      type:'KNOWLEDGE_DEBT_CREATED',
      actor:'knowledge-steward',
      projectId:project.id,
      taskId:task.id,
      payload:{knowledgeDebtId:debt.id,topic,merged,occurrences:debt.occurrences}
    });
  }

  task=updateTask(repositories,task,{
    status:'VERIFYING',stage:'VERIFY',lastCheckpointStage:'EXECUTE',leaseUntil:lease()
  });

  const safeClaims=(research.claims ?? []).map((claim,index)=>({
    ...claim,
    claimKind:claim.claimKind ?? 'FACT',
    index
  })).filter(claim=>!claim.quarantined);

  const safeModelEvidence=safeClaims.map(c=>modelEvidenceByClaim[c.index] ?? []);
  const safeSourceEvidence=safeClaims.map(c=>sourceEvidenceByClaim[c.index] ?? []);
  let conclusions=verifier.verify({
    claims:safeClaims,
    modelEvidenceByClaim:safeModelEvidence,
    sourceEvidenceByClaim:safeSourceEvidence
  });

  if (!conclusions.length) {
    conclusions=[{
      claim:'No reliable specialist conclusion is available yet.',
      claimKind:'FACT',
      evidenceLevel:'UNKNOWN',
      evidenceIds:[],
      verification:{
        verifierIdentity:verifier.identity ?? 'independent-verifier',
        verifiedAt:new Date().toISOString(),
        sourceCount:0,
        sourceHosts:[],
        note:'No safe claim was available for independent verification.'
      }
    }];
  }

  event(repositories,{
    type:'EVIDENCE_VERIFIED',
    actor:verifier.identity ?? 'independent-verifier',
    projectId:project.id,
    taskId:task.id,
    payload:{
      verifierRunId:`VERIFY-${runId}`,
      levels:conclusions.map(c=>c.evidenceLevel)
    }
  });

  const verifierUnknowns=conclusions
    .filter(c=>c.evidenceLevel==='UNKNOWN')
    .map(c=>`Unverified claim: ${c.claim}`);
  unknowns.push(...verifierUnknowns);

  const supportedCount=conclusions.filter(c=>['SUPPORTED','STRONG','VERIFIED'].includes(c.evidenceLevel)).length;
  const unresolvedCount=conclusions.filter(c=>c.evidenceLevel==='UNKNOWN').length;
  const systemNextActions=[];
  if(providerError) systemNextActions.push('Retry research with an available policy-compliant provider.');
  if(unknowns.length || unresolvedCount) systemNextActions.push('Resolve unresolved evidence gaps using primary or official sources before making irreversible decisions.');
  if(supportedCount) systemNextActions.push('Review the source-backed conclusions and decide whether to continue into supplier, cost and compliance validation.');

  const report=createReport({
    title:`Product opportunity report: ${idea.slice(0,80)}`,
    projectId:project.id,
    taskId:task.id,
    executiveSummary:`Initial evidence review completed: ${supportedCount} claim(s) have independent source support and ${unresolvedCount} remain unresolved.`,
    conclusions,
    decisionsRequired:['Decide whether to continue into deeper evidence-gathering and supplier validation.'],
    risks:[
      'Consultant/model output is advisory and cannot establish verified facts by itself.',
      'Rules-only verification requires an independently fetched trusted source and a verifier-derived support span; it never emits VERIFIED.',
      ...((research.quarantinedItems ?? []).length ? ['Instruction-like external content was quarantined and excluded from conclusions/actions.'] : [])
    ],
    unresolvedQuestions:[...new Set(unknowns)],
    knowledgeDebtIds:[...new Set(debts.map(x=>x.id))],
    nextActions:systemNextActions,
    advisoryNotes:[{
      source:execution.provider.id,
      trust:'UNTRUSTED_ADVISORY',
      summary:research.summary ?? '',
      suggestedNextActions:[...(research.suggestedNextActions ?? [])]
    }],
    verifierRunId:`VERIFY-${runId}`,
    verifierIdentity:verifier.identity ?? 'independent-verifier',
    verifiedAt:new Date().toISOString()
  });
  repositories.reports.save(report);

  task=updateTask(repositories,task,{
    status:'COMPLETED',stage:'REPORT',lastCheckpointStage:'VERIFY',
    reportId:report.id,leaseUntil:null
  });

  event(repositories,{
    type:'ROUTER_OUTCOME_RECORDED',
    actor:'department-assistant',
    projectId:project.id,
    taskId:task.id,
    payload:{
      recommendedModel:route.recommendedModel ?? null,
      selectedModel:route.selectedModel ?? null,
      actualExecutor:execution.provider.id,
      taskStatus:task.status,
      providerError,
      note:'Model routing and expert/provider routing are still separate layers; this event preserves the comparison for later Laya eval.'
    }
  });

  event(repositories,{
    type:'TASK_COMPLETED',
    actor:'department-assistant',
    projectId:project.id,
    taskId:task.id,
    payload:{reportId:report.id,providerError}
  });

  const result={
    project,task,route,report,evidence:allEvidence,
    knowledgeDebt:debts,
    provider:{id:execution.provider.id,error:providerError}
  };
  if(idempotencyKey) repositories.idempotency.set('product-rnd-result',idempotencyKey,result);
  return result;
}
