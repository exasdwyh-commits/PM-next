# Changelog

本项目所有显著变更记录在此。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added / 新增
- web_crawl 网页爬取工具（crawl4ai），与 web_fetch 互补 (`a5344ab`)
- 独立 QA 人工签字 / 报告交付链接与落图卡 / 对话复制编辑 / 凭证脱敏守卫 (`d895076`)
- unify report presentation with Muse v3 (`9c1cd8b`)
- 批次 D — 知识库四模块结构化 + 引用标注 + 事后回填通道 (`730429b`)
- 真实报价/资料入库通道，点亮深度报告 ①② 块 (`46bb9ad`)
- 局域网免密——角色即登录，去掉内网密码门槛 (`2200f2e`)
- 建第二个租户包（pet-food），把品类外观从 src/ 下沉到 pack (`52e8821`)
- 加 category-content pack 与 categoryMeta 的 tint 预设 (`d7fd7ce`)
- Capability Registry + Knowledge Router + Skill Runtime (`540e24f`)
- rich replies, artifact cards and reader in the formal /muse (port of arena a19f2d4/438ea91/6699654) (`20206c6`)
- kern-rich/v1 protocol + KernArtifact data layer in V2 (selective port of arena 0520742) (`882fc9b`)
- 应用 FINAL_FULL_CLOSURE（56 文件，P4-P8 全量闭环） (`4c5d5d3`)
- final result beautified advanced - P0-P6 + 27 rich + 8 animations + 4cat role-adaptive + daily UX + UI L3 (`bc49697`)
- mission output take-away — decision card, proposals, MD/PDF export (`138059d`)
- mission brief (clarify + plan cards) and demo mode (`a8008ba`)
- live mission card + workspace (过程/产出) (Display Layer PR ②) (`bbcc0e2`)
- mission event log, user controls and SSE stream (Display Layer PR ①) (`c314fea`)

### Fixed / 修复
- transition 写明属性（var(--m-tr-ui)），符合动效契约 MC3/MC4 (`664b2be`)
- 并发建会话不再撞唯一键——用唯一约束做互斥量，消除 P2002 (`c7f5540`)
- 服务 CI 两项守卫 —— 补审计中文标签 + 报价路由改走模块层 (`c57e848`)
- CSS 层色值令牌化，修复暗色主题下浅底浅字 (`35dca04`)
- demo 卡片中性色指向主题令牌，修复暗色下浅底浅字 (`b1405e2`)
- 定死成本情景权限语义——读随列表组织级共享，改/删限创建者本人 (`429f916`)
- 修权限矩阵 61 项红灯——鉴权错误不再被吞成 500，补齐跨租户校验 (`eb72adc`)
- 色值收敛到主题令牌，修复暗色主题白底与写死品类兜底 (`5c40692`)
- replace locale-tagged toLocaleString with deterministic formatTokenCount (`a85f0b5`)
- 定时上限与「每日简报唯一」不再被并发穿透 (`0c09cb8`)
- 连接器/做法的上限不再被并发穿透 (`96f36e4`)
- harness/validate 不再把 401/400 报成 500 (`ab1b637`)
- 渠道路线状态变更报错不再夹英文枚举 (`88d3e26`)
- 顾问运行/提议的中文报错不再夹英文枚举 (`d677e74`)
- 收掉 MissionNodeStatus 最后两份平行拷贝 (`d8504f9`)
- 工作台不再把 4 个枚举摊成一张状态表 (`4772d5e`)
- 门禁/报告/概览文案不再把内部枚举直接印给使用者 (`cf5fc21`)
- 拉丁短词只认整词，修掉关键词打分的子串白拿分 (`1490b0b`)
- 报告状态文案四格式合一，修掉两处既有红测试 (`ec64c72`)
- 补完 P1-A 三处接线，修掉 274739d 的编译失败 (`4c66b34`)
- 收敛漏鉴权/privacy 日期口径/MC 动画守卫三项技术债 (`98d47ef`)
- 收敛 P2 —— 权限矩阵补登记、架构归层、原生弹窗收口 (`75b32cb`)
- 修复 V2 引入的两处测试基线过时与五处枚举直出 (`b6b00a7`)
- Feedback.topics 为必填列，补齐 4 处漏传调用点 (`35089a9`)
- TS2304 'id' out of scope in scenarios [id] route error logs (baseline typecheck blocker) (`bbc9c5f`)
- conversation scroller was squeezed to 0px by the pinned daily-briefing panel (`ae9b5c8`)
- everyday prompts no longer become missions; a mission brief never swallows a rich answer (`a9bcaa0`)
- 修复 Next 15 路由契约、条件 Hook 与构建期 trace 竞态 (`b5177fe`)
- 修复第二版交付的 70 个类型错误与运行时故障 (`0595272`)
- 修复交付 patch 的 183 个类型错误，恢复可构建状态 (`26298d4`)
- 补全 CostScenario 关系字段的 @relation 名并生成迁移 (`85ef042`)
- 记忆回灌不得把任务结论当作澄清问题答案 (`56afc45`)
- enforce Kern memory quota; docs: honest status + converged next-phase plan (#38) (`d179f8f`)

### Changed / 变更
- 批次C+：拆雷——playbook 假数据节点整段清除（#64） (`5bfbb12`)
- 文档：路线图快照回填（#63） (`4ee5553`)
- 批次C：执行层深度报告先三块——规格/BOM/验证排期真渲，其余六块 UNKNOWN 占位（#61） (`5a83fdb`)
- 文档：角色报告优化总路线与交接协议（#62） (`2b6e1bb`)
- 拆雷：role-aware-report 销售话术去硬编码数字（#60） (`c1ac896`)
- 批次B：操盘手（operator）角色落地——角色系统+契约增量+报告视图（#59） (`7a8b7e6`)
- 批次A：角色报告视图升级 V3 视觉 + 拆除写死数字（#58） (`4c0e854`)
- 研发汇总八节契约（R1）+ 产品落库幂等与失败可感知（R2）+ 工厂级参数标准（R3）+ 流程图修复 (#55) (`939880b`)
- enrich healthcare brief — product analysis, cost/sales, risk register, marketing strategy (`5c5e081`)
- add standard product report format and token cost accounting (`2027ca9`)
- add healthcare R&D, market validation and growth playbook (`d79b7c2`)
- distinguish unavailable workspace data from a verified empty state (`0d3719c`)
- standardize conversation home and workbench foundations (`9f88163`)
- 清掉 CategoryKey 放宽后遗留的冗余联合类型 (`da60d99`)
- 中立化第一批 —— 品类名显示、合规简称、写死价与重复数据副本 (`9c1771c`)
- P1-A 类 4 —— 成本计算器的合规要求与成本结构下沉到 pack (`1c8f7a1`)
- P1-A S2/S3/S4 —— 9 个组件收口，业务字段下沉到 pack (`16a5531`)
- P1-A S1 —— 13 个组件的 CATEGORY_INFO 收口到 categoryMeta() (`1fd46be`)
- ﻿fix(v2): P1-A 行业词中立 — 品类元数据下沉到 tenant pack (`274739d`)
- one formal output contract (kern-rich/v1); legacy prompt specs deprecated (`e835221`)
- 同步本地源码包（2026-10-08）并补齐项目地图 (`81f555e`)

### Docs / 文档
- 补上 P1-A 后续设计提案（决策依据存档） (`49f2395`)
- 更新 P1-A 迁移清单进度至 S2/S3/S4 完成 (`fa63bef`)
- 归档任务卡与优化提案到 docs/archive (`e2d4e92`)
- Kern display layer spec + working memory (reconciled with 2026-09-26 branch convergence, #36-#38, plan v2 as P1 acceptance detail) (`a0d2415`)

### Tests / 测试
- F5 账本断言改为轮询，消除时序竞态与空集假过 (`a79fca7`)
- 补提交角色视图渲染契约 RB1–RB3 (`5d8139d`)
- fix risk-register category assertions for gated inputs (`3e5276c`)
- 新增租户切换有效性守卫（P3-1~P3-4），并实测它能否抓到回归 (`956ae02`)
- 中立守卫加显式豁免清单 + 反腐化断言 (`dcdcfbf`)
- DB regression through the real engine, live /muse browser chain, fixed-sample model (`75b41c5`)

### Chore / 工程
- 阻断内部文档与本地凭证入库路径 (`a42f23d`)
- 新增 PR 描述模板（版本/用途/改动/验证/边界） (`647c800`)
- verify core UX in GitHub and repair explicit project-map coverage (`2247684`)
- 归档已过时的 task_plan.md 到 docs/archive (`9d7b488`)
- 源码统一 LF 行尾，避免纯行尾改动污染 diff (`0ad11b8`)
- 忽略 .next-fresh 本地验收目录（与 .next-verify 同类） (`1a3f77f`)

## [0.1.0-rc1] - 2026-09-26

首个候选版本：Kern 主操作层（对话优先）+ 专业管理后台 + 本机执行 + Evidence / QA / Governance 可信链基线。
当前 `main` 与 `release/v0.1.0-rc1` 收敛于同一提交（tag `v0.1.0-rc1-kern-v2`）。
