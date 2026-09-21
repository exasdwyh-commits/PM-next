---
title: 产品中心业务契约（PC-0 / TASK-003）
version: "1.2"
status: 契约冻结候选；四项拍板已并入（B4 读口径 / 最小 OrganizationMember / G2·G3 统一授权机制 / Artifact 三项字段）；另并入验证可信度修复 D-008/D-009；待 PC-0 放行确认后冻结
date: 2026-09-16
owner: 实施负责人
task: TASK-003（PC-0）
depends: TASK-001（`docs/product-center/CAPABILITY_BASELINE.md`）
scope: 九类业务成果 → 既有对象 / 必要新增对象 的映射，含字段、关联、版本、G0–G3、权限、失效、幂等与 REST 入口
---

# 产品中心业务契约

> 执行以 `plan/architecture-hermes-product-center-deepseek-v1.md` 为准；本文为契约落点。

> **本文件是契约，不是实现清单，也不是 schema。**
>
> 它回答一个问题：**"公司/品牌简报、产品版本、项目、证据、报价、样品、生产记录、营销成果、经营复盘"这九类东西，在系统里各自是什么对象、互相怎么连、什么条件下才能放行、改了什么会让什么失效。**
>
> 本文件**先于**任何 schema 扩展。路线图 §2 TASK-003 原文："之后才允许扩 schema。"
>
> 状态词沿用 `CAPABILITY_BASELINE.md` 的五档：**源码存在** ＜ **静态确认** ＜ **运行已验证** ＜ **业务已验收** ＜ **阻塞**。本文中"既有"= 已在 `prisma/schema.prisma` 里存在；"待新增"= 本契约认为必须新增，**尚未实现**；"待拍板"= 需要业务或决策人先给口径。

---

## 0. 使用与冻结规则

1. **单一写入链原则**。任何一类成果的写入都必须落到既有命令入口，不得为它新建第二条写链：
   - 产品创建：`createDevelopmentProduct`（`src/modules/products/service.ts`）
   - 任务创建：`createWorkItem`（`src/modules/work/service.ts`）
   - 顾问提议落地：`applyProposal`（`src/modules/advisor/proposals.ts`）
   - 放行决策：`createDecisionPacketDraft` / `submitDecisionPacket` / `decideDecisionPacket`（`src/modules/decisions/service.ts`）
2. **共享 schema 改动先改本文件**。`DATA_AND_COMMAND_CONTRACTS.md` 是本契约的前身（任务包 A）；后续任何新增表/字段/枚举值，先在本文件登记"属于九类中的哪一类、绑定哪个版本、失效关系是什么"，再由实施方做隔离迁移。
3. **结构化成果用 `type` + `schemaVersion`，不用自由文本**。当前 `Artifact.type` 是**自由 `String`**，代码里实际只出现过两个值（`SPECIFICATION_BRIEF`、`MARKET_RESEARCH_REPORT`）。本契约 §4 建立**成果类型注册表**：新增类型必须先登记。
4. **未知即未知**。契约中所有"未定/待拍板"项保持未定，不得由实施方补默认值（CON-003）。

---

## 0.1 本轮变更记录（PC-0 Final Security Patch，2026-09-16）

四项拍板 + 三项安全修复 + 两项验证可信度修复，均在冻结原则内（只做当前试点必需）：

| 类别 | 内容 | 证据 |
| --- | --- | --- |
| 拍板 | B4 读口径 = **组织内可读**（写仍按项目角色） | §3.3 / §9.3 |
| 拍板 | B7 = **最小 `OrganizationMember`**，`isOrgAdmin` 只看它 | §9.1 / §9.3 |
| 拍板 | G2/G3 **统一授权机制**：`DecisionPacket` 授权、`LaunchPlan` 执行 | §6.4 |
| 拍板 | §10.2 关键字段 **I-001/I-002/I-003 批准实施** | §10.2 / §3.8 |
| 修复 | D-003 组织管理员**权限自举**（建项目即自升） | B8 场景 5（10 断言） |
| 修复 | D-002 **跨组织信号存在性泄漏**（422 泄漏措辞） | B8 场景 6（11 断言） |
| 修复 | `Artifact` 组织/产品版本/schema 版本三字段 + 回填 | `20260916010000_*` 迁移 |
| 修复 | D-008 **写路由不校验入参 → 缺字段冒成 500**；B8 owner 门禁曾把 500 当"门禁已开" | B8 场景 7（9 断言）+ owner 段新增「无 5xx」汇总断言 |
| 修复 | D-009 退出按钮无障碍名与可见文字不一致 → UI 套件末步不可达、**9 条断言全过却始终非绿** | `tests/ui-b01-evidence.ts` 13/13 |
| 设施 | `scripts/acc-server.sh`：缺 `BUILD_ID` 自动重建、腾端口、探活后才跑套件 | 见该脚本头注（3 类报错文案都会误导方向） |

**本批明确不做**（不为"模块完整"而实现）：`GateType.LAUNCH_GATE`（I-006）、`Product` 复合唯一（I-005）、迁移基线重建（D-006）、Worker / `portfolio` / `agent-runtime` / 复杂 HR 权限 / UI 大改版。

> ⚠️ **2026-09-20 更新**：其中两项已由后续任务完成 —— 迁移基线重建（D-006）→ **TASK-007**；`Product` 复合唯一（I-005 / D-001 约束半边）→ **TASK-008**。I-006 仍暂不实施（G3 首次真实可达时执行）。

---

## 决策对齐（DEC-001–010）

> 本节落实总计划 §1.4。**DEC-001–010 是规划规定，不是用户已批准**（状态：本计划规定，待用户确认）。
>
> 文档中与 DEC 直接冲突的**旧条款一律就地保留并标注**（见各处 `> ⚠️ 已被 DEC-00X 取代`）；**执行以 DEC 为准，旧条款保留为历史**，不删除、不追改历史日期。

| ID | 原冲突 | 本计划规定 | 受影响契约条款 | 处置 |
| --- | --- | --- | --- | --- |
| DEC-001 | 旧路线图称无模型；新代码已有 LLM 解释层 | 复用 `advisor/llm.ts`，只补真实缺口；不同层次的智能验收分开 | §8.2（`/api/llm/*` 缺口表）；`CAPABILITY_BASELINE.md` §1.2 | 就地标注 §8.2；不另建网关 |
| DEC-002 | 旧契约把样品通过写成 G1 前置 | G1 批准打样投入，**不要求尚未产生的样品通过**；样品结论属于 G2 依据 | §3.6（失效影响）；§6.2（G1 前置） | 就地标注 §3.6 |
| DEC-003 | 旧 G2 条款笼统要求 G1，而固定产品路径跳过 G1 | 新品要求对应打样依据；固定产品用**已确认版本及其适用证据**，不伪造 G1 历史 | §6.3（G2 前置）；§6.5（门禁总表） | 就地标注 §6.3 / §6.5 |
| DEC-004 | G2 要"生产记录"，生产又依赖 G2 | G2 前需要**生产计划、报价、数量和确认资料**；实际生产记录在**批准后**产生，不构成循环依赖 | §6.3（G2 前置）；§1（第 7 类"生产记录"）；§3.7 | 就地标注 §6.3 / §3.7 |
| DEC-005 | "生产记录一变就失效"会使正常进度更新撤销批准 | 批准绑定**授权输入**；正常进度、交付凭据**不改变**原授权。**数量、金额、规格等越界**才阻断新执行并要求重批 | §3.7（失效影响）；§5.2（失效矩阵） | 就地标注 §3.7 |
| DEC-006 | G3 正文要求决策人，旧角色表/实现允许产品写角色放行 | 正式 G3 与 G1/G2 同由**指定决策人批准且禁止负责人自批**；负责人整理和记录执行 | §6.4（G3 权限）；§6.5（门禁总表 G3 放行人）；§9.2（角色×成果） | 就地标注 §6.4 / §6.5 / §9.2 |
| DEC-007 | 旧文档有"长任务可提前做 Worker"，又有明确冻结 | 采用更保守的**明确冻结**：PC-0/PC-1 **不引入 Worker**；真实问题另立项并获用户解冻 | §12.1（第 6 项）；§10.1 | 就地标注 §12.1（与本契约既有冻结一致，无需改口径） |
| DEC-008 | 完成报告与试点登记口径不同 | **工程通过、真实模型验证、专业确认、真实业务完成是四件事**，分别记账 | §11（差距登记）；§12.2 | 就地标注 §11 |
| DEC-009 | 公司成本引擎字段有"净利润"和固定税率/渠道预设 | 保留兼容字段，**不擅改公式**；页面标为"**按当前假设测算**"，展示口径与排除项；业务核定前**不称公司净利润或现行税务结论** | §3.2（成本口径）；§3.9（口径强制） | 就地标注 §3.2 |
| DEC-010 | 旧模型计划要求新增 `modules/llm/` | **不创建平行网关**；未来确有多协议需求再抽取公共适配层，不在本轮预先平台化 | §8.2（`/api/llm/*`） | 就地标注 §8.2 |

**旧条款保留为历史，执行以 DEC 为准。**

---

## 结构化成果与门禁契约（§1.7–1.10 对齐）

> 本节转写总计划 §1.7–§1.10，**保真转录**（字段名、枚举值、状态码一字不改）。总计划新增的结构化成果类型（`COMPANY_BRAND_BRIEF` / `COST_SCENARIO` / `PROFESSIONAL_ANALYSIS` / `PROFESSIONAL_CONFIRMATION` / `PRODUCTION_PLAN` / `BUSINESS_OBSERVATION`）与统一写入 helper（`H/src/modules/work/structured-artifacts.ts`，**新增，尚未实现**）以本节为准。

### A. 结构化成果公共字段（计划 §1.7）

**统一存储规则**：`Artifact.content` 保持字符串，结构化类型存经校验的 JSON。新增 `H/src/modules/work/structured-artifacts.ts`，定义 `validateStructuredArtifact()`、`writeStructuredArtifact()`、`readStructuredArtifact()`；写入复用或提取现有 `submitWork()` 的同事务路径，不另写一套提交/审核系统。

| 字段 | 类型与规则 |
| --- | --- |
| `schemaVersion` | 字符串；新成果初始 `1.0`；必须与 `Artifact.schemaVersion` 一致。旧类型若结构已不同则升版，不给旧自由文本补假版本 |
| `organizationId` | 由 session/项目关系推导并与 Artifact 列一致，不信任请求体 |
| `productId / productVersionId / projectId` | 从受权对象推导；公司级简报可无产品，项目成果必须完整关联 |
| `sourceRefs` | 来源 ID、内容 hash/版本、原文定位、获取时间；服务器验证可见性和归属 |
| `inputFingerprint` | 规范 JSON 的 SHA-256；键排序，引用集合按 ID 排序；只含业务输入，不含生成时间或排版 |
| `dataNature` | `REAL` 或 `DEMO`；与现有证据性质保持一致，禁止合成测试成果进入真实门禁 |
| `assumptions / missingInputs` | 显式数组；不得用空字符串或零掩盖缺失 |
| `recordedBy / confirmedBy / confirmedAt` | 记录人来自 session；专业确认另存实际确认人、范围和来源。未确认用 null，不填虚构人名 |

> 审批信息不只信任 JSON 的 `confirmedBy`：正式审核状态来自既有工作提交、审核记录和会话身份。公司级 `COMPANY_BRAND_BRIEF` 是项目关联的明确例外：其组织归属必填，产品/项目可以为空，经现有组织管理员权限和已确认事实生成并保存审计。

### B. 成果类型注册（计划 §1.7 成果类型表）

> 与本文 §4.2 既有注册表并列。既有 §4.2 已登记 `SPECIFICATION_BRIEF` / `MARKET_RESEARCH_REPORT` / `SUPPLIER_QUOTE` / `SAMPLE_ROUND` / `PRODUCTION_RECORD` / `BUSINESS_REVIEW` 与五类营销成果；下表为计划口径（含标注"新增"的类型）。

| 成果类型 | 最小业务字段 | 适用阶段与完成标准 |
| --- | --- | --- |
| `COMPANY_BRAND_BRIEF`（新增） | 公司/品牌目标、人群、渠道、资源、禁止项、已确认事实引用、确认版本 | PC-1；顾问能引用具体约束及其出处 |
| `SPECIFICATION_BRIEF`（复用） | 身份候选、规格、成分方向、体验目标、目标价/成本、验证要求 | PC-1；研发沟通稿，不冒称成熟生产配方 |
| `MARKET_RESEARCH_REPORT`（复用） | 用户场景、可比竞品、事实/假设、反证、路线、待验证项 | PC-1；每个重要外部判断可回到材料 |
| `COST_SCENARIO`（新增） | 引擎版本、输入来源、成交单位、币种、税/费用基数、结果、情景名 | PC-1；保存后刷新与重算一致，旧快照不被覆盖 |
| `PROFESSIONAL_ANALYSIS`（新增） | 结论、公司适配、路线比较、引用、风险、未知、建议动作、模型记录 | PC-1；模型结果经结构和引用校验，只形成草稿 |
| `SUPPLIER_QUOTE`（复用契约） | 工厂/供应商引用、规格、数量/MOQ、含税口径、单价、交期、有效期、付款条件 | PC-2；报价原件可定位且与生产版本一致 |
| `SAMPLE_ROUND`（复用契约） | 轮次、样品日期、版本、评价项、PASS/FAIL/CONDITIONAL、问题与处置 | PC-2；只有经人确认的 PASS 可满足对应生产条件 |
| `PROFESSIONAL_CONFIRMATION`（新增） | 领域、适用身份/地区/渠道、材料引用、确认范围、有效期、实际确认人和录入人 | PC-2；不能以一种专业确认代替所有专业确认 |
| `PRODUCTION_PLAN`（新增） | 数量、单位、预算、报价/样品/包装引用、交期、生产条件、停止条件 | PC-2；用于 G2 前置，不混入实际生产结果 |
| `PRODUCTION_RECORD`（复用契约） | 批次号、实际进度/数量、异常、交付凭据、授权包引用 | PC-2；记录事实，不自动发单 |
| 品牌/包装/渠道/价格/验证计划（复用已登记五类） | 产品和品牌版本、购买理由、表达与证据一一对应、禁用项、渠道、价格、验证目标 | PC-1 简版、PC-2 完整；生成不等于审核 |
| `BUSINESS_OBSERVATION`（新增） | 产品/版本、渠道、时间窗、币种、数量、收入、退款、费用来源、样本和口径 | PC-2；可人工录入/导入，重复导入可识别 |
| `BUSINESS_REVIEW`（复用契约） | 预期快照、实际观察引用、差异、局限、继续/调整/暂停建议、后续任务 | PC-2；不把单次结果写成普遍规律 |

> 未知 schema 版本返回 **422**；坏 JSON、错类型、负数量、非法币种/单位返回字段级错误；自由文本历史成果仍可阅读，但不能假装满足新结构门禁。所有成果新版本追加保存，旧批准继续指向旧内容。

### C. G0–G3 节点（计划 §1.8）

| 节点 | 输入 | 有权人 | 成功后的状态与动作 | 明确禁止 |
| --- | --- | --- | --- | --- |
| G0 方向确认 | 想法、公司适配、验证路线、已有研究授权 | 项目负责人 | `DRAFT → RESEARCH` 并记审计；不新增审批委员会 | 超出研究授权自动花钱 |
| G1 打样投入 | 当前版本、研究与反证、经济性、验证计划、预算范围、停止条件 | 指定决策人，且不是负责人 | G1 批准；项目进入 `SAMPLING`，至多创建一次准备任务 | 要求已有合格样品；自动记录样品通过 |
| G2 生产投入 | 新品样品 PASS 或既有产品适用确认、有效报价、专业/包装确认、生产计划、预算数量交期 | 指定决策人，且不是负责人 | G2 批准保留在 `PRODUCTION_PREP`；实际开工另行记录后进入 `PRODUCTION` | 把批准写成已生产；固定产品伪造 G1 |
| G3 上市放行 | 有效生产/供货依据、当前产品/价格/渠道/素材、专业确认、试销计划、未关闭阻断项 | 指定决策人，且不是负责人 | `DecisionPacket(LAUNCH_GATE)` 批准；LaunchPlan 记录引用与派生获准时间 | 用产品编辑权限代替决策权；自动标为已上市 |
| 实际交付/开售 | 真实动作说明、时间、对应授权与同产品/项目证据 | 当前项目负责人 | 实际生产交付进入 `DELIVERED`；实际开售另记日期及 `LAUNCHED` | 仅凭批准时间推断实际日期 |

> 新品在负责人确认样品阶段已完成且具有适用的 PASS 结论后，通过显式 `prepareProduction()` 命令从 `SAMPLING → PRODUCTION_PREP`；这仅表示可以整理生产决策材料，不代表生产获批。固定产品仍直接从 `PRODUCTION_PREP` 建档，不走这个转换。
>
> 新审批采用 `gateScope/v1` 的分门范围结构，放在冻结的 `DecisionPacket.snapshot` 中：产品版本、成果 ID+内容版本+hash、证据 ID+hash、报价有效期、预算币种/金额/范围、数量/单位、渠道、价格机制、包装/表达、停止条件。服务端从当前权威对象重新组装，不接受客户端传入的"已通过"判定。旧 G1 scopeHash 算法保留兼容读取；新范围算法按 `scopeSchemaVersion` 分支。

### D. 智能能力五层约束 + `ProfessionalAnalysisV1`（计划 §1.9）

**先做专业决策辅助，不做自治经营。** 复用 `advisor/llm.ts` 的接口；模型选择来自实际配置，不承诺任何模型质量、价格或上下文窗口。

| 层 | 输入与输出 | 约束 |
| --- | --- | --- |
| 上下文 | `CompanyFact`、公司品牌简报、产品版本、证据、成本快照、历史决定 | 先过滤权限，再检索；保存输入指纹、检索时间和实际引用 |
| 确定性事实 | `calcCost`、版本检查、来源状态、门禁、内部规则评分 | 不交给模型重算；规则评分不具有批准权 |
| 专业推理草稿 | 用户需求、路线比较、公司适配、反证、风险和验证方案 | 使用经验证结构；没有证据时输出不足，不凑路线数量 |
| 结果校验 | schema、引用归属/存在性、金额来源、非法动作、适用范围 | 不合格保留失败记录，不自动写成已确认成果 |
| 动作建议 | 白名单 `ActionProposal` 或人工可执行说明 | 用户确认后调用 `applyProposal` 等现有命令；不执行模型输出的任意代码 |

`ProfessionalAnalysisV1` 字段：`schemaVersion`、`conclusion`（`PROCEED_TO_VALIDATE / NEEDS_EVIDENCE / PAUSE / REJECT`）、`summary`、`companyFit[]`、`claims[]`（`FACT / INFERENCE / ASSUMPTION` + `sourceRefs`）、`alternatives[]`、`economicScenarioRef`、`risks[]`、`unknowns[]`、`recommendedActions[]`、`limitations[]`。所有引用必须来自本次授权上下文；不让模型凭空填写责任人 ID 或已批准金额。

> 运行记录区分：规则回答、真实 LLM 成功、真实调用失败后规则回退、测试替身、人工内容。兼容现有 `RunMode`，补充可审计的 `requestedMode / effectiveMode / fallbackReason / usageAvailability` 元数据；费用没有已核实单价就标未知。

### E. 成本 / 供应 / 营销 / 复盘口径（计划 §1.10）

- **成本**：前端实时试算可以保留；**保存时服务器用相同输入和固定引擎版本重新计算**，不接受客户端直接上传"最终利润"。每项关键数值记 `KNOWN / ASSUMED / UNKNOWN` 和来源；`0` 只表示确认为零，null 表示未知。目标成本、估算成本、确认报价分别展示；含税/不含税、单件/每盒/每套、币种、佣金计费基数和退款处理不得混算。当前引擎 **L1–L5 汇总、L6 月固定成本单列**的口径先保持。渠道费率、运费、税率和月固定成本预设均标"**待确认假设**"。PC-1 输出基础/保守情景；盈亏平衡在贡献不为正时显示"当前假设下无法达到"，不显示负件数或无穷大。金额输出按币种精度显式舍入。
- **供应**：报价和样品都先人工回传；外部原件与 AI 整理结果并存。比较仅在规格、数量、税费、运费、交期条件可比时成立；不同条件列差异，不只按最低单价排序。**报价确认不等于采购下单**。
- **品牌营销**：首版即写购买理由、差异、可信依据、价格机制和验证假设。生成素材必须绑定产品/品牌版本及表达依据；不能因为文案读起来合理就标"可发布"。
- **复盘**：记录实际数据来源和期间，先对照当时决策包预期，再提出调整。净成交、退款、已结算/未结算、费用归属期必须说明；复购、转化率等缺分母或观察期不足时不计算。**没有销售数据只能做准备复盘，不能伪称经营复盘完成。**

---

## 1. 九类成果总映射

| # | 业务成果 | 主对象 | 承载与版本 | 当前状态 | 本契约的关键结论 |
| --- | --- | --- | --- | --- | --- |
| 1 | 公司 / 品牌简报 | `CompanyFact`（按 `category` 分组）+ `KnowledgeSource/Document/Chunk` | `CompanyFact.validFrom/validUntil/supersededById`；简报**整体指纹**记在 `AnalysisRun.inputSnapshot` | 源码存在，未接线（无写入入口） | **不新增表**。品牌简报 = `CompanyFact.category="brand"` 的键值集合。若出现"简报变更 → 列出受影响分析"的独立查询需求，再新增 `CompanyBriefSnapshot` |
| 2 | 产品版本 | `ProductVersion` | `versionTag` + `isImmutable` + `isConfirmed`；`specs Json` 需带 `schemaVersion` | 运行已验证 | 既有对象够用。**缺口**：`specs` 无 schema 版本，历史 `specs` 结构不可迁移 |
| 3 | 项目 | `Project` + `ProjectMember` | `revision`；`mode` × `stage` 二维 | 运行已验证 | 既有够用。**G0 不建决策包**，用 `stage: DRAFT→RESEARCH` + `AuditEvent` 留痕（见 §6.1） |
| 4 | 证据 | `Evidence` + `EvidenceClaim` + `DataGap` | `Evidence.hash`；`nature(REAL/DEMO)` × `verifyStatus` × `validationStatus` | 运行已验证 | 既有够用。**契约要求**：任何投入金额的放行，其依据必须是 `nature=REAL ∧ verifyStatus=VERIFIED` 的 FACT |
| 5 | 报价 | `Artifact(type=SUPPLIER_QUOTE)` | `content`（JSON 字符串，顶层带 `schemaVersion`）+ `contentVersion` | **待新增**（`supply/` 为 `BOUNDARY_ONLY` 空壳） | 首版**不新增表**，但**必须**遵守 §4.3 的 schema；出现"到期自动阻断"或"跨供应商比价"查询时升级为独立表 |
| 6 | 样品 | `Artifact(type=SAMPLE_ROUND)` + `WorkItem` + `WorkSubmission` | 轮次 = `contentVersion`；结论 = `ArtifactApplicability` / `WorkSubmission.reviewedById` | **待新增** | 同上。样品"通过"必须由人确认，不得由 `ArtifactReviewStatus` 自动置 `ACCEPTED` |
| 7 | 生产记录 | `Artifact(type=PRODUCTION_RECORD)` + `Project.stage` + `LaunchMilestone(kind=SUPPLY)` | `RunReceipt.runMode`；`WorkItem.inputRevision` | **待新增** | **G2 目前是空门**：`GateType.PRODUCTION_GATE` 枚举存在但**全仓无任何代码使用**（grep 实测）。见 §6.3 |
| 8 | 营销成果 | `Artifact(type=BRAND_*/PACKAGING_*/CHANNEL_*)` | `contentVersion` + `evidenceRefs` | **待新增**（`brand-marketing/` 目录不存在） | **真实 schema 缺口**：`Artifact` **没有 `productVersionId`，也没有 `organizationId`**。营销成果必须绑定产品版本才能"改产品定义即失效文案"，见 §3.8 |
| 9 | 经营复盘 | `Artifact(type=BUSINESS_REVIEW)` + `Evidence`（销售/费用）+ `WorkItem` | 预期取自 `DecisionPacket.snapshot`；实际取自 `Evidence` | **待新增**（`reviews/` 目录不存在） | 复盘结论**不自动**成为公司规则；只能作为 `CompanyFact(status=PENDING)` 候选中转，须人工确认 |

---

## 2. 贯穿性契约（所有成果共用）

### 2.1 身份与组织

- 所有命令携带服务端 `session`（`organizationId` + `userId`），**不接受客户端传入 actor / organizationId**。
- 跨组织一律 **404**（`NotFoundError`，与"不存在"同码同文案，不泄露存在性）；同组织无权 **403**（`ForbiddenError`）；无凭证 **401**。
- 产品级写权限收口在 `requireProductRole(session, productId, PRODUCT_WRITE_ROLES)`（`src/modules/identity/product-access.ts`）。**读与写必须分别传角色集合**，不得图省事统一传 `[OWNER]`。
- **组织级角色（2026-09-16 已修复，D-003）**：`isOrgAdmin` 只看 `OrganizationMember.role = ORG_ADMIN`，**不再**由"本组织任一项目的 `OWNER`"推断 —— 那个近似口径曾使**任何成员"建项目即自升组织管理员"**，可读知识来源配置（含服务器 `rootPath`）。无成员记录一律按非管理员处理，**不回退**到项目角色。见 §9.1 / §9.3 / §7.3。

### 2.2 版本与不可变

- `ProductVersion.isImmutable` 默认 `true`；发布 ≠ 业务确认（`isConfirmed` 默认 `false`，须单独动作）。
- `Artifact.contentVersion`、`WorkItem.inputRevision`、`Project.revision`、`Evidence.hash`、`ArtifactApplicability.contentHash` 共同构成"版本可追溯链"。
- 历史快照不得被最新结果覆盖：`AnalysisRun.supersedesRunId` 指向被替代的上一轮；`DecisionPacket.snapshot` 冻结提交时刻。

### 2.3 幂等

- 统一机制：`src/shared/idempotency.ts` + `IdempotencyRecord`（`key @unique`、`commandScope`、`requestHash`、`responseStatus`、`responseBody`）。
- 语义：同 `key` + 同 `requestHash` → 返回原响应（`wasReplayed: true`）；同 `key` + **不同载荷** → `409 ConflictError`。
- `ActionProposal.idempotencyKey @unique`：模型提议重复点击/重试不重复写入；`baseVersionHash` 支持产品已变时重新校验。
- **幂等键作用域** = `(actorId, commandScope)`。跨用户共享同名键不算重放。

### 2.4 错误码契约

| 场景 | 错误类型 | HTTP | 备注 |
| --- | --- | --- | --- |
| 无权限（同组织） | `ForbiddenError` | 403 | |
| 跨组织 / 不存在 | `NotFoundError` | 404 | 同码同文案，不泄露存在性 |
| 无凭证 / 会话失效 | 认证中间件 | 401 | 登出后 cookie 与 bearer 双通道均失效 |
| 版本冲突 / 旧快照 / 幂等载荷冲突 | `ConflictError` | 409 | 含 `scopeHash` 变动触发的旧批准失效 |
| 缺输入 / 证据缺口未闭合 / 字段格式无效 | `UnprocessableEntityError` | 422 | 内置校验先于鉴权（见 §7.2）；**必填字段缺失**同样归此列，错误体含 `fieldErrors` 点名缺失字段（D-008） |
| 请求体形态不被端点接受（如向 multipart 上传端点发 JSON） | `UnsupportedMediaTypeError` | 415 | 2026-09-16 新增。此前是原生 `TypeError` → **500**（D-008） |
| 请求体**为空 / 畸形 JSON** | 中央映射 `handleApiError` | **400** `INVALID_JSON` | **D-011，已实施**。此前是原生 `SyntaxError` → 500。判定**刻意收窄**：只认 message 含 `json` 的 `SyntaxError`，业务里其它 SyntaxError 仍走 500 |
| 请求体是合法 JSON 但**不是对象**（`null` / 数组 / 标量） | `readJsonObjectBody` 抛 `UnprocessableEntityError` | **422** | **D-016，已实施**。此前被 `req.json().catch(() => ({}))` 静默当空 body |
| Prisma 入参校验失败 | 中央映射 | **422** `UNPROCESSABLE_ENTITY` | **D-012，已实施** |
| **唯一键冲突 `P2002` / 外键 `P2003` / 关系约束 `P2014`** | 中央映射 `PrismaClientKnownRequestError` | **409** `CONFLICT` | **D-015，已实施**（2026-09-16 第二批）。此前一律 **500**。与 `ConflictError` 同码。生产环境只给固定文案，不回显 `meta.target` / Prisma code |
| **目标记录不存在 `P2025`** | 中央映射 | **404** `NOT_FOUND` | **D-015，已实施**。与 `NotFoundError` 同码 |
| 其它 Prisma 错误（连接故障 `P1001`、超时等） | 中央映射**不变** | **500** | **刻意不扩大映射**：这是服务端/DB 故障，不是「调用方发错了」 |
| 缺必填字段冒到**原生 `TypeError`**（如对 `undefined` 调 `.trim()`） | 服务层边界校验 | **422**（点名字段） | **D-017 / D-018，已实施**。修法统一为「收集缺失项 → 一次 422」，不逐条试错 |

### 2.5 请求体（body）语义契约

**写路由读 JSON body 只允许一种姿势**：`readJsonObjectBody(req)`（`src/shared/request-body.ts`）。三态语义如下，**不许再有第四种**：

| 情况 | 行为 | 理由 |
| --- | --- | --- |
| ① 真正**不带 body**（`req.text()` 为空） | 返回 `{}`，**继续走业务逻辑** | 「POST 不带 body」是既有被支持的**合法**调用（前端多处、测试脚手架大量使用）。删掉容错会误伤它们 |
| ② 有 body 但**解析失败** | 原样抛原生 `SyntaxError` → 中央映射 **400** | 调用方发了坏 JSON 却拿到 201 或 500，都是误导 |
| ③ 合法 JSON 但**不是对象**（`null` / `[]` / `"x"` / `1`） | **422** | 此前 `null` 会让 `body.status` 抛 TypeError → 500；若当 `{}` 又正是 D-016 的 fail-open 来源 |
| ④ ❌ **`req.json().catch(() => ({}))`** | **禁止使用** | 它把「畸形 JSON」与「没有 body」混为一谈：调用方的字段被静默丢弃后按默认值继续跑。已由矩阵 F 段守卫断言 `caught === 0` 钉死（D-016） |

**⚠️ 已实测并登记的副作用**（不是缺陷，是这些端点的既有默认语义，但调用方必须知道）：对下列端点**不带 body** 是一次**真实写入**，不是空操作：

| 端点 | 不带 body 的实际结果 |
| --- | --- |
| `POST /api/conversations` | **201**，真建一条会话（标题取默认值） |
| `POST /api/evidences/{id}/verify` | **200**，证据被置为 `VERIFIED` 并写 `EVIDENCE_VERIFIED` 审计事件（该端点语义即「POST 即核实，传 `REJECTED` 才驳回」） |
| `POST /api/products/{id}/analyses` | **201**，真建一次分析运行 |
| 其余 helper 路由（launch / approve / milestones / proposals / confirm / reject / plan PATCH / revisions） | 422 或 409；`launch/plans/{id}` PATCH 为 200 且不改状态 |

**因此**：矩阵 F 段对 `helper` 路由**只探畸形 JSON、不探空 body**（探空 body 会写数据）；这条「空 body 行为」目前**没有回归护栏**，是本契约的已知留白。

---

## 3. 逐类契约

### 3.1 公司简报 / 品牌简报

**对象**：`CompanyFact`（`@@unique([organizationId, key])`）+ `KnowledgeSource` / `KnowledgeDocument` / `KnowledgeChunk` + `KnowledgeSyncRun`。

| 维度 | 契约 |
| --- | --- |
| 键空间 | `key` 形如 `company.name`、`company.channels.primary`、`brand.positioning`、`brand.tone`、`brand.forbidden_copy`。**`category` 决定归属**：`company` / `brand` / `channel` / `general` |
| 生效与失效 | `status: PENDING→CONFIRMED→SUPERSEDED`；`validFrom` / `validUntil`；被替代时 `supersededById` 指向新版本，**不删除旧行** |
| 来源 | `sourceDocId` + `sourcePath` 指向知识文档；资料冲突**并列展示并要求确认**，不自动合并 |
| 简报指纹 | 每次分析必须在 `AnalysisRun.inputSnapshot` 写入 `companyBriefFingerprint`（对"参与本次分析的 (key,value,status,validFrom) 集合"排序后哈希） |
| 命令 | `upsertCompanyFact` / `confirmCompanyFact`（`src/modules/knowledge/facts.ts`，源码存在，静态确认） |
| 权限 | 组织管理员 = `OrganizationMember.role = ORG_ADMIN`（2026-09-16 起）。**既不收窄也不放宽**：持有项目 `OWNER` **不再**带来公司级能力 |
| REST | `GET/POST/PATCH /api/knowledge/facts`（已存在）；`GET /api/knowledge/search`；`POST /api/knowledge/sources`、`POST /api/knowledge/sources/{id}/sync` |
| 硬约束 | **聊天记录不自动变成公司事实**。模型产出的候选只能进 `status=PENDING`，须人工 `confirmCompanyFact` |
| 新增对象 | **无。** 触发升级条件：出现"简报变更 → 列出受影响分析/成果"的**独立查询或约束**需求时，新增 `CompanyBriefSnapshot`（`organizationId` + `fingerprint` + `generatedAt` + `factIds Json`）。在此之前用 `AnalysisRun.inputSnapshot` 承载即可 |

### 3.2 产品版本

**对象**：`Product` + `ProductVersion`。

| 维度 | 契约 |
| --- | --- |
| 版本粒度 | 一个 `Product` 下多 `ProductVersion`，`@@unique([productId, versionTag])` |
| 规格结构化 | `specs Json` **必须**顶层含 `schemaVersion`（建议 `"1.0"`）与 `items[]`；`unknowns Json` 显式列出未定字段，**不得省略以伪装完整** |
| 成本口径 | `targetCost Decimal(12,2)` + `currency`。区分**目标成本 / 估算成本 / 确认报价**；报价不得写入 `targetCost` |
| 生命周期 | `Product.lifecycleStage`（`IDEA/ANALYSIS/SAMPLING/LAUNCH_PREP/LAUNCHED/REVIEW/PAUSED`）与 `Project.stage` **不是一对一**；`actualLaunchDate` 只由实际上市证据确认，**不因审批通过自动写** |
| 命令 | `createDevelopmentProduct`（原子创建 `Product` + `ProductVersion(v1)` + 首个 `Project` + `ProjectMember` + `AuditEvent`）、`publishProductVersion`、`createRevision` |
| 权限 | 写：`PRODUCT_WRITE_ROLES`（`requireProductRole`）；读：`PRODUCT_READ_ROLES` |
| REST | `POST /api/products`、`POST /api/products/ingest`、`POST /api/products/{id}/versions`、`GET/POST /api/products/{id}/revisions`、`GET /api/products/{id}/revisions/compare`、`POST /api/products/{id}/analyses` |
| 失效影响 | 产品版本变更 → 所有引用旧 `productVersionId` 的 `DecisionPacket`（`scopeHash` 含 `productVersionId`）失效；`AnalysisRun` 保留但标 `supersedesRunId` 链；营销成果若未绑定版本则**无法判断失效**（见 §3.8 缺口） |
| 新增对象 | **无**（除 §3.8 建议给 `Artifact` 加 `productVersionId` 外）`specs.schemaVersion` 目前只存在于 JSON 内，**不可查询**；是否加列见 §10.2 |

> ⚠️ 本表「成本口径」一行已被 **DEC-009** 取代（见 §决策对齐）：保留兼容字段、**不擅改公式**；凡涉及"净利润"或固定税率/渠道预设，页面一律标为"**按当前假设测算**"，业务核定前不称公司净利润或现行税务结论。

### 3.3 项目

**对象**：`Project` + `ProjectMember`（`@@unique([projectId, userId])`）。

| 维度 | 契约 |
| --- | --- |
| 二维状态 | `mode`（`NEW_PRODUCT` / `FIXED_PRODUCT`，即双路径）× `stage`（`DRAFT→RESEARCH→SAMPLING→PRODUCTION_PREP→PRODUCTION→DELIVERED`） |
| 产品关联 | `productId`（显式，可空以保留探索项目）+ `productVersionId`（本轮锁定版本） |
| 责任 | `ownerId`（唯一日常负责人，必填）+ `decisionMakerId`（放行人，可空即"未指定"） |
| 成员角色 | `Role`：`OWNER` / `DECISION_MAKER` / `FEEDBACK_PROVIDER` / `VIEWER` / `DIGITAL_WORKER` / `ORG_ADMIN`（`ORG_ADMIN` 当前**无人持有**） |
| 命令 | `createWorkItem`（任务）、`POST /api/projects`（创建）、`PATCH /api/projects/{id}` |
| 权限 | 项目成员按角色；`requireProjectRole` |
| REST | `GET/POST /api/projects`、`GET/PATCH /api/projects/{id}` |
| 硬约束 | 一个项目**只有一个**日常负责人；系统不得创建虚构身份绕过审批（`docs/产品愿景.md` §3.1） |
| **读可见范围（2026-09-16 拍板：组织内可读）** | Hermes 是**内部产品中心**，不是客户隔离型 SaaS。口径：**组织内成员可读本组织产品；项目成员/负责人按角色拥有修改、版本、分析、上市等写权限。** 实现：读路径 `requireProductRead`（只看组织归属，跨组织/不存在统一 404 不泄露存在性）；写路径 `requireProductRole` + `PRODUCT_WRITE_ROLES`（不变）。若将来真出现"保密新品"，再引入 `visibility = ORG / PROJECT / RESTRICTED`，**不要现在把所有读取都项目化** |
| 新增对象 | **无** |

### 3.4 证据

**对象**：`Evidence` + `EvidenceClaim` + `DataGap`。

| 维度 | 契约 |
| --- | --- |
| 三态分列 | `nature`（`REAL`/`DEMO`）· `verifyStatus`（`UNVERIFIED`/`VERIFIED`/`REJECTED`）· `validationStatus`（`UNAPPLIED`/`IN_PROGRESS`/`VERIFIED_BY_LEAD`）。三者**独立**，不得互相推导 |
| 断言分层 | `EvidenceClaim.kind`：`FACT`（原文直接支撑）/ `INFERENCE`（基于证据的推断）/ `ASSUMPTION`（未确认假设）。**仅已核实 FACT 参与事实判断** |
| 价格格式 | 价格类 claim **必须**带 `spec`（规格）+ `unit`（计价单位）+ `mechanism`（到手价/划线价/组合装价）。缺任一 **422**。严禁单盒价与组合装价混算 |
| 冲突处理 | `conflictGroup` 归组 + `selectionReason` 记录选用理由；**不静默覆盖** |
| 缺口 | `DataGap`（`@@unique([projectId, fieldKey])`，`OPEN→FILLED`）。缺 `price` 已核实 FACT → 建议包提交 **422**（P1-02 规则，运行已验证） |
| 附件 | `fileKey`（存储键，**不得下发到浏览器**）/ `fileSize` / `mimeType` / `originalFilename` |
| 权限 | `VERIFIED` 由有权限人员置；`validationStatus=VERIFIED_BY_LEAD` **仅 `OWNER` 可手置**，模型与纯函数一律不得写入 |
| REST | `POST /api/projects/{id}/evidences`、`POST /api/evidences/{id}/verify`、`POST /api/projects/{id}/attachments`、`GET /api/attachments/{id}`、`GET /api/projects/{id}/evidence-gaps` |
| 失效影响 | `Evidence.hash` 变更 → 引用它的 `DecisionPacket.scopeHash`（`evidenceVersions`）失效；`ArtifactApplicability.contentHash` 变更 → 该条适用性确认失效 |
| 新增对象 | **无** |

### 3.5 报价

**对象（v1）**：`Artifact`（`type="SUPPLIER_QUOTE"`）+ `WorkItem` + `WorkSubmission`。

| 维度 | 契约 |
| --- | --- |
| 归属 | 报价是一次**外部回传**：由负责人回传，系统不自动外联（SEC-002） |
| 结构化内容 | `Artifact.content` 存 JSON 字符串，**顶层必须**含 `schemaVersion`，结构见 §4.3 |
| 有效期 | `validUntil`（ISO 日期）写在 JSON 内。**G1 前置校验必须读取它并判断是否已过期** |
| 轮次与多份 | 同一供应商多轮报价 = 多条 `Artifact`（不同 `contentVersion`），保留全部历史，不覆盖 |
| 审核 | `producerType=MANUAL`（外部回传）或 `AI`（AI 整理，**不得**直接 `reviewStatus=ACCEPTED`）；`WorkSubmission.status` 由人审 |
| 权限 | 写：`PRODUCT_WRITE_ROLES`；确认：`OWNER` |
| REST | **缺口**：无 `/api/supply/*` 入口（`src/modules/supply/` = `BOUNDARY_ONLY`）。TASK-011 落地 |
| 失效影响 | 报价过期 → 依赖它的 `DecisionPacket`（G2）必须重新校验；`productVersionId` 或 `formSpec` 变更 → 全部报价需重新核对 |
| 新增对象 | **待拍板**。首版不建表（无"到期自动阻断"以外的独立查询需求）。触发升级条件：出现 ①"按 `validUntil` 批量查/自动阻断" ②"跨供应商同口径比价" ③"报价参与成本引擎自动计算" → 新增 `SupplierQuote` 表（`organizationId`、`supplierRef`、`currency`、`validUntil`、`moq`、`paymentTerms`、`lines Json`、`artifactRef`）。见 §10 |

### 3.6 样品

**对象（v1）**：`Artifact`（`type="SAMPLE_ROUND"`）+ `WorkItem`（`executorType=HUMAN`）+ `WorkSubmission` + `RunReceipt`。

| 维度 | 契约 |
| --- | --- |
| 轮次 | 一轮样品 = 一条 `WorkItem` + 一条 `Artifact`（`contentVersion` 递增）。轮次**不可跳过**，不允许"补录"伪造历史轮次 |
| 结构化内容 | `content` JSON：`schemaVersion`、`round`、`factoryRef`、`sampleDate`、`items[]`、`verdict`（`PASS`/`FAIL`/`CONDITIONAL`）、`issues[]`、`nextAction` |
| 结论归属 | 样品"通过"**必须由人**确认（`RUNNING → SUBMITTED → ACCEPTED`，`reviewedById` 非空）；`ArtifactReviewStatus` 不得自动置 `ACCEPTED` |
| 问题处置 | `issues[]` 每条可派生 `WorkItem` 或 `Feedback`（`FeedbackStatus`：`OPEN`/`ACCEPTED`/`REJECTED`/`NEEDS_INFO`） |
| 权限 | 提交：`FEEDBACK_PROVIDER` 及以上可回传；接受/退回：`OWNER` |
| REST | **缺口**：无专用入口；当前只能走 `POST /api/work-items/{id}/submissions` + `POST /api/work-items/{id}/reviews` |
| 失效影响 | 样品轮次结论不通过 → G1 不得放行；`formSpec` 变更 → 全部样品轮次需重判 |
| 新增对象 | **待拍板**，同 §3.5 逻辑。若"轮次对比视图"需要独立聚合，再新增 `SampleRound` |

> ⚠️ 本表「失效影响」一行（原写"样品轮次结论不通过 → G1 不得放行"）已被 **DEC-002** 取代（见 §决策对齐）：**G1 批准打样投入，不要求尚未产生的样品通过**；样品结论属于 **G2** 依据。

### 3.7 生产记录

**对象（v1）**：`Artifact`（`type="PRODUCTION_RECORD"`）+ `Project.stage` + `LaunchMilestone`（`kind="SUPPLY"`）+ `RunReceipt`。

| 维度 | 契约 |
| --- | --- |
| 状态 vs 记录 | `Project.stage=PRODUCTION_PREP/PRODUCTION/DELIVERED` 是**状态**；生产记录是**成果**（谁在什么条件生产了多少） |
| 结构化内容 | `content` JSON：`schemaVersion`、`batchNo`、`quantity`、`factoryRef`、`producedAt`、`conditions`、`exceptions[]`、`deliveryConfirmation` |
| 事件 | 排期 / 反馈 / 异常 / 交付确认，全部走 `WorkItem` + `WorkSubmission` + `RunReceipt`；**不建第二套任务系统** |
| 外部副作用 | 只记录**内部确认**或**收到的外部凭据**；系统**不自动向工厂发单**（SEC-002） |
| 权限 | 写：`PRODUCT_WRITE_ROLES`；G2 放行：`DECISION_MAKER`（防自批） |
| REST | **缺口**：`/api/projects/{id}/production*` 不存在。TASK-013 落地 |
| 失效影响 | 生产记录变更 → G2 批准失效；数量/规格变更 → G3 上市依赖重新校验 |
| 新增对象 | **无**（除非生产记录需要独立批次台账查询） |

> ⚠️ 本表「失效影响」一行（原写"生产记录变更 → G2 批准失效"）已被 **DEC-005** 取代（见 §决策对齐）：批准绑定**授权输入**，正常进度、交付凭据**不改变**原授权；仅**数量/金额/规格等越界**才阻断新执行并要求重批。

### 3.8 营销成果

**对象（v1）**：`Artifact`（`type="BRAND_PURCHASE_REASON"` / `"PACKAGING_BRIEF"` / `"CHANNEL_CONTENT"` / `"PRICE_MECHANISM"` / `"MARKETING_VALIDATION_PLAN"`）。

| 维度 | 契约 |
| --- | --- |
| 绑定版本 | 营销成果**必须**绑定 `productId` + `productVersionId` + 品牌版本。产品定义/价格/品牌承诺任一变更 → 相关营销成果**标记为待复验**，不得继续沿用 |
| **真实缺口** | `Artifact` **既没有 `organizationId`，也没有 `productVersionId`**。它通过 `workItemId → WorkItem.projectId → Project.organizationId/productVersionId` 间接绑定（`WorkItem.projectId` 是**必填**，`artifact.workItemId` 是**可空**）。因此：① 组织隔离依赖项目链，**无项目的成果无法隔离**；② 营销成果若挂在项目上，就只能绑定该项目锁定的那一个版本，**跨项目/跨版本的品牌素材无处安放** |
| 已实施增量（2026-09-16） | `Artifact` 已加 `organizationId String?` + `productVersionId String?` + `schemaVersion String?`（**可空加列**，不删列不改类型），见 §10.2 I-001..I-003。写入路径均已赋值：`work/service.ts`（沿 `workItem → project` 推导）与 `products/product-suggestion.ts`（`SPECIFICATION_BRIEF` / `MARKET_RESEARCH_REPORT`，`schemaVersion = "1.0"`）。历史行按 `workItem → project` 回填组织与版本；`schemaVersion` **有意留空**（历史 content 是自由文本，填 "1.0" 等于替数据断言它并不满足的结构） |
| 素材状态 | "AI 生成素材" ≠ "已审核"。`producerType=AI` 的成果不得 `reviewStatus=ACCEPTED`；`LaunchMilestone(kind="MATERIAL")` 记录素材就绪 |
| 外部发布 | **不自动对外发布**（SEC-002）。`LaunchMilestone.actual*` 与 `LaunchPlan.actualLaunchedAt` 只由实际动作/证据写 |
| 权限 | 写：`PRODUCT_WRITE_ROLES`；品牌口径确认：品牌专业确认人（**当前角色模型无此角色 → 待拍板**，见 §9.3） |
| REST | **缺口**：无 `/api/marketing/*`、无 `/api/launch/plans/{planId}` 之外的素材入口。TASK-014 落地 |
| 新增对象 | 建议给 `Artifact` 加列（见上）；**不新建** `MarketingAsset` 表，直到出现"素材版本树/发布日历"类独立需求 |

### 3.9 经营复盘

**对象（v1）**：`Artifact`（`type="BUSINESS_REVIEW"`）+ `Evidence`（销售/费用）+ `WorkItem` + `DecisionPacket.snapshot`（预期）。

| 维度 | 契约 |
| --- | --- |
| 预期 vs 实际 | **预期**取自 `DecisionPacket.snapshot` / `Artifact`（`contentVersion` 冻结）；**实际**必须来自 `Evidence`（真实渠道数据，标 `nature`/`verifyStatus`/样本/时间范围/局限） |
| 结构化内容 | `content` JSON：`schemaVersion`、`period`、`channel`、`netSales`、`expenseBase`、`refundStatus`、`sampleSize`、`limitations`、`expectedVsActual[]`、`verdict`（`SCALE`/`ADJUST`/`PAUSE`）、`nextTasks[]` |
| 口径强制 | `currency` + 费用基数 + 含税口径必须显式；**贡献利润不得写成净利润**；未知不按零 |
| 结论去向 | 加码/调整/暂停建议 → 派生 `WorkItem`；**经验候选 → `CompanyFact(status=PENDING)`**，须人工确认才成为组织规则 |
| 停止线 | 触线即建议停止，**不自行放宽**；暂停建议不自动改项目状态 |
| 权限 | 记录：`PRODUCT_WRITE_ROLES`；结论确认：`OWNER` + 产品中心负责人 |
| REST | **缺口**：无 `/api/reviews/*`。TASK-015 落地 |
| 失效影响 | 复盘引用的 `Evidence` 被 `REJECTED` → 复盘结论标记失效 |
| 新增对象 | **无**（v1） |

---

## 4. 成果类型注册表（`Artifact.type` + `schemaVersion`）

### 4.1 为什么需要这张表

`Artifact.type` 是自由字符串，`content` 是自由字符串。若不登记，同一个业务概念会被写成 `"QUOTE"` / `"报价"` / `"supplier_quote"` 三种，`scoreHash` 与门禁校验将无法稳定识别。**本节是本契约对 §0.3 的落地**。

### 4.2 已登记类型

| `type` | 中文 | 序 | 绑定版本 | `schemaVersion` | 必需引用 | 谁可 ACK |
| --- | --- | --- | --- | --- | --- | --- |
| `SPECIFICATION_BRIEF` | 产品规格简报 | 2 | 项目锁定的 `productVersionId` | `1.0` | 至少 1 条 `EvidenceClaim` | `OWNER` |
| `MARKET_RESEARCH_REPORT` | 市场研究报告 | 4 | 项目 | `1.0` | `evidenceRefs` 非空 | `OWNER` |
| `SUPPLIER_QUOTE` | 供应商报价 | 5 | `productVersionId` | `1.0` | `validUntil` 必填 | `OWNER` |
| `SAMPLE_ROUND` | 样品轮次 | 6 | `productVersionId` | `1.0` | 上一轮（若有） | `OWNER` |
| `PRODUCTION_RECORD` | 生产记录 | 7 | `productVersionId` | `1.0` | 报价 + 样品 | `OWNER` |
| `BRAND_PURCHASE_REASON` | 品牌购买理由 | 8 | `productVersionId` + 品牌版本 | `1.0` | 产品定义 + 证据 | 品牌确认人（待定） |
| `PACKAGING_BRIEF` | 包装简报 | 8 | 同上 | `1.0` | 同上 | 品牌确认人（待定） |
| `CHANNEL_CONTENT` | 渠道内容 | 8 | 同上 | `1.0` | 渠道要求规则项 | 品牌确认人（待定） |
| `PRICE_MECHANISM` | 价格机制 | 8 | `productVersionId` | `1.0` | 成本引擎结果 | `OWNER` |
| `MARKETING_VALIDATION_PLAN` | 营销验证计划 | 8 | 同上 | `1.0` | — | `OWNER` |
| `BUSINESS_REVIEW` | 经营复盘 | 9 | `productVersionId` | `1.0` | 销售 `Evidence` | 产品中心负责人 |

> 序 = §1 九类成果编号。前两项是**既有代码已在用的值**（`src/modules/products/product-suggestion.ts:434/438`），其余为**本契约新增登记、尚未实现**。

### 4.3 JSON 内容规范（以报价为例，其余同构）

```json
{
  "schemaVersion": "1.0",
  "supplierRef": "受控引用（不放供应商真名，若含敏感信息）",
  "factoryRef": null,
  "currency": "CNY",
  "validUntil": "2026-10-31",
  "moq": null,
  "paymentTerms": null,
  "incoterms": null,
  "lines": [
    { "itemKey": "packaging.outer", "spec": "…", "unit": "…", "unitPrice": null, "note": null }
  ],
  "unknowns": ["unitPrice"],
  "attachments": ["<evidenceId 或 fileKey，不得下发 fileKey 到浏览器>"]
}
```

规则：
1. **`schemaVersion` 必须置顶**；解析时先读它，未知版本 → **拒绝解析并报 422**，不得"尽力猜"。
2. **`unknowns` 必须显式**，缺值不省略、不填 0。
3. 敏感内容（供应商真名、价格明细）**只登记受控引用**，不抄进文档、不进日志。
4. 数字一律字符串或数字，**不带货币符号**；货币由 `currency` 表达。

---

## 5. 版本与失效关系

### 5.1 指纹载体

| 载体 | 覆盖内容 | 变更时谁失效 |
| --- | --- | --- |
| `ProductVersion.versionTag` | 一次产品版本 | 引用它的 `DecisionPacket.scopeHash`、`AnalysisRun`（旧轮次标记被替代） |
| `Project.revision` | 项目输入基线 | `Artifact.inputRevision` 落后 → 成果需重新适用性确认（`ArtifactApplicability`） |
| `Evidence.hash` | 单条证据内容 | `DecisionPacket.scopeHash`（`evidenceVersions`）；`ArtifactApplicability.contentHash` |
| `Artifact.contentVersion` / `contentHash` | 单条成果内容 | `DecisionPacket.scopeHash`（`artifactVersions` 只取 `type` + `version`） |
| `DecisionPacket.scopeHash` | `projectId` + `gate` + `productVersionId` + `artifactVersions` + `evidenceVersions` + `budget*` + `validationPlan` | 任一变动 → 旧批准失效，须重提 |
| `CompanyFact.validFrom/validUntil/supersededById` | 公司/品牌事实 | 引用它的分析结论（须人工判断，不做自动回溯） |
| `KnowledgeDocument.contentHash` | 知识文档内容 | 切片重建；不自动回溯历史引用 |

### 5.2 失效矩阵（改左列 → 右列全部需重验）

| 改动 | 受影响对象 | 机制 |
| --- | --- | --- |
| 产品定义 / 规格（`ProductVersion.specs`） | 规格简报、报价、样品轮次、生产记录、全部营销成果、G1/G2 决策包 | 新版本 → `productVersionId` 不同 → `scopeHash` 变化 → **409 阻断** |
| `targetCost` / 成本输入 | `calcCost` 结果、价格机制、G1 预算、G2 报价 | 成本快照重算；旧决策包 `budgetAmount` 变化 |
| 证据 `hash` / 被 `REJECTED` | 依赖该证据的成果、`AnalysisRun.evidenceFingerprint`、决策包 | `scopeHash` 变化 |
| 成果内容变更（同 `type` 新 `contentVersion`） | 决策包 `artifactVersions` | `scopeHash` 变化 |
| 公司/品牌事实更新 | 后续分析使用的简报指纹；历史结论**不自动回溯** | `AnalysisRun.inputSnapshot` 记指纹，供人工比对 |
| `formSpec` / 剂型规格 | 报价、样品、包装简报、渠道内容 | 需重新核对 |
| 报价过期（`validUntil`） | G2 决策包 | 门禁校验读 JSON 判断 |
| `Project.ownerId` 变更 | 责任链与所有待办 | `AuditEvent` 留痕 |
| 品牌承诺变更 | 全部营销成果 | **当前无法自动判定**（见 §3.8 缺口） |

### 5.3 历史保留原则

- 失效 = **标记**，不是删除。`ProductVersion`、`Artifact`（多 `contentVersion`）、`DecisionPacket`、`Decision`、`Evidence` 均**只增不改**。
- 旧批准失效后仍可查询，但 `isValidApproval` 口径必须由 `src/lib/approval/valid-approval.ts` 类的**单一判定函数**给出（`hermes-next` 当前对应 `src/modules/decisions/` 内的 scope 校验），**禁止在业务代码里散写 `decision === "APPROVE"`**。

---

## 6. G0–G3 门禁契约

### 6.1 G0 方向确认（非正式放行）

| 项 | 契约 |
| --- | --- |
| 定义 | 在**已有授权范围内**确认方向，不是投入批准（REQ-005） |
| 承载 | `Project.stage: DRAFT → RESEARCH` + `AuditEvent(action="PROJECT_DIRECTION_CONFIRMED")` |
| 不做什么 | **不创建 `DecisionPacket`**，不占用 `GateType` 枚举 |
| 权限 | `OWNER`；`decisionMakerId` 若已指定则同时记录 |
| REST | `PATCH /api/projects/{id}` |
| 待拍板 | 是否需要独立的"确认人 + 确认时间"结构化字段（当前只有审计事件） |

### 6.2 G1 研发打样门 = `GateType.RESEARCH_SAMPLING_GATE`

| 项 | 契约 |
| --- | --- |
| 前置 | ① `productVersionId` 非空（`decisions/service.ts:45` 强制）② 必需成果类型齐 ③ 关键证据缺口闭合（`price` 须有已核实 FACT）④ `budgetAmount` + `budgetScope` + `validationPlan` 非空 |
| 成果 | `DecisionPacket`（`status: DRAFT→IN_REVIEW→APPROVED`）+ `Decision`（`APPROVE`/`REQUEST_CHANGES`/`DEFER`/`REJECT`/`WITHDRAW`） |
| 快照 | 提交时写 `snapshot`（冻结 `scopeHash` 与输入版本） |
| 权限 | `submit`: `OWNER`；`decide`: `DECISION_MAKER`，**防自批**（提交人 ≠ 决定人） |
| 幂等 | 同 `scopeHash` 重复提交 → 复用；`scopeHash` 变化 → **409** |
| REST | `POST /api/projects/{id}/decision-packets`、`POST /api/decision-packets/{id}/submit`、`POST /api/decision-packets/{id}/decide` |
| 状态 | **运行已验证**（`test:p1` F16/F17/F33、`test:revision` D1–D4） |

### 6.3 G2 生产门 = `GateType.PRODUCTION_GATE`

| 项 | 契约 |
| --- | --- |
| 前置 | G1 已 `APPROVED` 且未失效；报价有效期内；样品轮次结论 `PASS`；生产记录与数量/交付条件齐 |
| 成果 | `DecisionPacket(gate=PRODUCTION_GATE)` + `Decision` |
| **真实缺口** | `GateType.PRODUCTION_GATE` **枚举存在但全仓无任何代码使用**（grep 实测：仅 `decisions/service.ts` 的默认值与一处展示文案引用 `RESEARCH_SAMPLING_GATE`）。G2 的创建/校验/放行逻辑**不存在** |
| 与 G1 的区别 | G2 必须额外绑定报价、样品、包装、数量、预算；**修改关键输入后 G1 不自动延续**（REQ-005） |
| REST | **缺口**：复用 `POST /api/projects/{id}/decision-packets`（需支持 `gate` 入参） |
| 待拍板 | G2 是否必须引用"已确认配方/成分"对象（当前无该对象，`RISK-004` 领域判断失真风险） |

> ⚠️ 本表「前置」一行（原写"G1 已 `APPROVED`…样品轮次结论 `PASS`…生产记录…齐"）已被 **DEC-003 / DEC-004** 取代（见 §决策对齐）：**固定产品路径不伪造 G1**（用已确认版本及其适用证据）；**G2 前需要生产计划、报价、数量与确认资料，实际生产记录在批准后产生**，不构成循环依赖。

### 6.4 G3 上市放行 = `DecisionPacket` 授权 + `LaunchPlan` 执行（**2026-09-16 已拍板统一授权机制**）

| 项 | 契约 |
| --- | --- |
| 承载 | `LaunchPlan.status`（`DRAFT/ACTIVE/BLOCKED/COMPLETED/CANCELLED`）+ `approvedAt`（获准）+ `actualLaunchedAt`（实际上市） |
| 门禁 | `computeLaunchGate` 逐项检查 → `approveLaunch` / `revokeLaunchApproval` / `confirmLaunchExecution` |
| 里程碑 | `LaunchMilestone.kind`：`MATERIAL` / `CHANNEL` / `SUPPLY` / `COMPLIANCE` / `OTHER`；`workItemId` 复用既有 `WorkItem` |
| **批准 ≠ 执行** | `approvedAt` 写入**不**改 `Product.actualLaunchDate`；实际上市只由 `confirmLaunchExecution` + 证据写 |
| 权限 | 复用 `assertLaunchWritePermission`（内部已收口到 `requireProductRole`）+ `PRODUCT_WRITE_ROLES` |
| REST | `GET/POST /api/products/{id}/launch`、`PATCH /api/launch/plans/{planId}`、`POST /api/launch/plans/{planId}/approve`、`DELETE .../approve`（撤销）、`POST .../launch`（确认执行）、`POST .../milestones` |
| **授权机制（2026-09-16 拍板）** | **统一"授权机制"，不统一"业务对象"**。<br>· `DecisionPacket → Decision` 只回答"**允许不允许做**" —— G1 打样批准 / G2 生产批准 / G3 上市批准**全部**通过它形成正式授权记录。<br>· `LaunchPlan` 只回答"**批准后怎么做、做到哪了**" —— 上市时间 / 责任人 / 里程碑 / 依赖 / 渠道准备 / 实际开售 / 执行状态。<br>因此 G3 审批**不得**继续留在 `LaunchPlan.approvedAt` 自成第二套审批系统：该字段将来必须由一条 `Decision` 派生。<br>**实施时机**：等 G3 首次真实可达（PC-2/PC-3）时执行，本批不动代码 —— 需要 `GateType.LAUNCH_GATE`（= I-006）与 `approveLaunch` 改造，属"当前试点不需要"的工程，按冻结原则不提前做。<br>**继续保持的纪律**：批准 ≠ 执行中 ≠ 实际完成 |

> ⚠️ 本表「权限」一行（原写"复用 `assertLaunchWritePermission` + `PRODUCT_WRITE_ROLES`"）已被 **DEC-006** 取代（见 §决策对齐）：**正式 G3 与 G1/G2 同由指定决策人批准且禁止负责人自批**；产品编辑权限不得代替决策权。

### 6.5 门禁总表

| 门 | 正式放行 | 承载对象 | 前置必需成果 | 放行人 | 状态 |
| --- | --- | --- | --- | --- | --- |
| G0 | 否 | `Project.stage` + `AuditEvent` | 产品想法 | `OWNER` | 运行已验证 |
| G1 | 是 | `DecisionPacket(RESEARCH_SAMPLING_GATE)` | 规格简报 + 市场研究 + 合规证据 + 预算 | `DECISION_MAKER` | 运行已验证 |
| G2 | 是 | `DecisionPacket(PRODUCTION_GATE)` | + 报价 + 样品 + 生产条件 | `DECISION_MAKER` | **空门（未实现）** |
| G3 | 是 | `LaunchPlan` | + 素材 + 渠道 + 供货 | `PRODUCT_WRITE_ROLES` | 运行已验证（机制不同） |

> ⚠️ 本表 **G3 行「放行人 `PRODUCT_WRITE_ROLES`」已被 DEC-006 取代**（见 §决策对齐）：G3 放行人应为**指定决策人且禁止负责人自批**（与 G1/G2 同口径）。

---

## 7. 幂等与错误契约（含已登记缺陷）

### 7.1 幂等边界

| 命令族 | 幂等载体 | 语义 |
| --- | --- | --- |
| 通用写命令 | `IdempotencyRecord.key` + `requestHash` | 同键同载荷 → 重放；同键异载荷 → **409** |
| 顾问提议 | `ActionProposal.idempotencyKey` + `baseVersionHash` + `expectedRevision` | 重复确认不重复写；产品已变 → 提议 `SUPERSEDED` |
| 决策包 | `scopeHash` | 同范围重复提交复用；范围变化 → **409** |
| 成果适用性 | `ArtifactApplicability.@@unique([artifactId, submissionId])` + `contentHash` | 同成果同一提交只一条；内容变 → 确认失效 |

### 7.2 「内置校验先于鉴权」的行为（不是缺陷，但必须被测试预期覆盖）

`POST /api/conversations/{id}/messages`、`POST /api/projects/{id}/feedback` 等路由**先做请求体校验再鉴权**，因此空体调用对**跨组织身份**会返回 **422** 而非 403/404。

**实测结论**：这不构成越权。422 由校验器产生，跨组织写入仍被后续鉴权阻断（已在 B8 矩阵中以"零写入断言"证明整轮跑完相关表计数与既有行指纹不变）。

**契约要求**：新路由统一改为「先鉴权、后校验」；若保留现状，必须在 B8 矩阵中登记为 `validationFirst: true`，期望值写 `NO_2XX`（不得成功），而非精确 403。

### 7.3 缺陷登记与处置状态（2026-09-16 更新）

| # | 现象 | 影响 | 处置（2026-09-16） |
| --- | --- | --- | --- |
| D-001 | `Product.identityCode` 曾为**全局唯一**（`@unique` 无 `organizationId` 复合），跨组织同名 → 状态码 | 组织 A 建产品 "X" 后组织 B **无法**建同名；且 B 能**确定地**得知"该码被占" | ✅ **已修复（2026-09-20，TASK-008）**。<br>**修复前两段历史（保留可追溯）**：① **错误映射半边**（2026-09-16）：500 → **409 `CONFLICT`**（D-015）。② **约束半边**当时未做：应然为 `@@unique([organizationId, identityCode])`（§10.2 I-005），因迁移链不可回放（D-006）→ 本批明令不做。彼时本项被**订正升格**为「跨组织存在性 oracle（弱：不泄露行数据与组织身份，仅暴露"编码是否被占"）」，与 §2.3「跨组织一律 404、不泄露存在性」口径不一致。<br>**本次修复**：`schema.prisma` 改 `@@unique([organizationId, identityCode])` + 迁移 `20260920235500_product_identity_code_org_scoped_unique`（先决条件 D-006 已由 TASK-007 解除，故约束半边才可落地）。`identityCode` 为 NOT NULL ⇒ 「全局唯一」严格强于「组织级唯一」，迁移**不可能**因既有数据失败，产品 id 全部保留（计划 TASK-008 要求）。<br>**回归证据**：`tests/acceptance-http-errors.ts` 戊段（跨组织同码 → **201**；同组织重复 → **409**；201 响应不含组织 A 标识与产品 id；DB 级两条独立同码记录）+ `tests/acceptance-authz-matrix.test.ts` 场景 6b（6b.1–6b.9 同构回归，含跨组织列表不可见）。原「覆盖盲点」至此关闭 |
| D-002 | `SignalItem` 唯一约束为全局 `@@unique([sourceKey, hash])`，服务层在跨组织同标题时抛 422「该信号已属于其他组织」 | **泄露他组织存在性** | ✅ **已修复**。唯一约束改 `@@unique([organizationId, sourceKey, hash])`；`organizationId` 收紧为 **NOT NULL**（可空列在唯一键里会被 `NULLS DISTINCT` 绕过）；服务层去重查询按组织范围、删除泄漏分支。反向回归：B8 场景 6 |
| D-003 | `isOrgAdmin` 近似为"本组织任一项目 `OWNER`" → 建项目即自升管理员 | 可读知识来源配置（含服务器 `rootPath`） | ✅ **已修复**。新增最小 `OrganizationMember(organizationId, userId, role, createdAt)`，`isOrgAdmin` 只看该表；无记录 = 非管理员，**不回退**到项目角色。反向回归：B8 场景 5 |
| D-004 | `Artifact` 无 `organizationId` / `productVersionId` / `schemaVersion` | 无项目成果无法隔离；营销成果无法绑定版本 | ✅ **已实施 I-001/I-002/I-003**。历史行按 `workItem → project` 回填；`schemaVersion` 有意不回填 |
| D-005 | `GateType.PRODUCTION_GATE` 无实现 | G2 空门 | 未修。PC-2 前置（TASK-012），不在本批 |
| D-006 | `prisma/migrations` **无法回放**：`SignalSource` / `SignalItem` / `ResearchRun` / `ResearchRunTask` / `ResearchRunSnapshot` 在**任何**迁移中都没有 `CREATE TABLE`，而 `20260913220000_*` 却 `ALTER TABLE "SignalItem"`。在空库上 `migrate deploy` 直接失败（实测：`relation "SignalItem" does not exist`） | 无法用迁移从零重建数据库；新环境只能靠 `db push`；「迁移即真相」这一前提不成立 | **曾为新发现（2026-09-16），已于 2026-09-20 修复（TASK-007）**。修复前现状：两个本地库均由 `db push` 建立，与 `schema.prisma` **逐表一致**（`migrate diff` 输出为空迁移）→「迁移即真相」不成立。✅ **修复**：新增基线迁移 `20260913120000_add_signal_research_run_baseline`（排序在首次缺表引用 `20260913220000` 之前；3 枚举 + 5 表 + 索引/外键，表达该历史时点的真实结构，**未**用当前整库 schema 冒充历史建表），空库 `migrate deploy` 跑到 exit 0；新增 `scripts/verify-migration-replay.ts` 复现四条路径（空库建库 / 已知历史库升级 / 部分匹配拒绝 / 幂等重放）全绿；既有库按「先验证完整结构，再仅补该迁移账本」收口。详见 `MIGRATION_REPLAY_REPORT.md`「TASK-007 修复与复验」 |
| D-007 | `Artifact` 三字段在 DB 层**可空**（I-001..I-003 按契约登记为 `String?`） | 写入方若忘记赋值不会有编译/约束错误 | **已知取舍，非缺陷**：可空是为兼容历史行。已由写入路径赋值 + `test:product-center` 断言新成果携带组织，两者共同兜底。若日后要收紧为 NOT NULL，需先确认不存在无项目成果 |
| D-008 | 写路由把 `req.json()` / `req.formData()` **原样透传给 service，不校验必填字段**；缺字段时 Prisma 抛 `PrismaClientValidationError`、`req.formData()` 抛原生 `TypeError` → **500**。而生产环境响应体被消毒成「An internal server error occurred」，调用方无从定位少了哪个字段 | 实测 3 条：`POST /api/projects/{id}/attachments`（发 JSON 而非 multipart）、`POST /api/projects/{id}/feedback`（缺 `targetId`）、`POST /api/work-items/{id}/submissions`（缺 `inputRevision`）。**更严重的是发现方式**：`ownerGate: "NOT_DENIED"` 旧判据是「非 401/403/404」，**把 500 当成门禁已开**，30 条路由的 owner 侧断言因此一直分不清「正常」与「崩溃」 | ✅ **已修复**。三条路由分别映射 **415 / 422 / 422**，422 附 `fieldErrors` 点名缺失字段；`submitWork` 的校验有意置于**鉴权之后**（前置会把 404 变 422，反而给出资源存在性旁证）。门禁收紧为「非 401/403/404 **且非 5xx**」，并新增独立汇总断言「有权身份段无任何 5xx」（不依赖逐条门禁写法）。反向回归：B8 场景 7（9 断言，故意发错 body 断言 4xx + 点名字段） |
| D-009 | `components/logout-button.tsx` 的可见文字只有「退出」（完整短语仅存于 `title`），而无障碍名默认取自内容 | `tests/ui-b01-evidence.ts` 以 `name: "退出登录", exact: true` 匹配 → **0 命中、30s 超时**；该套件 9 条实质断言全过，却因末步不可达而**始终非绿**（且看不出是哪一步断了） | ✅ **已修复**。组件补 `aria-label`（顺带修好屏幕阅读器只念「退出」的问题），**不放宽测试选择器**。UI 套件 9 → **13 项全过**。另记：`src/app/logout-button.tsx` 是无人引用的历史遗留副本，未删 |

| D-015 | `PrismaClientKnownRequestError` **一个都没映射** —— 唯一键冲突 `P2002` / 外键 `P2003` / 关系约束 `P2014` / 目标记录不存在 `P2025` 全部落到 500 兜底 | 调用方拿"服务端崩了"，无从自纠。**契约 §2.4 早已写明"唯一键冲突应映射 409"却从未实施**（本行原登记在旧表中） | ✅ **已修复**（2026-09-16 第二批）。`P2002/P2003/P2014 → 409 CONFLICT`、`P2025 → 404 NOT_FOUND`；**其余 Prisma code（连接故障等）保持 500**（刻意收窄）。生产环境固定文案，实测不含 Prisma code / `meta.target` / 路径 / 栈。反向回归：`tests/acceptance-http-errors.ts` 甲段（摘掉映射即 4 条红） |
| D-016 | 13 文件 / 14 处 `req.json().catch(() => ({}))` 把**畸形 JSON 静默当空 body** | 字段被静默丢弃后按默认值继续跑。其中 `POST /api/evidences/{id}/verify` 是 **fail-open**：调用方本意"**驳回**"，body 一旦畸形即被当作空 body → 条件不成立 → **执行成"通过"并写 `EVIDENCE_VERIFIED` 审计事件**（证据核实是 G4 打样门槛前置） | ✅ **已修复**。统一改用 `readJsonObjectBody`（§2.5 三态语义）：空 body → `{}`、畸形 → 400、非对象 → 422。矩阵 F 段新增**守卫断言 `caught === 0`** 防复发；`http-errors` 乙段做**fail-open 反向回归**（畸形 body 后证据仍 `UNVERIFIED`、审计 0→0）。实测修复前：畸形 → **200 且证据被翻成 VERIFIED、审计 0→1**；body `null` → 500；body `[]` → 200 |
| D-017 | 缺必填字段冒到**原生 `TypeError`** → 500（是 D-008 的同类尾巴，只是抛错方从 Prisma 换成原生 TypeError） | `products/service.ts` 的 `createProduct` 只校验 `name`/`identityCode`，却直接 `params.targetAudience.trim()` → 缺 `targetAudience`/`marketPath`/`devMode` 即 500 | ✅ **已修复**。复用同文件 `createDevelopmentProduct` 的既有范式（收集缺失项 → 一次 422 点名字段）。反向回归：`http-errors` 丙段 |
| D-018 | 决策包缺 `artifactVersions` / `evidenceVersions` → **500**。根因是**数组迭代未兜底**（`scope-hash.ts` 的 `[...input.artifactVersions]` 展开 `undefined`），与 D-017 的"属性上调用方法"是**不同形态** | `POST /api/projects/{id}/decision-packets` 发 `{}` 或部分 body 即崩；调用方无从知道"范围必须显式声明" | ✅ **已修复**。① 服务层边界校验（`Array.isArray` 判定缺省与错类型 → 422 点名字段，**允许空数组**）；② `computeScopeHash` 开头加不变量守卫，**刻意响亮失败而非静默当 `[]`**——静默兜底会产出"覆盖空范围"的指纹，而 `scopeHash` 是批准有效性的绑定依据，指纹错了会让批准被错误复用。<br>**共享面已核**：该函数另被两处**读路径**共用（`projects/service.ts:179`、`decisions/service.ts:481`）。两库实测（开发库 1 行 / 测试库 25 行）**均无** NULL 或非数组的存量行；且即便有，此前也是 `[...null]` 抛 TypeError → 500（若是字符串则 `[..."abc"]` 静默按字符迭代出**错误指纹**）→ 现在 422，属改善。<br>反向回归：`http-errors` 丁段 |
| D-022 | `createDecisionPacketDraft` 对**跨组织**项目与**不存在**的项目**均返回 403**（`requireProjectRole` → `ForbiddenError`）；而 `submitDecisionPacket` / `decideDecisionPacket` 对跨组织返回 **404**。**同一资源族内两套状态码** | 与契约 §2.3「跨组织一律 404、不泄露存在性」**字面不一致**；但**不构成泄露**（见右） | **登记，不静默修**（2026-09-20）。**不构成泄露的论证 + 证据**：`requireProjectRole`（`src/modules/identity/session.ts:271-289`）只按 `(projectId, userId)` 查 `projectMember`，**不查项目存在性**；封口实测：**不存在的 projectId → 403**，与**跨组织 → 403** **同码**，故 403 不可用于判定存在性。**证据位置 = `tests/acceptance-gate-boundaries.test.ts` 场景 2 断言 2.4 / 2.4b**。**处置**：本批**只登记，不改鉴权语义**——统一 403/404 口径会波及全部路由，须单独批次 + 全路由回归。**风险等级：低**（不可用于枚举存在性） |

**D-014 的方法论教训（本批最值得留下的一条）**：D-017 / D-018 都是"缺字段 → 500"，但**形态不同**（属性上调用方法 vs 数组迭代未兜底）。用 `params\.[a-zA-Z_]+\.` 这类**静态正则**只能扫到前者，会得出"只有一处"的**错误结论**；D-018 是改用**实证穷举**（对全部写路由发 `{}` 与部分 body，统计 5xx）才撞出来的。**结论：凡声称"某类缺陷已穷尽"，必须给出实证穷举的覆盖数，不得只凭静态扫描**。同理，`authz-matrix.ts:382` 的 `{{IDENTITY}}` 异码夹具使 D-001 **在矩阵里永远撞不上**——**夹具设计本身会造成覆盖盲点**。

D-002 / D-003 / D-008 由 B8 矩阵（`tests/acceptance-authz-matrix.test.ts`）实测发现；D-009 由 UI 套件实测发现；D-015 / D-016 / D-017 / D-018 见于 2026-09-16 第二批（D-017 由静态扫描、D-018 由实证穷举发现）。均已修复并补反向回归断言。

**D-008 的教训值得单独记一句**：门禁写成「排除若干拒绝码」时，**必须同时排除 5xx**。否则被测路由一旦崩溃，它反而更"容易通过"——崩溃越彻底，越不会被判为拒绝。

---

## 8. REST 入口清单

### 8.1 现状：43 条路由 / 60 个方法（实测）

登记路径以 `src/app/api/**/route.ts` 为准；方法数由 `tests/authz-matrix.ts` 穷举并逐格断言。

| 类别 | 路由 | 方法 |
| --- | --- | --- |
| 认证 | `/api/auth/session` | GET · POST · DELETE |
| 健康 | `/api/health`、`/api/health/details` | GET ×2 |
| 附件 | `/api/attachments/{id}` | GET |
| 项目 | `/api/projects` | GET · POST |
| | `/api/projects/{id}` | GET · PATCH |
| | `/api/projects/{id}/attachments` | POST |
| | `/api/projects/{id}/evidences` | POST |
| | `/api/projects/{id}/evidence-gaps` | GET |
| | `/api/projects/{id}/feedback` | POST |
| | `/api/projects/{id}/work-items` | POST |
| | `/api/projects/{id}/decision-packets` | POST |
| | `/api/projects/{id}/research-runs` | GET · POST |
| | `/api/projects/{id}/suggestions` | GET · POST |
| | `/api/projects/{id}/opportunity` | GET · PATCH |
| 产品 | `/api/products` | GET · POST |
| | `/api/products/ingest` | POST |
| | `/api/products/{id}/versions` | POST |
| | `/api/products/{id}/revisions` | GET · POST |
| | `/api/products/{id}/revisions/compare` | GET |
| | `/api/products/{id}/analyses` | POST |
| | `/api/products/{id}/launch` | GET · POST |
| 上市 | `/api/launch/plans/{planId}` | PATCH |
| | `/api/launch/plans/{planId}/approve` | POST · DELETE |
| | `/api/launch/plans/{planId}/launch` | POST |
| | `/api/launch/plans/{planId}/milestones` | POST |
| 决策 | `/api/decision-packets/{id}/submit` | POST |
| | `/api/decision-packets/{id}/decide` | POST |
| 任务 | `/api/work-items/{id}/submissions` | POST |
| | `/api/work-items/{id}/reviews` | POST |
| | `/api/feedback/{id}/disposition` | POST |
| 证据 | `/api/evidences/{id}/verify` | POST |
| 研究 | `/api/research-runs/{runId}` | GET |
| 顾问 | `/api/conversations` | GET · POST |
| | `/api/conversations/{id}/messages` | POST |
| | `/api/proposals` | GET · POST |
| | `/api/proposals/{id}/confirm` | POST |
| | `/api/proposals/{id}/reject` | POST |
| 知识 | `/api/knowledge/facts` | GET · POST · PATCH |
| | `/api/knowledge/search` | GET |
| | `/api/knowledge/sources` | GET · POST |
| | `/api/knowledge/sources/{id}/sync` | POST |
| 信号 | `/api/signals` | GET · POST |

合计 **43 条路由 / 60 个方法**，全部登记在 `tests/authz-matrix.ts` 并在 `tests/acceptance-authz-matrix.test.ts` 中逐格断言（**465/465 通过 × 连续两遍**；2026-09-16 由 434 扩至 455 补入场景 5 org-admin 自举回归与场景 6 跨组织信号存在性泄漏回归，再由 455 扩至 465 补入场景 7「缺必填字段的写请求必须回 4xx」与「有权身份段无任何 5xx」汇总断言）。

### 8.2 契约要求但**尚不存在**的入口

| 缺什么 | 服务于 | 计划任务 |
| --- | --- | --- |
| `/api/supply/quotes*` | 报价回传、有效期、比价 | TASK-011 |
| `/api/supply/samples*` | 样品轮次、问题处置 | TASK-011 |
| `/api/projects/{id}/production*` | 生产准备、排期、异常、交付确认 | TASK-013 |
| `/api/marketing/briefs*` | 购买理由、包装简报、渠道内容、价格机制 | TASK-014 |
| `/api/reviews*` | 经营观察、复盘记录 | TASK-015 |
| `/api/llm/*`（模型配置状态） | 真实模型端点与费用口径 | TASK-006 |

> ⚠️ 本表 `/api/llm/*` 一行已被 **DEC-010**（并含 **DEC-001**）取代（见 §决策对齐）：**不创建平行网关**，复用 `advisor/llm.ts` 的 `OpenAICompatibleClient`；旧台账"完全无模型调用"已过期，但**默认关闭**，不得据"有客户端"宣称真实模型对话已可用。

**登记规则**：新增路由**必须先加入 `tests/authz-matrix.ts`**。B8 的覆盖检查会把"文件系统存在但未登记"的路由直接判为失败，防止新路由绕过权限回归。

---

## 9. 权限契约

### 9.1 两级授权

| 层级 | 判定 | 位置 |
| --- | --- | --- |
| 产品级·写 | `requireProductRole(session, productId, PRODUCT_WRITE_ROLES)` → 404（跨组织/不存在）/ 403（同组织无项目角色） | `src/modules/identity/product-access.ts` |
| 产品级·读 | `requireProductRead(session, productId)` → **只看组织归属**，同组织任意成员可读；跨组织/不存在统一 404 | `src/modules/identity/product-access.ts` |
| 项目级 | `requireProjectRole(session, projectId, roles)` | `src/modules/identity/` |
| 组织管理员 | `assertOrgAdmin` / `isOrgAdmin` = `OrganizationMember.role = ORG_ADMIN`（2026-09-16 起，不再是近似口径） | `src/modules/identity/admin.ts` + `org-membership.ts` |

### 9.2 角色 × 成果类别

| 成果 | `OWNER` | `DECISION_MAKER` | `FEEDBACK_PROVIDER` | `VIEWER` | `DIGITAL_WORKER` | `ORG_ADMIN` |
| --- | --- | --- | --- | --- | --- | --- |
| 公司/品牌简报 | 确认 | 读 | 读 | 读 | — | 管理（当前口径） |
| 产品版本 | 发布 | 读 | 读 | 读（组织内可读） | — | 读 |
| 项目 | 全权 | 读 + 放行 | 读 + 回传 | 读（组织内可读） | — | 读 |
| 证据 | 核实 / 置 `VERIFIED_BY_LEAD` | 读 | 提交 | 读（组织内可读） | — | 读 |
| 报价 / 样品 | 接受 / 退回 | 读 | 回传 | 读（组织内可读） | — | 读 |
| 生产记录 | 写 | 写 + G2 放行 | 读 | 读（组织内可读） | — | 读 |
| 营销成果 | 写 | 读 | 读 | 读（组织内可读） | — | 读 |
| 经营复盘 | 记录 + 确认 | 读 | 读 | 读（组织内可读） | — | 读 |
| G1 放行 | 提交 | **决定**（防自批） | — | — | — | — |
| G2 放行 | 提交 | **决定**（防自批） | — | — | — | — |
| G3 放行 | 提交 / 确认执行 | 读 | — | — | — | — |

> ⚠️ 本表「G3 放行」一行已被 **DEC-006** 取代（见 §决策对齐）：G3 与 G1/G2 同由**指定决策人决定且防自批**；负责人仅整理和记录执行。

> **读口径已于 2026-09-16 拍板为"组织内可读"**（§3.3 / §9.3），因此上表不再有"待拍板"单元格。`DIGITAL_WORKER` 当前无任何实现，列为 `—` 是**有意保留**（冻结项，PC-4 前不实现）。

### 9.3 权限事项：已决与仍待决

**已决（2026-09-16）**

| # | 事项 | 决定 |
| --- | --- | --- |
| 1 | B4 产品**读**可见范围 | **组织内成员可读本组织产品**；写仍按项目角色。保密新品出现时再加 `visibility`，不预先项目化 |
| 2 | B7 组织级角色 | **做，但只做最小模型**：`OrganizationMember(organizationId, userId, role = ORG_ADMIN \| MEMBER, createdAt)`。**不做人事系统** —— 不加部门、岗位、汇报线、职位等级 |
| 3 | `Role.ORG_ADMIN` 枚举值 | **保留**（历史数据兼容），但它对 `isOrgAdmin` **不再有任何影响**。项目角色只决定项目内能力，组织级能力只由 `OrganizationMember` 决定 |

**仍待决（不阻塞 PC-1 工程侧）**

4. **品牌/渠道专业确认人**：`Role` 枚举中**没有**对应角色（现只有 `DECISION_MAKER` / `FEEDBACK_PROVIDER`）。营销成果与渠道规则由谁确认？→ 真实试点跑起来后再定，**不预先造角色**。

---

## 10. 必要新增对象清单（最小集）

### 10.1 结论：**不新增任何领域表**

九类成果都能用既有对象 + `Artifact.type` 注册表表达。**这是有意的克制**（GUD-001：能用结构化成果表达就先不建表）。

明确**不建**的对象：
- ❌ 第二套产品表（复用 `Product` / `ProductVersion`）
- ❌ 第二套任务表（复用 `WorkItem` / `WorkSubmission` / `RunReceipt`）
- ❌ 第二套审批表（复用 `DecisionPacket` / `Decision`）
- ❌ `portfolio` / `agent-runtime` / 复杂 `brand-marketing` 平台化对象（**冻结项**）
- ❌ `economics` / `intelligence` / `jarvis` 的 BOUNDARY_ONLY 空壳（**冻结项：禁止为"模块完整"而实现**）

### 10.2 最小 schema 增量（**已按批准范围实施**）

| # | 增量 | 类型 | 理由 | 不做会怎样 | 状态（2026-09-16） |
| --- | --- | --- | --- | --- | --- |
| I-001 | `Artifact.organizationId String?` | 加列 + 索引 | D-004：无项目成果无法隔离；审计与查询需要直接按组织过滤 | 品牌级/组织级成果只能挂项目，无法独立成表 | ✅ **已实施** |
| I-002 | `Artifact.productVersionId String?` | 加列 + 索引 | §3.8：营销成果必须绑定版本，否则"改产品定义 → 文案失效"无法判定 | 依赖 `workItemId` 间接推断，跨项目成果无法绑定 | ✅ **已实施** |
| I-003 | `Artifact.schemaVersion String?` | 加列 | §4.3：`schemaVersion` 只在 JSON 内则**不可查询**，无法按版本批量处理历史数据 | 需全表解析 JSON，无法安全迁移 | ✅ **已实施** |
| I-004 | `SignalItem` 唯一约束改 `@@unique([organizationId, sourceKey, hash])`（或 hash 内加入 org） | 改约束 | D-002：跨组织泄露存在性 | 跨组织同标题录入失败并泄露他组织信息 | ✅ **已实施**（并把 `organizationId` 收紧为 NOT NULL） |
| I-005 | `Product` 唯一约束改 `@@unique([organizationId, identityCode])` + 冲突映射 409 | 改约束 + 代码 | D-001：跨组织同名 → 500 | 组织 B 无法建与组织 A 同名的产品；且 B 能确定得知"该码被占"（存在性 oracle） | ✅ **已实施（2026-09-20，TASK-008）**。① **冲突映射**：`P2002 → 409 CONFLICT`（D-015，中央映射，先前已做）。② **约束变更**：`schema.prisma` 改 `@@unique([organizationId, identityCode])` + 迁移 `20260920235500_product_identity_code_org_scoped_unique`（先决条件 D-006 已由 TASK-007 解除）。③ **代码**：`products/service.ts` 的重试查重由单列 `findUnique({ where: { identityCode } })` 改为复合键 `organizationId_identityCode`。回归：`http-errors` 戊段 + `authz-matrix` 场景 6b |
| I-006 | `GateType` 加 `LAUNCH_GATE` | 加枚举值 | §6.4：统一授权机制需要 G3 也有自己的门类型 | G3 与 G1/G2 机制不一致，放行口径分裂 | 📄 **方向已定，暂不实施**（见 §6.4）：G3 首次真实可达时执行 |

**本轮执行方式与证据**（SEC-003）：
1. 全部为 `ADD COLUMN` / `CREATE TABLE` / `ALTER COLUMN SET NOT NULL` / `ADD CONSTRAINT`，**无删列、无改类型**。
2. 纯增量 SQL 由 `prisma migrate diff --from-url <当前库> --to-schema-datamodel` 生成，再**手工插入数据回填**（Prisma 不生成 DML）—— 回填语句的位置是有意安排的（见下）。
3. **先排练后落地**：先在临时 schema 上用旧 schema 建表并执行迁移，确认无语法/依赖错误；再 `pg_dump` 备份两个本地库（`dev` / `test`）后才应用。
4. **落地后核对**：两库 `migrate diff` 对 `schema.prisma` 输出 **`-- This is an empty migration.`**，即迁移产物与 schema 完全一致（不是"看起来对"）。
5. 数据回填核对：每个既有用户都有 `OrganizationMember` 记录，且**每个组织至少一个 `ORG_ADMIN`**（避免迁移后组织被锁死）；`Artifact.organizationId` 已按 `workItem → project` 回填。
6. 迁移文件：`prisma/migrations/20260916010000_org_membership_signal_scope_artifact_fields/migration.sql`。

> ⚠️ 与 `D-006` 有关：本迁移文件本身是**纯增量**且已核对，但**迁移链整体仍不可回放**（缺 `SignalItem` 等建表）。因此新环境仍需 `db push`，不能只靠 `migrate deploy`。

### 10.3 触发升级为独立表的条件（预先约定，避免临时起意）

| 若出现… | 则新增 |
| --- | --- |
| 需要"简报变更 → 列出受影响分析"的独立查询 | `CompanyBriefSnapshot` |
| 需要"报价按 `validUntil` 批量查/自动阻断"或"跨供应商比价" | `SupplierQuote`（+ `SupplierQuoteLine`） |
| 需要"样品轮次对比视图"独立聚合 | `SampleRound` |
| 需要"生产批次台账"独立查询 | `ProductionBatch` |
| 需要"素材版本树 / 发布日历" | `MarketingAsset` |

---

## 11. 本契约与本轮实现的差距（诚实登记）

| 契约条款 | 实现状态 |
| --- | --- |
| 九类成果映射（§1） | 4 类运行已验证（简报基础设施 / 产品版本 / 项目 / 证据），1 类空门（生产记录 → G2），4 类**完全未实现** |
| 成果类型注册表（§4） | 2 个类型已在用，9 个已登记未实现；`schemaVersion` 已**有可查询列**（I-003），但对自由文本成果仍**不强制**（`null` = 未版本化） |
| G0–G3（§6） | G0/G1/G3 运行已验证；**G2 空门**；G3 授权机制**已拍板统一到 `DecisionPacket`**（实施待 G3 可达） |
| 版本与失效（§5） | `DecisionPacket.scopeHash` 与 `ArtifactApplicability` 运行已验证；`Artifact.productVersionId` 已落地，营销成果**已具备**绑定版本的载体（判定逻辑待营销成果实现） |
| 幂等与错误（§7） | 通用与提议幂等运行已验证；**D-002 / D-001 已修复并回归**（D-001 于 2026-09-20 TASK-008 收口），**D-006（迁移链不可回放）已于 TASK-007 修复** |
| REST 入口（§8） | 43/60 已登记并逐格断言；6 组缺口入口未实现 |
| 权限（§9） | 写路径收口运行已验证；**读可见范围（B4）已拍板为"组织内可读"并已实现**；**组织角色（B7）已以最小 `OrganizationMember` 落地**，D-003 自举已修 |
| 新增对象（§10） | **零新增领域表**；6 项最小增量中 **I-001–I-005 已实施**（I-005 于 2026-09-20 TASK-008 落地），I-006 方向已定暂不实施。新增的唯一表是 `OrganizationMember`（身份基础设施，非成果领域表） |

**结论（2026-09-16 更新）**：本契约仍是 **PC-0 契约侧交付**。经 2026-09-16 拍板，§9.3 的读口径与组织角色、§6.4 的 G3 授权机制均已确定，§10.2 的 I-001..I-004 已按批准范围实施，因此**契约不再是"待拍板"状态**。仍未实施且明确不属本批的：I-005（工程债）、I-006（G3 可达时）、G2 实现（TASK-012）、D-006（迁移基线）。

> ⚠️ 本节口径已被 **DEC-008** 补充（见 §决策对齐）：**工程通过、真实模型验证、专业确认、真实业务完成是四件事，分别记账**，不得互相替代。

---

## 12. 待拍板清单（2026-09-16 更新）

### 12.1 已决（不再阻塞 PC-1）

| # | 事项 | 决定 | 落点 |
| --- | --- | --- | --- |
| 1 | B4 产品读可见范围 | 组织内可读；写按项目角色 | §3.3 / §9.3 |
| 2 | B7 组织级角色 | 做最小 `OrganizationMember`，不做人事系统 | §9.3 / §7.3 D-003 |
| 3 | `Role.ORG_ADMIN` 枚举值 | 保留，但不再影响 `isOrgAdmin` | §9.3 |
| 4 | G2/G3 授权机制 | 统一到 `DecisionPacket`；`LaunchPlan` 只管执行 | §6.4 |
| 5 | §10.2 schema 增量 | 批准 I-001/I-002/I-003；I-004 一并实施（安全边界）；I-005 记工程债；I-006 方向已定暂不实施 | §10.2 |
| 6 | Worker / 队列运行时 | **继续延期**（TASK-020）。除非真实试点出现"研究任务数分钟以上、HTTP 生命周期无法承载" | §2.9 冻结清单 |

> ⚠️ 本表第 6 项已被 **DEC-007** 收敛（见 §决策对齐）：PC-0/PC-1 **明确不引入 Worker**；真实问题另立项并获用户解冻。与本契约既有冻结一致。

### 12.2 仍待决

| # | 事项 | 阻塞什么 | 不阻塞什么 |
| --- | --- | --- | --- |
| 7 | 品牌/渠道**专业确认人**由谁担任（角色枚举无此值） | 营销成果、渠道规则的确认 | 产品/证据/报价 |
| 8 | **真实试点产品**（名称/品牌、负责人、决策人、资料位置） | PC-0 放行 → PC-1 Batch A | 全部工程与契约工作 |
| 9 | 可用模型端点、真实 `modelId`、费用口径 | PC-1 Batch B（真实智能验收） | 确定性路径（成本引擎、门禁） |
| 10 | D-001 修复时点（`identityCode` 复合唯一 + 409） | ✅ **已消解（2026-09-20，TASK-008）**：约束已改为组织内复合唯一 | — |
| 11 | D-006 迁移基线是否重建 | ✅ **已消解（2026-09-20，TASK-007）**：基线迁移已补齐，空库可完整重放 | — |

---

## 13. 相关文件

- 前身契约：`docs/contracts/DATA_AND_COMMAND_CONTRACTS.md`（任务包 A，2026-09-13）
- 能力基线：`docs/product-center/CAPABILITY_BASELINE.md`（TASK-001）
- 试点登记：`docs/product-center/PILOT_BRIEF.md`（TASK-002）
- 验收记录：`docs/product-center/ACCEPTANCE.md`（TASK-004）
- 权限矩阵：`tests/authz-matrix.ts` + `tests/acceptance-authz-matrix.test.ts`（B8）
- 执行路线：`plan/process-product-center-roadmap-v1.md`（PC-0 → PC-4）
- 业务方向：`docs/产品愿景.md` v3.0
