# Core UX fixture checks

This is an isolated, read-only test harness for the **actual PM-next source components**. It is not a replacement application, authentication bypass or production backend.

- Five labeled synthetic scenarios: empty, real-data shape, independent project without records, read failure / retry, warnings / degraded reads.
- All API writes are rejected with 405. No model, production database, credential vault or desktop runtime is connected.
- Uses PM-next React / source components; Next navigation shims are confined to this folder.
- Kept outside production type/lint entry points because it has separate dependencies and shims; its own strict typecheck and Vite build run in Core UX CI.
- Browser verification covers desktop, 390px / 320px, disclosure keyboard / focus, draft append, errors, stale requests, warnings, long composer and reduced motion.

GitHub Actions `.github/workflows/core-ux-ci.yml` runs the checks and uploads screenshots / JSON evidence. Fixture checks do **not** establish authenticated API, real model, approval or production end-to-end correctness.

Reproduction in an authorized GitHub Codespace / cloud checkout:

```sh
npm ci
npx prisma generate
npm ci --prefix tools/ux-preview
npm run check --prefix tools/ux-preview
npm run dev --prefix tools/ux-preview
# In a second terminal:
node tools/ux-preview/verify.mjs
```
