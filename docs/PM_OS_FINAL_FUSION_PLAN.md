# PM-next × PM OS Final Fusion Plan

Date: 2026-09-24
Target branch: `fusion/pm-os-final`
Source product branch: `release/v0.1.0-rc1`
Reference kernel: `exasdwyh-commits/PM-os-mvp@main`

## 0. Final decision

The final product is **PM-next**.

PM-next remains:
- the only formal repository;
- the only business database;
- the only source of truth for Project/Product/Work/Decision/Workforce/Model provenance;
- the user-facing product.

PM-os-mvp is not merged wholesale. It becomes a reference implementation from which only missing capabilities are absorbed.

The final architecture is:

```text
PM-next UI / Conversation / Voice
              │
              ▼
      Department Assistant
        resident model policy
              │
              ├──── Reflex / Laya
              │       typed System-1 decisions only
              │
              ▼
      PM-next Domain Kernel
 Project / WorkItem / AgentTask / AgentRun
 Research / Evidence / Decision / Knowledge
              │
     ┌────────┼─────────┐
     ▼        ▼         ▼
 Model     Workforce   Tools
Gateway    / Agents
     │        │         │
     └────────┴────┬────┘
                   ▼
        ToolBroker / Sentinel
                   │
        ALLOW / ASK / DENY
                   │
                   ▼
           Side-effecting tools

Research/Evidence output:
Research → Source Fetch → Independent Verifier
        → EvidenceClaim / Verification
        → Artifact / Report
        → Company Knowledge / Data Gap
```

## 1. What MUST stay from PM-next

The following PM-next assets are canonical and must NOT be replaced by PM-os generic equivalents.

### Identity / tenancy
Keep:
- `src/modules/identity/*`
- Organization / User / ProjectMember / System Principal
- current session/RBAC/ownership checks

### Project / task model
Keep canonical:
- `Project`
- `WorkItem` = business/human deliverable
- `AgentTask` = digital-employee unit of work
- `AgentRun` = one execution attempt
- `RunReceipt` = business execution receipt
- `AgentDelegation` = delegation evidence
- `ResearchRun / ResearchRunTask` = research orchestration

Do NOT add PM-os generic `Project` or `Task` tables.

Mapping:

```text
PM OS Project      → PM-next Project
PM OS Task         → WorkItem OR AgentTask depending on semantics
PM OS runId        → AgentRun / RunReceipt
PM OS Delegation   → AgentDelegation
PM OS Report       → Artifact / ResearchRunSnapshot
```

### Product governance
Keep:
- Product / ProductVersion
- ChannelSpecRoute
- PotentialAssessment
- G1/G2/G3
- DecisionPacket / Decision
- scopeHash / revision / CAS behavior

PM OS ApprovalGrant does NOT replace G1/G2/G3.

### Model runtime
Keep:
- `src/modules/model-control/*`
- `src/modules/model-gateway/*`
- ModelProfileConfig
- ModelPolicyConfig
- AgentModelPolicyBinding
- ModelRun provenance
- current explicit fallback/fail-closed rules

Do NOT import PM-os ModelRegistry as a second registry.

### Workforce
Keep:
- `src/modules/workforce/*`
- Agent
- Skill
- Squad
- AgentTask
- AgentRun
- AgentDelegation
- review-return semantics

Do NOT import PM-os mock Workforce.

### Automation
Keep:
- BusinessEvent outbox
- Autopilot
- DecisionRun
- automation causality
- System Principal

### Evaluation / Experience
Keep:
- EvaluationHarness
- FrozenPrediction
- ProductOutcome
- ExperienceLesson
- existing Golden Organization cases

PM-os Golden Eval cases should be absorbed into this evaluation system, not live as a parallel evaluator forever.

## 2. What MUST be absorbed from PM OS

PM-os is valuable mainly for the following missing capabilities.

### A. ToolBroker / Sentinel

Create under PM-next:

```text
src/modules/governance/
  tool-broker.ts
  capability-policy.ts
  approval-service.ts
  action-hash.ts
  tool-registry.ts
```

All side-effecting agent tools must eventually pass this boundary.

First protected capability set:
- external.send
- git.merge
- deploy.production
- database.migrate
- secret.use
- artifact.delete
- filesystem.write outside approved workspace
- shell.exec outside safe test profiles

Important:
PM-next business governance and ToolBroker governance are different layers.

```text
Business decision:
DecisionPacket / G1 G2 G3

Operational permission:
ApprovalGrant / ToolBroker
```

Both may be required for one action.

Example production deploy:

```text
G3 approved
AND
ApprovalGrant(deploy.production, exact target/actionHash)
AND
ToolBroker policy permits
→ deploy
```

### B. ApprovalGrant

Absorb PM-os semantics:
- principal-bound
- task-bound
- resource-bound
- actionHash-bound
- expiration
- single-use
- replay prevention
- integrity signature

Persist using PostgreSQL/Prisma, not PM-os SQLite.

Recommended new table:
`ApprovalGrant`

Do not use `approved: true`.

### C. Epistemic evidence model

PM-next already has:
- Evidence
- EvidenceClaim
- EvidenceVerifyStatus
- FACT / INFERENCE / ASSUMPTION
- DataGap

Do NOT replace these.

Upgrade them.

Keep:
`Evidence.verifyStatus`
as artifact/source verification workflow status.

Add separate claim-support semantics:
- UNKNOWN
- WEAK
- SUPPORTED
- STRONG
- VERIFIED

These meanings must not be conflated.

Recommended additions:

```text
Evidence:
  sourceType
  trustTier
  dataClass
  untrustedInput
  fetchedAt
  sourceOrganization
  injectionStatus

EvidenceClaim:
  evidenceLevel
  freshness
  verifierRunId

EvidenceVerification:
  evidenceClaimId
  verifierIdentity
  supportStatus
  supportSpan
  sourceUri
  sourceOrganization
  checkedAt
  metadata
```

SupportStatus:
- SUPPORTED
- CONTRADICTED
- NOT_FOUND
- AMBIGUOUS

Existing EvidenceClaim.kind stays business-compatible initially.
Do not rename/remove FACT/INFERENCE/ASSUMPTION in the first migration.

If broader PM OS claim kinds are needed later, add a separate epistemic field and migrate deliberately.

### D. Source Fetcher

Create:
`src/modules/research/source-fetch/*`

Absorb the hardened PM-os rules:
- HTTPS-only
- explicit source host registry
- DNS resolution before connection
- reject private/loopback/link-local/metadata/reserved IPs
- pin connection to approved IP
- verify actual remote address
- validate redirect at every hop
- MIME allowlist
- reject compressed/binary/empty content initially
- size limits
- prompt-injection scan
- quarantine state

This is a read-only verifier capability.

It must use ToolBroker with a dedicated verifier identity/capability.

### E. Independent Evidence Verifier

Create:
`src/modules/evidence/verifier/*`

Rules:
- Research Agent cannot verify its own claim.
- caller-supplied trustTier is never authoritative.
- source URL must be reclassified by verifier.
- model-only claim remains UNKNOWN.
- source fetchability alone does not mean support.
- verifier must derive a support span or semantic support record.
- two URLs from the same organization are not independent evidence.
- rules-only verifier never produces VERIFIED.

First version:
- deterministic/source-span verifier
- conservative UNKNOWN bias

Second version:
- semantic claim ↔ source support checker
- contradiction detection
- quote/span provenance

### F. Generic Knowledge Debt

PM-next already has `DataGap`.

Keep DataGap for structured product/research field gaps.

Add `KnowledgeDebt` only for broader reusable organizational knowledge gaps.

```text
DataGap
= project/business field missing
example: competitor sale price missing

KnowledgeDebt
= reusable knowledge deficiency
example: current AKG China regulatory basis is unresolved
```

They are related but not duplicates.

KnowledgeDebt fields:
- organizationId
- projectId?
- normalizedKey
- topic
- reason
- importance
- occurrences
- lastSeenAt
- status
- suggestedExpertClass
- resolvedByEvidenceId?
- relatedDataGapId?

First version uses deterministic normalized-key dedup.
Semantic-near-duplicate merge remains suggestion-only until validated.

## 3. Department Assistant: replace the old "Advisor as product identity"

The current Advisor remains useful as:
- conversation persistence
- product-bound conversations
- deterministic read tools
- proposal mechanism
- UI/API surface

But it should no longer be the architectural center.

Create:
`src/modules/assistant-runtime/`

Suggested files:

```text
assistant-runtime/
  service.ts
  context-builder.ts
  planner.ts
  synthesizer.ts
  contracts.ts
  execution-policy.ts
```

Responsibilities:

```text
Understand
→ recover project/company context
→ ask Reflex for bounded routing decisions
→ choose direct / research / delegation / executive mode
→ create/reuse WorkItem / AgentTask / ResearchRun
→ supervise
→ request verification
→ synthesize final report
→ update project memory / gaps
```

Existing `src/modules/advisor/*` becomes:
- legacy compatibility adapter;
- conversation/proposal utility;
- migration source.

Do not rewrite all Advisor pages immediately.

API can remain while backend route moves to DepartmentAssistantService.

## 4. Muse placement

Muse Glimmer is NOT a second Agent OS.

Muse is a model resource inside existing Model Control + Model Gateway.

Recommended preset:

```text
ModelProfile:
  key: muse-glimmer-local
  provider: muse-local
  locality: LOCAL
  costTier: FIXED_LOCAL
  capabilities:
    TEXT
    TOOLS
    STRUCTURED_OUTPUT
    REASONING
    LONG_CONTEXT
```

Add/extend task classes:

```text
ASSISTANT_DIALOGUE
ASSISTANT_PLANNING
ASSISTANT_SYNTHESIS
```

Recommended default policy:

```text
Department Assistant routine:
1. Muse Glimmer local
2. explicitly configured fast/cloud fallback if data policy allows

High-value strategy:
1. frontier reasoning policy
2. Muse local fallback

Private confidential:
local-only policy
```

Muse's role:
- resident conversational brain
- planning
- context interpretation
- orchestration
- synthesis

Muse must NOT:
- grant permission
- mark evidence VERIFIED
- bypass ToolBroker
- directly modify business facts
- directly execute G1/G2/G3 decisions

If Muse is unavailable, Model Gateway substitutes another policy-compliant model.
The product identity remains "Department Assistant", not "Muse".

## 5. Laya placement

Laya should NOT be implemented as another chat model.

PM-next already has the correct extension point:
`src/modules/decision-intelligence/`

Add:
`LayaDecisionEngine`

Extend DecisionRunEngineKind later from:

```text
RULES
MODEL
```

to a compatible form such as:

```text
RULES
SYSTEM1
MODEL
```

or retain MODEL in DB first and store engineVersion/provider metadata until migration is safe.

Laya handles bounded typed decisions such as:

```text
assistant.intent
assistant.complexity
assistant.requires_research
assistant.expert_class
assistant.project_match
assistant.urgency
assistant.proactive_value
assistant.risk_hint
assistant.route_tier
```

Laya output must flow through existing:
- DecisionSpec
- DecisionRun
- benchmark/calibration
- Policy Gate
- escalation

This is a much better fit than adding an independent "Laya router service".

Laya never:
- writes product data;
- executes tools;
- decides regulatory truth;
- approves spending;
- approves G1/G2/G3;
- grants itself permissions.

If Laya is uncertain or unavailable:
- fallback to deterministic rules or Department Assistant model;
- record disagreement/outcome for calibration.

## 6. Model architecture after fusion

Do not maintain two registries.

Final intelligence stack:

```text
Model Control Center
│
├─ Reflex Resource
│    └─ Laya (via Decision Intelligence, not text generation)
│
├─ Resident Assistant
│    └─ Muse Glimmer local
│
├─ Frontier
│    ├─ GPT
│    ├─ Claude
│    └─ Muse Spark / other approved models
│
├─ Coding
│    ├─ Codex
│    └─ MiMo Pro as optional worker/reviewer
│
└─ Research
     ├─ specialist search providers
     └─ domain-specific adapters
```

Model Gateway remains the canonical generative-model runtime.

Decision Intelligence remains the canonical typed-decision runtime.

## 7. Workforce after fusion

Keep PM-next Workforce.

Seed/rename the current leader concept:

```text
hermes_pm
→ department_assistant / product_rnd_director
```

Do not force a database rename in the first migration if it risks compatibility.

Recommended digital employees:
- product_research
- market_research
- scientific_evidence
- compliance
- cost_bom
- supply_chain
- software_engineer
- qa_verifier

These are Agent records + Skills + ModelPolicy bindings.

The Department Assistant is the stable manager identity.
Models behind agents remain replaceable.

## 8. Autopilot / Proactive Engine

Do NOT import PM-os Proactive Engine as a second scheduler.

Use existing:
- BusinessEvent
- Autopilot
- DecisionRun
- AgentTask
- System Principal

Upgrade candidate-generation sources:

```text
Business Events
DataGap
KnowledgeDebt
stale Evidence
stale CompanyFact
overdue WorkItem
WAITING_HUMAN
failed AgentTask
upcoming milestone
outcome check
```

Flow:

```text
candidate events
→ Laya/Decision Intelligence ranking
→ Policy Gate
→ A1 suggestion
→ later A2 safe execution
```

A1 first.

## 9. Knowledge architecture

Keep:
- KnowledgeSource
- KnowledgeDocument
- KnowledgeChunk
- CompanyFact
- ExperienceLesson

Upgrade promotion flow:

```text
raw source
→ Evidence
→ EvidenceClaim
→ Independent Verifier
→ Knowledge promotion proposal
→ human/policy approval
→ CompanyFact / reusable knowledge
```

CompanyFact must not be directly populated from model opinion.

Existing manual confirmation remains valid.

## 10. Report architecture

Do NOT create a parallel PM-os Report table.

Use `Artifact`.

Introduce artifact types such as:
- PRODUCT_RND_EXECUTIVE_REPORT
- RESEARCH_REPORT
- VERIFICATION_REPORT
- RED_TEAM_REPORT

Structured content should include:

```text
executiveSummary
conclusions[]
  claim
  claimKind
  evidenceLevel
  evidenceRefs
  verificationRefs
risks[]
unknowns[]
decisionsRequired[]
nextActions[]
knowledgeDebtRefs[]
advisoryNotes[]
modelRunRefs[]
agentRunRefs[]
```

Untrusted model advice stays inside `advisoryNotes`.
It never becomes executable nextActions directly.

## 11. What to remove / retire gradually

Do not delete these immediately. Mark legacy first.

### Advisor direct model path
`src/modules/advisor/llm.ts`

Current direct OpenAI-compatible LLM path should ultimately be retired.

All generative model calls must route through Model Gateway.

### Advisor intent regex router
Current deterministic intent router remains temporary fallback.

Department Assistant + Laya/Decision Intelligence becomes the final routing path.

### PM-os SQLite runtime
Do not migrate.

PostgreSQL/Prisma is the final persistence layer.

### PM-os generic Project/Task tables
Do not migrate.

### PM-os Model Registry
Do not migrate.

### PM-os mock Workforce
Do not migrate.

### PM-os standalone HTTP server
Do not migrate.

## 12. Schema migration order

### Migration F1 — governance/evidence only
Add:
- ApprovalGrant
- EvidenceVerification
- generic KnowledgeDebt
- evidence epistemic/provenance fields
- optional dataClass fields where needed

Do NOT alter Project/WorkItem/AgentTask identity semantics.

### Migration F2 — assistant/reflex provenance
Add only fields/tables needed for:
- AssistantSession/AssistantRun if AgentRun cannot carry all metadata
- Reflex/DecisionRun telemetry extensions
- router outcome fields if necessary

Prefer extending AgentRun/DecisionRun before creating new tables.

### Migration F3 — later runtime
Only when background daemon/parallel workers require:
- stronger leases
- resumable checkpoints
- workspace runtime
- browser/computer worker

## 13. First vertical slice to implement

The first acceptance path:

```text
User:
"开发一个女性餐前轻体饮，市场、配方、成本、法规一起看"

Conversation
→ DepartmentAssistantService
→ Laya/Decision Intelligence classifies
→ existing Project selected/created
→ existing WorkItem created
→ existing AgentTasks delegated
→ Model Gateway executes configured experts
→ ResearchRun / Evidence created
→ Source Fetcher obtains trusted sources
→ Independent Verifier records claim support
→ DataGap + KnowledgeDebt created as needed
→ executive Artifact created
→ Department Assistant synthesizes response
→ user sees one report and decision points
```

No raw multi-agent transcript by default.

## 14. Acceptance requirements

A fusion build is NOT accepted unless:

1. one PostgreSQL database is the only durable source of truth;
2. no second Project/Task/Model registry exists;
3. every new generative call uses Model Gateway;
4. Laya runs through Decision Intelligence and DecisionRun provenance;
5. Muse is a ModelProfile/Policy resource, not a hard-coded dependency;
6. side-effecting tools use ToolBroker;
7. protected actions require ApprovalGrant when applicable;
8. Research cannot self-verify;
9. official URL with unrelated content remains UNKNOWN;
10. model-only claim remains UNKNOWN;
11. model advisory text cannot become executable action automatically;
12. G1/G2/G3 semantics remain unchanged;
13. old PM-next test/CI matrix remains green;
14. PM-os security/evidence regression cases are ported into PM-next tests;
15. final UI defaults to one Department Assistant experience.

## 15. Implementation order

### Phase 1 — architecture freeze
- add this document;
- create module boundaries;
- no UI rewrite;
- no data migration beyond additive schema.

### Phase 2 — governance/evidence port
- ToolBroker
- ApprovalService
- Source Fetch
- Verifier
- evidence epistemic fields
- regression tests

### Phase 3 — assistant runtime
- DepartmentAssistantService
- context builder
- reuse Conversation
- reuse WorkItem/AgentTask
- Model Gateway only

### Phase 4 — Laya reflex
- LayaDecisionEngine
- typed DecisionSpecs
- shadow mode
- DecisionRun telemetry
- compare against deterministic/current routing
- no active routing until eval passes

### Phase 5 — Muse resident policy
- provider adapter
- ModelProfile preset
- assistant policies
- local/private routing
- fallback policy

### Phase 6 — product R&D vertical slice
- full end-to-end integration
- executive Artifact
- report UI

### Phase 7 — proactive A1
- existing Autopilot + new candidate sources
- Laya ranking
- suggestion only

### Phase 8 — legacy retirement
- remove direct Advisor LLM path
- retire legacy routing where replaced
- archive PM-os-mvp as reference

## 16. Explicit non-goals for the fusion

Do not:
- git-merge the two repositories;
- create another task system;
- create another model gateway;
- create another workforce kernel;
- create another scheduler;
- move PM-next back to SQLite;
- make Muse a permanent hard-coded brain;
- give Laya tool permissions;
- expose raw agent topology as the default UX;
- enable A2 proactive execution before verifier/governance/eval are stable.

## 17. Final product identity

The product should no longer present itself architecturally as "many agents".

The user experience is:

```text
Department Assistant

conversation
+ projects
+ reports
+ approvals
+ schedule
+ notifications

advanced drill-down:
evidence / agent work / model provenance / audit
```

Internally:

```text
Laya = fast reflex
Muse = default resident reasoning resource
PM-next Domain = business truth
PM OS governance/evidence = safety + truthfulness upgrade
Workforce = digital employees
Model Gateway = intelligence resource control
Decision Intelligence = typed-decision control
Autopilot = proactive scheduler
ToolBroker = action authority
Verifier = factual authority
Human = final business authority
```

This is the final fusion target.
