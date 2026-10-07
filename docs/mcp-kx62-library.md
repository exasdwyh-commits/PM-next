# KX-62 产出库（Library）

## 目标
参考 Meta Muse 的 Library：Kern 完成的任务集中在一个地方，随时再下载成 Markdown、PDF、Word、Excel 或 PPT。

## 做法（第一步：只读汇总，不新建表）
- 模块 `src/modules/supervisor/library.ts`：
  - `listLibrary(session, { q })`：本组织 + 任务快照 `schemaVersion=kern-mission/v1` + `requestedByUserId=本人` + 状态 `SUCCEEDED`，按完成时间倒序，最多 60 条。
  - `q` 按任务目标搜索，不区分大小写；空白压缩、最长 60 字。
  - 每条给出五种下载链接，全部指向已有的 `GET /api/missions/{id}/export`（仅发起人，他人 404），产出库自己不生成文件。
- 接口 `GET /api/library?q=`：只读，只列本人。
- 界面：对话页顶栏新增「产出」按钮，打开产出库面板（搜索框 + 列表，每条带五个下载按钮；PDF 在新标签打开可打印页）。

## 权限
- 新路由已登记权限矩阵：匿名 401；其他身份 200 但只见自己的；跨租户不可见（crossTenant 断言）。
- 基线更新为 89 路由 / 124 方法，`test:authz` 1086 项全绿。
- 同组织其他成员的隔离由数据库回归覆盖（见下）。

## 验证
- 单测 `tests/kern-library.test.ts`（LB1–LB3），已加入 `test:regression-units`（224 项全绿）。
- 数据库回归 `npm run test:kern-library`（LB-DB1–3）：
  - 只列本人已成功的任务，进行中 / 失败 / 非任务快照不列；
  - 同组织同事、其他组织都看不到我的产出；
  - 搜索命中与未命中。
- tsc、eslint 通过。
- 截图：浅色 / 深色下面板能打开，配色正确。
- KX-63 真实数据走查（2026-09-29）：在开发库临时插入 2 条已完成任务、2 个连接器（标记 `[KX63-demo]` / `KX63`，另因开发库没有任何 Agent 临时建 1 个 `KX63_DEMO`），截图后已全部删除（2 / 2 / 1 条）。
  - 产出库：标题、完成时间、五个下载按钮显示正确。
  - 连接器：CRM 显示“只读”、文档库显示“读写交互”，与工具开关一致；深色正常。
  - 修正两处细节：档位说明字号改小；下载按钮加边框和底色，更像按钮。

## 以后
- 验证有用后加 `KernArtifact` 表，存文件元数据和 SHA-256（导出接口已在响应头给出），避免每次重新生成。
- 列表分页（目前上限 60 条）。
