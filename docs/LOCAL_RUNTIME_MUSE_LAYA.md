# Local Runtime — Muse Glimmer + Laya

Date: 2026-09-24
Target: PM-next final fusion architecture

## 1. Runtime roles

The final system has one product identity: **Department Assistant**.

Muse and Laya are replaceable runtime resources:

```text
User
 ↓
Department Assistant
 ├─ Laya: System-1 typed reflex, shadow first
 └─ Muse Glimmer: local resident generative model
 ↓
PM-next domain/workforce/research/governance
```

They do not own business truth and do not bypass PM-next.

### Muse
Muse Glimmer is a local ModelProfile used by existing Model Control / Model Gateway.

Default preset:
- profile key: `muse-glimmer-resident-slot`
- provider: `muse-local`
- model id: `muse-glimmer`
- locality: LOCAL
- enabled: false by default

Policies:
- `ASSISTANT_DIALOGUE`
- `ASSISTANT_PLANNING`
- `ASSISTANT_SYNTHESIS`

If Muse is disabled or unavailable, PM-next remains functional. Model Gateway continues to fail closed according to the installed policy rather than silently sending private work to another cloud model.

### Laya
Laya is a System-1 typed decision resource integrated through Decision Intelligence.

It currently evaluates, in one batched request:
- `assistant.intent`
- `assistant.complexity`
- `assistant.requires_research`
- `assistant.expert_class`
- `assistant.proactive_value`

Laya is **shadow-only**. Every result is persisted through DecisionRun / PolicyGate, but all assistant reflex specs have `autoPolicy=DISABLED`.

A Laya confidence value is routing/classification confidence only. It is never evidence confidence.

## 2. Environment

Copy `.env.example` to the local environment and configure only the runtimes you actually use.

### Approval service

```env
PM_OS_APPROVAL_HMAC_SECRET=<random secret, at least 32 characters>
```

This is required when protected ToolBroker capabilities are used.

### Laya

Recommended initial deployment is local-only:

```env
LAYA_BASE_URL=http://127.0.0.1:8000
LAYA_API_KEY=
LAYA_MODEL=typed-decisions
LAYA_TIMEOUT_MS=1500
LAYA_ALLOW_REMOTE=false
```

PM-next calls:

```text
POST {LAYA_BASE_URL}/v1/systemone
```

Expected contract:
- one `state`
- multiple typed `questions`
- response `answers`

If `LAYA_BASE_URL` is absent:
- chat continues normally;
- reflex mode is recorded as `SHADOW_UNCONFIGURED`;
- no fake Laya result is generated.

If Laya fails:
- chat continues normally;
- reflex mode becomes `SHADOW_FAILED`;
- failure reason is recorded in AgentRun context;
- no operational action is authorized by the failed reflex.

Remote Laya is intentionally blocked unless `LAYA_ALLOW_REMOTE=true`. Enabling it should be treated as a data-policy decision.

### Muse Glimmer

PM-next uses the existing OpenAI-compatible Model Gateway provider runtime.

Example local configuration:

```env
MODEL_PROVIDER_MUSE_LOCAL_BASE_URL=http://127.0.0.1:8080/v1
MODEL_PROVIDER_MUSE_LOCAL_API_KEY=
MODEL_PROVIDER_MUSE_LOCAL_TIMEOUT_MS=30000
MODEL_PROVIDER_MUSE_LOCAL_MAX_TOKENS=2048
MODEL_PROVIDER_MUSE_LOCAL_TEMPERATURE=0.2
```

Run Muse through a local runtime that exposes an OpenAI-compatible chat-completions endpoint. On a Mac, a Metal-enabled llama.cpp deployment is the preferred initial path.

The runtime model alias should match the configured ModelProfile `modelId` or be mapped by the local gateway.

After the local endpoint is healthy:
1. open Model Control;
2. install/update the official preset if needed;
3. enable `muse-glimmer-resident-slot`;
4. keep the assistant resident policies local-only;
5. run a normal Department Assistant message;
6. confirm the resulting ModelRun provider/model provenance.

Do not enable a cloud fallback merely to hide a broken local setup.

## 3. Startup order

Recommended local startup:

```text
PostgreSQL
 ↓
PM-next migrations / Prisma
 ↓
optional Laya local server
 ↓
optional Muse local OpenAI-compatible server
 ↓
PM-next
```

The application must still start when Laya and Muse are both absent.

## 4. Verification checklist

### Core application
- Prisma migrations deploy successfully
- typecheck passes
- build passes
- eight core CI-equivalent test groups pass locally where applicable

### Laya
Send one normal assistant message and inspect its AgentRun:
- `assistantRuntime = department-assistant/v1`
- `reflexMode = SHADOW`
- `reflexDecisions` contains DecisionRun IDs
- no Laya result directly created/modified business data
- no Laya result granted a tool capability

### Muse
Send one routine assistant message:
- ModelRun exists
- policy is an `ASSISTANT_*` policy
- selected profile is the resident Muse profile
- provider/model provenance is present
- no direct legacy Advisor LLM path was silently used

### Product R&D
Start one Product R&D program:
- one WorkItem
- one Department Assistant parent AgentTask
- five specialist child AgentTasks
- one ResearchRun
- QA task only after specialists are terminal
- Product R&D executive report is a structured Artifact
- report remains pending human review
- no G1/G2/G3 decision is auto-approved

## 5. Safety boundaries

Muse:
- cannot grant permissions
- cannot mark a claim VERIFIED
- cannot bypass ToolBroker
- cannot directly approve G1/G2/G3

Laya:
- no tools
- no direct business writes
- no approval authority
- no factual truth authority
- no irreversible action authority

Digital employees:
- retain Agent/Skill/Squad identity
- use Model Policies, not hard-coded model vendors
- side-effecting tools must migrate behind ToolBroker

Evidence:
- source authenticity is separate from claim support
- Research cannot self-verify
- model output alone stays UNKNOWN unless independently supported
- rules-only verifier never emits VERIFIED

## 6. Current rollout mode

```text
Department Assistant: ACTIVE compatibility seam
Muse resident policy: AVAILABLE, DISABLED BY DEFAULT
Laya reflex: SHADOW
ToolBroker / ApprovalGrant: AVAILABLE
Evidence Verifier: AVAILABLE
Product R&D factory: ACTIVE API + Golden regression
Proactive automation: existing Autopilot only; new A1 candidate expansion pending
A2 autonomous execution: NOT ENABLED
```

This rollout order is deliberate. The system should accumulate real telemetry and regression evidence before Laya routing or proactive work is allowed to take autonomous action.
