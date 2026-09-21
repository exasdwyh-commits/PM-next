# HERMES Next 项目完成验收

日期：2026-09-20

## 交付结论

桌面与平板范围内，HERMES Next 的核心产品研发闭环已完成并通过验收：身份与权限、产品入库、项目推进、证据核实、版本修订、顾问知识检索与 LLM 润色、决策门禁、上市计划、审计与多租户隔离均可运行。

手机界面不在本次交付范围内；飞书/微信只作为命令发布入口，不承担本项目 Web 界面适配。

## 已验证命令

| 验收面 | 结果 |
| --- | --- |
| `npm run build` | Next.js 生产构建通过，全部 App/API 路由生成成功 |
| `npm run test:critical` | 产品中心 33、权限 568、科学证据 26、顾问 LLM 37 项断言通过 |
| `npm run test:db` | 事务原子性、回滚、幂等通过 |
| `npm run test:acceptance` | A01–A12 全部通过 |
| `npm run test:r1` / `test:p1` / `test:r2` / `test:r3` | B01-R1、P1、R2、R3 全部通过 |
| `npm run test:http` / `test:http-errors` / `test:api-errors` | HTTP 与中央错误映射全部通过 |
| `npm run test:revision` / `test:partial` | 版本一致性与局部修订闭环通过 |
| `npm run test:evidence` / `test:opportunity` / `test:signal` | 证据、机会、信号回归通过 |
| `npm run test:ui-feedback` | 交互反馈层 73 项断言通过 |
| `npm run test:blueprint` | 蓝图十大业务门槛全部通过 |

## 浏览器与布局验收

- 18 个已登录业务路由在 1440、1366、1280、1180、1093、1024、853 宽度下无横向溢出。
- 项目中心 `/projects` 修复了旧数据字段 `name` 与当前模型 `title` 不一致导致的 500，并在上述主要宽度下返回 200。
- 工作总览、产品库、AI 顾问、产品详情、项目中心已完成人工截图检查。
- 手机视口仍保留一项 9px 横向溢出记录，按产品范围明确暂不处理。

## 已知非阻断项

- `npm run lint` 仍受 Next.js `next lint` 迁移交互影响；生产构建的 TypeScript 与 Next.js 编译检查已通过。后续若要启用静态 lint，应单独迁移到 ESLint CLI 配置。
