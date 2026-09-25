# PM OS Kernel → PM-next Migration Summary (Phase 1)

Date: 2026-09-24  
PM-os-mvp baseline: `8a546fc491a85f2e21d7ce1f30b63c268585fd3c`  
PM-next path: local folder `PM-Agent` (remote `exasdwyh-commits/PM-next`)

## Goal

First phase only:

> PM-next UI starts a Product R&D evaluation and runs it **entirely through PM OS Kernel**.

## Migrated (live)

| Capability | Location in PM-next | Notes |
|---|---|---|
| Contracts | `src/kernel/contracts/` | claimKind / evidenceLevel / Project Task Report |
| ToolBroker | `src/kernel/core/tool-broker.mjs` | private fields, no post-ctor register, signed ApprovalService |
| Capability Gateway | `src/kernel/core/capability-gateway.mjs` | policies from `src/kernel/config/policies.json` |
| ApprovalService | `src/kernel/core/approval-service.mjs` | HMAC, principal/task/resource/actionHash/expiry/single-use |
| ResearchExecutor | `src/kernel/core/research-executor.mjs` | via ToolBroker |
| Source Fetch / SSRF | `src/kernel/core/source-fetcher.mjs` + trust | allowlist, redirect hops, DNS/IP guards as in PM-os-mvp |
| Independent Verifier | `src/kernel/core/evidence-verifier.mjs` | rules-only, never VERIFIED |
| KnowledgeDebt service | `src/kernel/core/knowledge-debt-service.mjs` | normalized-key merge |
| Report | via workflow + contracts | system nextActions vs `advisoryNotes` UNTRUSTED_ADVISORY |
| Product R&D workflow | `src/kernel/workflows/product-rnd-slice.mjs` | durable stages / idempotency / recovery hooks |
| Storage / Recovery | `src/kernel/storage/*`, `recovery.mjs` | SQLite canonical for kernel (`data/kernel/pm-os-kernel.db`) |
| Golden-shaped regression | `tests/regression-kernel-product-rnd.test.ts` | 6 acceptance cases |

## Preserved (not rewritten)

- PM-next UI shell, products, war room, company brain/knowledge UI, model control UI
- PM-next Prisma/Postgres product data (Projects/Products/Evidence legacy domain)
- Auth/session (`getServerSession`)
- Existing Workforce as **Legacy Workforce Adapter** (not given kernel authority)

## Retired for new path

- Calling models/tools directly from the new Product R&D entry
- Boolean `approved: true` style approvals on this path (signed grants only)
- Model advisory text as executable system nextActions (moves to `advisoryNotes`)

## Architecture after Phase 1

```text
PM-next UI (/product-rnd)
        ↓
Department Assistant (thin API adapter)
  POST /api/kernel/product-rnd
        ↓
PM OS Kernel (src/kernel/*)
  Project → Task → Router → ResearchExecutor → ToolBroker
        → Provider → Source Fetcher → Independent Verifier
        → Knowledge Debt → Report
        ↓
Kernel SQLite (canonical for this slice)
        ↓
API projection JSON → PM-next UI
```

**Canonical source for Product R&D vertical slice state = PM OS Kernel storage.**  
PM-next Prisma remains canonical for existing product/company modules; dual-truth is temporary until later projection phase.

## Changed files (key)

### PM-next (PM-Agent)

- `src/kernel/**` (new kernel package)
- `src/app/api/kernel/product-rnd/route.ts`
- `src/app/api/kernel/health/route.ts`
- `src/app/product-rnd/page.tsx`
- `src/app/product-rnd/product-rnd-client.tsx`
- `src/components/app-shell.tsx` (nav: 产品研发评估)
- `tests/regression-kernel-product-rnd.test.ts`
- `package.json` (`test:kernel`)
- `.gitignore` (`data/kernel/`)

### Preview entry (cwd `PM_OS`)

- `index.html` / `index.css` / `index.js` — browser preview of the slice

## Test results

| Suite | Result |
|---|---|
| PM-os-mvp `npm test` | 62/62 PASS |
| PM-os-mvp `npm run eval:golden` | 10/10 PASS |
| PM-next `npm run test:kernel` | 6/6 PASS |
| PM-next `npm run typecheck` | PASS |
| PM-next `npm run lint` | PASS |
| PM-next `npm run build` | PASS (`/product-rnd`, `/api/kernel/*` present) |

## Remaining migration backlog (next batch only)

1. Project Task projection: Kernel canonical → PM-next Prisma read models for list pages  
2. Wire Product War Room to show kernel reports alongside legacy project tasks  
3. Map Model Gateway UI → Kernel ModelRegistry (single registry, no second copy)  
4. Promote Workforce via Digital Employee → ToolBroker (retire Legacy Adapter side effects)  
5. Knowledge Steward write path into Company Brain (Evidence → Verifier → Steward only)

## Acceptance

**Can PM-next complete the Product R&D vertical slice through PM OS Kernel?**

**Yes — for the first-phase acceptance path:**

- Integration test Case 1 proves Project + Task COMPLETED + Report + Evidence + KnowledgeDebt through `src/kernel/runtime.mjs` (same runtime the API uses).
- Production build emits `/product-rnd` and `POST/GET /api/kernel/product-rnd`.
- UI is the only product entry; it does not call models/tools directly.

Not yet in scope of this phase (honest limits):

- Kernel state is **not yet** projected into all legacy PM-next Project/Task list pages.
- Full end-to-end browser login + API call in headless CI was not automated; local manual path is: `npm run dev` → login → 更多 → 产品研发评估 → 启动分析.
