# Frontend structure contract

This document keeps the HERMES frontend easy to change while visual work is in progress. It is intentionally incremental: existing routes and domain modules remain stable; new code follows the boundaries below and old code moves only when touched.

## Ownership

| Area | Owns | Must not own |
| --- | --- | --- |
| `src/app/**/page.tsx` | Route access, auth/session checks, server data composition, route-level metadata | Visual markup trees, business rules, direct cross-domain calculations |
| `src/app/**/**-client.tsx` | Route interaction state, URL/query state, event orchestration | Prisma access, status-label definitions, reusable visual primitives |
| `src/components/` | Reusable product UI and layout composition | Route-specific data fetching or domain policy |
| `src/components/ui.tsx` | Stable visual primitives and semantic states | Product-specific copy, database enums, one-off layout hacks |
| `src/modules/<domain>/` | Domain use cases, policies, query/read models and transformations | React, Tailwind classes, browser APIs |
| `src/shared/` | Cross-domain infrastructure, session, time, labels, validation and safe primitives | Product page composition or domain-specific decisions |
| `src/app/theme/` | Design tokens and palette contracts | Component-level hardcoded colors or shadow values |

## Direction of dependencies

```text
route page / client composition
        ↓
reusable components + route view models
        ↓
domain modules and shared contracts
        ↓
database / external services
```

Lower layers never import from `src/app` or `src/components`. A module may return a view-model-shaped object, but it must not return JSX or Tailwind class names.

## Incremental migration rules

1. Keep `page.tsx` thin. If a page contains more than one domain query or a non-trivial mapping, move the read model to the owning module before adding visual work.
2. Keep client components thin. Client code may own filters, tabs, drawers and optimistic UI, but not authorization decisions or database reads.
3. Keep status and copy canonical. New UI reads labels and semantic tones from `src/shared/status-labels.ts` or an owning module; it must not print raw database enums.
4. Extend `src/components/ui.tsx` before adding a second button/card/badge language. A new primitive needs a semantic reason and a loading/empty/error state.
5. Put page-specific composition beside its route until it is used by a second route. Promote only repeated patterns to `src/components/`.
6. Keep AI interaction states explicit: `idle`, `working`, `needs-review`, `success`, `error`, and `cancelled`. Do not encode them only through color.
7. All visual values go through `src/app/theme/quiet-enterprise.css`. Avoid inline hex/rgba and one-off shadows in JSX.

## Route composition pattern

For a new or substantially changed route, prefer:

```text
src/app/<route>/page.tsx                 # auth + server read model
src/app/<route>/<route>-client.tsx       # interaction state
src/app/<route>/components/*             # route-only compositions
src/modules/<domain>/                     # query/use-case/policy
src/components/*                         # only when reused
```

The route should receive a serializable view model. The client should not reconstruct business meaning from raw database records.

## First restructuring sequence

1. Workbench: keep `src/app/workbench-client.tsx` as composition only; move remaining prioritization and briefing transforms to `src/modules/workspace/`.
2. Products: align list/detail/launch tabs around one product view model and one status vocabulary.
3. Advisor: isolate AI transport, proposal state and visual review cards so the page does not own policy.
4. Shared UI: consolidate repeated panel, badge, empty-state and async-state variants without flattening useful domain language.

## Review checklist

- Does the change preserve the existing auth, audit, evidence and approval semantics?
- Can the UI be rendered from a serializable view model?
- Is the primary action obvious without reading implementation details?
- Are loading, empty, error, disabled and keyboard states covered?
- Did the change add a token or a one-off visual value?
- Is a new abstraction reused, or is it premature generalization?
