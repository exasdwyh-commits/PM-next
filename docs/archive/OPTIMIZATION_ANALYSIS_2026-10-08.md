# PM-next 项目优化分析报告
生成时间: 2026-10-08
分析基线: main 分支 280 commits (56afc45)
源码规模: 492 个 src 文件, 38 个 modules

## 一、项目全貌理解

**定位**: Kern AI Product OS - 一个以对话为第一界面的产品研发操作系统，核心是 Kern Personal Chief of Staff 统筹 13 个数字员工，通过 Evidence / Governance 保证可信。

**技术栈**:
- Next.js 15.1.0 + React 19 + TypeScript 5.7
- Prisma 6.4.1 + PostgreSQL
- Tailwind 3.4 + 自研 Quiet Enterprise 设计系统
- 自研 Worker (pm-worker) + Desktop Runtime (Mac 本机执行)
- Model Gateway (provider-neutral) + Laya System-1

**架构亮点**:
- 22 个架构区域，覆盖率 100% (480/480)
- 11 条 CI 工作流，质量门禁完整
- supervisor / worker / evidence / cost-engine / decision-intelligence 链路完整

---

## 二、已识别的优化机会 (按影响排序)

### 🔴 P0 - 高影响、低风险、可立即实施

#### 1. 重型办公库未做动态导入 (office-export.ts)
**位置**: `src/modules/supervisor/office-export.ts`
```ts
import { ... } from "docx"  // 9.8.0 ~ 1.2MB
import ExcelJS from "exceljs" // 4.4.0 ~ 4MB
import PptxGenJS from "pptxgenjs" // 3.12.0 ~ 2MB
```
**问题**: 这 4 个库合计 > 7MB (minified 前)，被同步 import 进主包，即使 99% 用户不导出也会加载。
**优化**:
```ts
// 改为动态导入
const { Document } = await import("docx")
const ExcelJS = (await import("exceljs")).default
```
**预期收益**: 首包减少 ~400KB gzip, 降低 Vercel/生产冷启动 15-20%

#### 2. next.config.ts 过于简单
当前只有 distDir 和 version 注入，缺失 Next 15 推荐优化:
```ts
// 建议升级
const nextConfig: NextConfig = {
  compress: true,
  experimental: {
    optimizePackageImports: ["docx","exceljs","pptxgenjs","jszip"],
    // 你的 38 个 modules 中有很多 barrel export
  },
  images: { unoptimized: false },
  // 你的 project-detail-client 1953 行，应该开启
  modularizeImports: { ... }
}
```
**收益**: 构建时间 -10%, 包体积 -5~8%

#### 3. CI 重复执行 npm ci + typecheck (12 个 workflow)
每个 workflow 都跑:
- actions/setup-node cache: npm
- npm ci (19M 项目，每次 ~90s)
- prisma generate + typecheck (重复 12 次)

**优化**:
- 引入 `actions/cache` 缓存 `.next/cache` 和 `node_modules/.prisma`
- 抽一个 `quality-gate` 可复用 workflow，typecheck 只跑一次
- 使用 `dorny/paths-filter` 已经在做，但可以合并 12 -> 4 个矩阵

**收益**: CI 总耗时从 ~25分钟 -> ~12分钟，GitHub Actions 账单减半

#### 4. Prisma Client 高频实例化
`grep -r prisma 763 次`，很多模块直接 `import { prisma } from "@/modules/..."` 单例，但未配置连接池:
```ts
// 建议 prisma.ts
export const prisma = new PrismaClient({
  log: ["error"],
  datasources: { db: { url: process.env.DATABASE_URL } }
})
// 加上全局单例 + 连接池参数 ?connection_limit=10
```
**收益**: 高并发下避免连接耗尽，Worker 5s 轮询更稳定

### 🟡 P1 - 中影响、需小重构

#### 5. Client Components 过多 (62 个 "use client")
- `src/app/projects/[id]/project-detail-client.tsx` 1953 行单文件客户端组件
- 包含 ProductRndPanel dynamic 但其他 tab 全同步

**优化**:
- 拆成 `overview-tab / rnd-tab / workitems-tab / evidence-tab` 四个 dynamic
- 使用 `next/dynamic` + `suspense`
- 引入 `src/components/ui.tsx` 已有的骨架屏

**收益**: TTFB -200ms, 交互就绪 -30%

#### 6. Worker 轮询频率可优化
当前:
```
executor 5s / research 30s / event 10s / reconcile 60s
```
所有环境一致，开发环境也 5s 高频轮询，空跑浪费 DB。

**优化**:
```ts
// pm-worker.ts
const INTERVAL = process.env.NODE_ENV === "development" ? 15000 : 5000
// 加上指数退避，空队列时 5s -> 10s -> 20s max
```

#### 7. 测试运行器分散
`package.json` 有 50+ test:* 脚本，全部用 `tsx scripts/run-test.ts` + `run-sh.js` 包装，无并行。

**优化**:
- 引入 `vitest` 统一运行，支持并行 + 缓存
- `test:sweep` 改为 `vitest --run --shard`
- 保留 `run-test.ts` 做隔离校验

#### 8. 未使用 React 19 新特性
已升级 React 19，但仍用旧模式:
- 无 `use()` / `useOptimistic`
- 无 Server Actions 缓存
- `workbench-client.tsx` 仍客户端拉数据

**优化**: 将 dashboard / products 列表改为 Server Component + `fetch` 缓存

### 🟢 P2 - 长期架构

#### 9. 项目地图已 100% 但构建时生成
`npm run kern:map` 生成 `docs/maps/kern-runtime.kern-graph.json`，每次 CI 都重新生成，未缓存。

#### 10. 文档与代码耦合
`docs/KERN_*` 大量文档，但与代码通过 import 静态分析，无运行时校验，可加 `docs:lint`

---

## 三、建议的优化路线图

**Week 1 (你确认后我可直接实施)**:
1. office-export 动态导入 + next.config 优化 (P0-1,2)
2. CI 合并 + 缓存优化 (P0-3)
3. Prisma 单例 + 连接池 (P0-4)

**Week 2**:
4. 拆分 project-detail-client 1953 行 (P1-5)
5. Worker 指数退避 (P1-6)

**Week 3**:
6. 引入 vitest 并行 + 前端 Server Components 改造

---

## 四、需要你决策的点

1. **优化目标优先级**: 你更在意
   - A) 构建/CI 速度 (开发体验)
   - B) 生产包体积/首屏速度 (用户体验)
   - C) Worker/DB 稳定性 (运维成本)
   - D) 全部都要，按 P0->P2 顺序

2. **是否接受引入新依赖**:
   - `vitest` / `@next/bundle-analyzer` / `sharp` (图片优化)
   - 还是保持零新增，仅改配置？

3. **是否可改 CI**:
   - 12 个 workflow 是否可合并为 4 个矩阵？会改 `.github/workflows/*`

4. **office 导出**: 是否可接受首次导出时有 1-2s 动态加载延迟，换取首包大幅减小？

确认后，我会在本地分支 `optimize/2026-10-08` 实施，生成可直接 `git apply` 的 patch，不需要你的 Token，你本地 review 后自行 push。

